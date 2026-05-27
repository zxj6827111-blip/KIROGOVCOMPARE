import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { compareRegionsByCityManagementOrder } from '../utils/regionSort';
import { HIERARCHY_COMPLETENESS_SQL_EXCLUSION } from '../utils/consistencyReviewSemantics';

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
        } else {
            allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
        }

        // Build recursive CTE to get all descendant regions
        let regionsResult: any[] = [];

        if (regionId) {
            const regionTreeQuery = `
            WITH RECURSIVE region_tree AS (
              SELECT id, name, parent_id, level, sort_order FROM regions WHERE id = $1
              UNION ALL
              SELECT r.id, r.name, r.parent_id, r.level, r.sort_order
              FROM regions r
              INNER JOIN region_tree rt ON r.parent_id = rt.id
            )
            SELECT id, name, parent_id, level, sort_order FROM region_tree
            `;
            const result = await pool.query(regionTreeQuery, [regionId]);
            regionsResult = result.rows;
        } else {
            // Get all regions
            const regionAllQuery = `SELECT id, name, parent_id, level, sort_order FROM regions`;
            const result = await pool.query(regionAllQuery);
            regionsResult = result.rows;
        }

        // Apply data scope filtering
        if (allowedRegionIds && allowedRegionIds.length > 0) {
            regionsResult = regionsResult.filter((r: any) => allowedRegionIds!.includes(r.id));
        } else if (allowedRegionIds && allowedRegionIds.length === 0 && (req.user as any)?.role !== 'admin') {
            // User has no access and is not admin
            return res.json({ data: { total_issues: 0, tree: [] } });
        }

        if (regionsResult.length === 0) {
            return res.json({ data: { total_issues: 0, tree: [] } });
        }

        const regionIds = regionsResult.map((r: any) => r.id);

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

        const issuesByVersion = new Map<string, number>();
        const issueBreakdown = new Map<string, { visual: number; structure: number; quality: number }>();

        if (reportsResult.length > 0) {
            const versionIds = reportsResult.map((r: any) => r.version_id);

            const itemsQuery = `
                SELECT
                  report_version_id,
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE group_key = 'visual')::int AS visual,
                  COUNT(*) FILTER (WHERE group_key IN ('structure', 'table2', 'table3', 'table4', 'text', 'hierarchy'))::int AS structure,
                  COUNT(*) FILTER (WHERE group_key NOT IN ('visual', 'structure', 'table2', 'table3', 'table4', 'text', 'hierarchy'))::int AS quality
                FROM report_consistency_items
                WHERE report_version_id = ANY($1::int[])
                  AND ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                  AND auto_status IN ('FAIL', 'UNCERTAIN')
                  AND COALESCE(human_status, 'pending') != 'dismissed'
                GROUP BY report_version_id
            `;

            const itemsResultRes = await pool.query(itemsQuery, [versionIds]);
            for (const item of itemsResultRes.rows) {
                const vid = String(item.report_version_id);
                issuesByVersion.set(vid, Number(item.total) || 0);
                issueBreakdown.set(vid, {
                    visual: Number(item.visual) || 0,
                    structure: Number(item.structure) || 0,
                    quality: Number(item.quality) || 0
                });
            }
        }

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

        // Build Tree Structure
        // Use String keys for safer matching between regionsResult (numbers usually) and regionReportsMap keys (strings)
        const nodeMap = new Map<string, any>();

        // Initialize nodes
        regionsResult.forEach((r: any) => {
            nodeMap.set(String(r.id), {
                region_id: r.id,
                region_name: r.name,
                region_level: r.level,
                parent_id: r.parent_id,
                sort_order: r.sort_order,
                own_issues: 0,
                subtree_issues: 0,
                reports: [],
                children: []
            });
        });

        // Fill data
        // Iterate regionReportsMap which has String keys
        for (const [rIdStr, reports] of regionReportsMap) {
            const node = nodeMap.get(rIdStr);
            if (node) {
                node.reports = reports.sort((a: any, b: any) => b.year - a.year);
                node.own_issues = reports.reduce((sum: number, r: any) => sum + r.issue_count, 0);
            }
        }

        // Construct Hierarchy
        const roots: any[] = [];

        nodeMap.forEach((node) => {
            const parentId = String(node.parent_id);
            // Check if parent exists in our map
            if (node.parent_id && nodeMap.has(parentId)) {
                nodeMap.get(parentId).children.push(node);
            } else {
                // Root of the current result set
                roots.push(node);
            }
        });

        // calculate subtree issues
        const calculateSubtreeStats = (node: any): number => {
            let sum = node.own_issues;
            if (node.children && node.children.length > 0) {
                for (const child of node.children) {
                    sum += calculateSubtreeStats(child);
                }

                // Keep sibling order aligned with City Management settings.
                node.children.sort((a: any, b: any) => compareRegionsByCityManagementOrder(
                    { id: a.region_id, name: a.region_name, level: a.region_level, sort_order: a.sort_order },
                    { id: b.region_id, name: b.region_name, level: b.region_level, sort_order: b.sort_order }
                ));
            }
            node.subtree_issues = sum;
            return sum;
        };

        let totalIssues = 0;
        roots.forEach(root => {
            totalIssues += calculateSubtreeStats(root);
        });

        // Sort roots with the same order rule as City Management.
        roots.sort((a: any, b: any) => compareRegionsByCityManagementOrder(
            { id: a.region_id, name: a.region_name, level: a.region_level, sort_order: a.sort_order },
            { id: b.region_id, name: b.region_name, level: b.region_level, sort_order: b.sort_order }
        ));

        return res.json({
            data: {
                total_issues: totalIssues,
                tree: roots
            }
        });

    } catch (error: any) {
        console.error('Error fetching issues summary:', error);
        return res.status(500).json({ error: 'Failed to fetch issues summary: ' + error.message });
    }
});

export default router;
