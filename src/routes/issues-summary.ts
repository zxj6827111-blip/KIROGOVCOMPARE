import express from 'express';
import { dbQuery, dbBool, dbType } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
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
        let regionFilter = '';
        if (regionId) {
            regionFilter = `
        WITH RECURSIVE region_tree AS (
          SELECT id, name, parent_id, level FROM regions WHERE id = ${sqlValue(regionId)}
          UNION ALL
          SELECT r.id, r.name, r.parent_id, r.level
          FROM regions r
          INNER JOIN region_tree rt ON r.parent_id = rt.id
        )
        SELECT id, name, level FROM region_tree
      `;
        } else {
            // Get all regions
            regionFilter = `SELECT id, name, level FROM regions`;
        }

        // Get all regions in scope
        let regionsResult = await dbQuery(regionFilter);
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
        // Ensure regionIds is not empty to avoid SQL error
        if (regionIds.length === 0) return res.json({ data: { total_issues: 0, regions: [] } });
        const regionMap = new Map(regionsResult.map((r: any) => [r.id, r]));

        console.log(`[IssuesSummary] Region IDs count: ${regionIds.length}`);
        console.log(`[IssuesSummary] Current dbType: ${dbType}`);
        console.log(`[IssuesSummary] dbBool(true): ${dbBool(true)}`);

        // Get all reports for these regions with their active versions and issue counts
        const reportsQuery = `
      SELECT 
        r.id as report_id,
        r.region_id,
        r.year,
        r.unit_name,
        rv.id as version_id,
        COALESCE(
          (SELECT COUNT(*) FROM report_consistency_items rci 
           WHERE rci.report_version_id = rv.id 
           AND rci.auto_status = 'FAIL'
           AND (rci.human_status != 'dismissed' OR rci.human_status IS NULL)
          ), 0
        ) as issue_count
      FROM reports r
      INNER JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = ${dbBool(true)}
      WHERE r.region_id IN (${regionIds.join(',')})
      ORDER BY r.region_id, r.year DESC
    `;

        // Log query preview (beware very long logs)
        console.log(`[IssuesSummary] SQL Query Preview: ${reportsQuery.substring(0, 300)}... (truncated)`);
        console.log(`[IssuesSummary] SQL WHERE region_id IN: (${regionIds.slice(0, 5).join(',')}, ...)`);

        const reportsResult = await dbQuery(reportsQuery);
        console.log(`[IssuesSummary] Reports found in database: ${reportsResult.length}`);

        // Get detailed issue breakdown for reports with issues
        const reportsWithIssues = reportsResult.filter((r: any) => Number(r.issue_count) > 0);
        const issueBreakdown = new Map<number, { visual: number; structure: number; quality: number }>();

        if (reportsWithIssues.length > 0) {
            const versionIds = reportsWithIssues.map((r: any) => r.version_id);
            const breakdownQuery = `
        SELECT 
          report_version_id,
          group_key,
          COUNT(*) as cnt
        FROM report_consistency_items
        WHERE report_version_id IN (${versionIds.join(',')})
          AND auto_status = 'FAIL'
          AND (human_status != 'dismissed' OR human_status IS NULL)
        GROUP BY report_version_id, group_key
      `;
            const breakdownResult = await dbQuery(breakdownQuery);

            for (const row of breakdownResult) {
                const verId = Number(row.report_version_id);
                if (!issueBreakdown.has(verId)) {
                    issueBreakdown.set(verId, { visual: 0, structure: 0, quality: 0 });
                }
                const breakdown = issueBreakdown.get(verId)!;
                const cnt = Number(row.cnt);

                if (row.group_key === 'visual') {
                    breakdown.visual += cnt;
                } else if (['structure', 'table2', 'table3', 'table4', 'text'].includes(row.group_key)) {
                    breakdown.structure += cnt;
                } else if (row.group_key === 'quality') {
                    breakdown.quality += cnt;
                }
            }
        }

        // Group reports by region
        const regionReportsMap = new Map<number, any[]>();
        for (const report of reportsResult) {
            const rId = Number(report.region_id);
            if (!regionReportsMap.has(rId)) {
                regionReportsMap.set(rId, []);
            }

            const breakdown = issueBreakdown.get(Number(report.version_id)) || { visual: 0, structure: 0, quality: 0 };

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
            if (!region) continue;

            const regionIssues = reports.reduce((sum: number, r: any) => sum + r.issue_count, 0);
            totalIssues += regionIssues;

            // Only include regions that have issues (or optionally all with reports)
            if (reports.length > 0) {
                regions.push({
                    region_id: rId,
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
