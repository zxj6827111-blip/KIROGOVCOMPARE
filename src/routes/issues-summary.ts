import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();

/**
 * GET /regions/:id/issues-summary - 获取区域及其所有下级区域的问题汇总
 * 如果 id 为 "all" 或未提供，则返回所有区域的问题汇总
 */
router.get('/regions/:id/issues-summary', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const regionIdParam = req.params.id;
        const regionId = regionIdParam === 'all' ? null : Number(regionIdParam);

        if (regionIdParam !== 'all' && (isNaN(regionId!) || regionId! < 1)) {
            return res.status(400).json({ error: '无效的区域ID' });
        }

        // Get allowed region IDs for data scope filtering
        // PATCH: If user is admin, force allow all (bypass empty data_scope issue)
        let allowedRegionIds: number[] | null = [];
        if ((req.user as any)?.role === 'admin' || req.user?.username === 'System Admin') {
            allowedRegionIds = null; // null means ALL access
            console.log('[IssuesSummary] User is admin/System Admin, allowing all regions');
        } else {
            allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
            console.log(`[IssuesSummary] User ${req.user?.username} allowed regions count: ${allowedRegionIds?.length}`);
        }

        // Build recursive CTE to get all descendant regions
        let regionsResult: any[] = [];

        if (regionId) {
            const regionTreeQuery = `
            WITH RECURSIVE region_tree AS (
              SELECT id, name, parent_id, level FROM regions WHERE id = $1
              UNION ALL
              SELECT r.id, r.name, r.parent_id, r.level
              FROM regions r
              INNER JOIN region_tree rt ON r.parent_id = rt.id
            )
            SELECT id, name, level FROM region_tree
            `;
            const result = await pool.query(regionTreeQuery, [regionId]);
            regionsResult = result.rows;
        } else {
            // Get all regions
            const regionAllQuery = `SELECT id, name, level FROM regions`;
            const result = await pool.query(regionAllQuery);
            regionsResult = result.rows;
        }

        console.log(`[IssuesSummary] Total regions found: ${regionsResult.length}`);

        // Apply data scope filtering
        if (allowedRegionIds && allowedRegionIds.length > 0) {
            regionsResult = regionsResult.filter((r: any) => allowedRegionIds!.includes(r.id));
        } else if (allowedRegionIds && allowedRegionIds.length === 0 && (req.user as any)?.role !== 'admin') {
            // User has no access and is not admin
            console.log('[IssuesSummary] No allowed regions for user');
            return res.json({ data: { total_issues: 0, regions: [] } });
        }

        console.log(`[IssuesSummary] Filtered regions count: ${regionsResult.length}`);

        if (regionsResult.length === 0) {
            return res.json({ data: { total_issues: 0, regions: [] } });
        }

        const regionIds = regionsResult.map((r: any) => r.id);
        const regionMap = new Map(regionsResult.map((r: any) => [String(r.id), r]));

        console.log(`[IssuesSummary] Region IDs count: ${regionIds.length}`);

        // Use ANY for potentially large lists
        const reportsQuery = `
          SELECT 
            r.id as report_id,
            r.region_id,
            r.year,
            r.unit_name,
            rv.id as version_id
          FROM reports r
          INNER JOIN report_versions rv ON rv.id = r.active_version_id
          WHERE r.region_id = ANY($1::int[])
          ORDER BY r.region_id, r.year DESC
        `;

        const reportsResultRes = await pool.query(reportsQuery, [regionIds]);
        const reportsResult = reportsResultRes.rows;
        console.log(`[IssuesSummary] Base reports found: ${reportsResult.length}`);

        if (reportsResult.length === 0) {
            return res.json({ data: { total_issues: 0, regions: [] } });
        }

        // JS-BASED AGGREGATION: Fetch all items and count in memory
        const versionIds = reportsResult.map((r: any) => r.version_id);

        const itemsQuery = `
            SELECT *
            FROM report_consistency_items 
            WHERE report_version_id = ANY($1::int[])
        `;

        const itemsResultRes = await pool.query(itemsQuery, [versionIds]);
        const itemsResult = itemsResultRes.rows;
        console.log(`[IssuesSummary] Total consistency items fetched: ${itemsResult.length}`);

        // Perform counting in JS
        const issuesByVersion = new Map<string, number>();
        const issueBreakdown = new Map<string, { visual: number; structure: number; quality: number }>();

        let debugFailCount = 0;

        for (const item of itemsResult) {
            const statusStr = (item.auto_status || item.status || '').toString().toUpperCase();
            const isFail = statusStr.trim() === 'FAIL';
            const isDismissed = (item.human_status === 'dismissed');

            if (isFail && !isDismissed) {
                const vid = String(item.report_version_id);
                issuesByVersion.set(vid, (issuesByVersion.get(vid) || 0) + 1);
                debugFailCount++;

                // Update breakdown
                if (!issueBreakdown.has(vid)) {
                    issueBreakdown.set(vid, { visual: 0, structure: 0, quality: 0 });
                }
                const counts = issueBreakdown.get(vid)!;
                // Handle category vs group_key
                const cat = item.category || item.group_key;

                if (cat === 'visual') counts.visual++;
                else if (['structure', 'table2', 'table3', 'table4', 'text'].includes(cat) || cat === 'structure') counts.structure++;
                else counts.quality++;
            }
        }

        console.log(`[IssuesSummary] Total JS-calculated FAIL items: ${debugFailCount}`);

        // Assign counts back to reports
        reportsResult.forEach((r: any) => {
            r.issue_count = issuesByVersion.get(String(r.version_id)) || 0;
        });

        // Group reports by region
        const regionReportsMap = new Map<string, any[]>();
        for (const report of reportsResult) {
            const rId = String(report.region_id);
            if (!regionReportsMap.has(rId)) {
                regionReportsMap.set(rId, []);
            }

            const breakdown = issueBreakdown.get(String(report.version_id)) || { visual: 0, structure: 0, quality: 0 };

            regionReportsMap.get(rId)!.push({
                report_id: report.report_id,
                year: report.year,
                unit_name: report.unit_name || '',
                issue_count: Number(report.issue_count),
                issues_by_category: breakdown
            });
        }

        // Build final response - only include regions with reports
        const regions: any[] = [];
        let totalIssues = 0;

        for (const [rId, reports] of regionReportsMap) {
            const region = regionMap.get(rId);

            if (!region) {
                continue;
            }

            const regionIssues = reports.reduce((sum: number, r: any) => sum + r.issue_count, 0);
            totalIssues += regionIssues;

            if (reports.length > 0) {
                regions.push({
                    region_id: Number(rId),
                    region_name: region.name,
                    region_level: region.level,
                    total_issues: regionIssues,
                    reports: reports.sort((a: any, b: any) => b.year - a.year) // Sort by year descending
                });
            }
        }

        // Sort regions: those with issues first, then by issue count desc
        regions.sort((a, b) => b.total_issues - a.total_issues);

        return res.json({
            data: {
                total_issues: totalIssues,
                region_count: regions.length,
                regions
            }
        });

    } catch (error: any) {
        console.error('Error fetching issues summary:', error);
        return res.status(500).json({ error: 'Failed to fetch issues summary: ' + error.message });
    }
});

export default router;
