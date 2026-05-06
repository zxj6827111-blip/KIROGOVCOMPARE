import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();

type MaintenanceStatus = 'missing' | 'empty' | 'text_empty';

interface MaintenanceReportRow {
    report_id: number;
    region_id: number;
    year: number;
    effective_version_id: number | null;
    parsed_json: any;
    raw_text: string | null;
}

const MAINTENANCE_TEXT_THRESHOLD = 100;
const MAINTENANCE_STRUCTURED_KEYS = new Set(['sections', 'subsections', 'children', 'items', 'content', 'paragraphs']);
const MAINTENANCE_TEXT_KEYS = new Set(['content', 'text']);
const MAINTENANCE_METADATA_KEYS = new Set([
    'type',
    'title',
    'file_hash',
    'file_size',
    'report_id',
    'version_id',
    'generated_at',
    'storage_path',
    'visual_audit',
    'tableData',
    'activeDisclosureData',
    'reviewLitigationData',
]);

const hasEffectiveContent = (parsed: any): boolean => {
    if (!parsed || typeof parsed !== 'object') return false;
    if (Array.isArray(parsed.sections) && parsed.sections.length > 0) return true;
    if (parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0) return true;
    if (Array.isArray(parsed.content) && parsed.content.length > 0) return true;
    return false;
};

const getParsedNarrativeTextLength = (node: unknown, parentKey = ''): number => {
    if (node == null) return 0;

    if (typeof node === 'string') {
        return MAINTENANCE_TEXT_KEYS.has(parentKey) ? node.trim().length : 0;
    }

    if (Array.isArray(node)) {
        return node.reduce((sum, item) => sum + getParsedNarrativeTextLength(item, parentKey), 0);
    }

    if (typeof node !== 'object') {
        return 0;
    }

    return Object.entries(node as Record<string, unknown>).reduce((sum, [key, value]) => {
        if (MAINTENANCE_METADATA_KEYS.has(key)) {
            return sum;
        }

        if (
            MAINTENANCE_STRUCTURED_KEYS.has(key)
            || MAINTENANCE_TEXT_KEYS.has(key)
            || parentKey === 'sections'
            || parentKey === 'subsections'
            || parentKey === 'paragraphs'
            || parentKey === 'content'
        ) {
            return sum + getParsedNarrativeTextLength(value, key);
        }

        return sum;
    }, 0);
};

const getReportMaintenanceStatus = (report?: MaintenanceReportRow | null): MaintenanceStatus | null => {
    if (!report) {
        return 'missing';
    }

    const isJsonEmpty = !report.effective_version_id || !hasEffectiveContent(report.parsed_json);
    if (isJsonEmpty) {
        return 'empty';
    }

    const rawTextLength = typeof report.raw_text === 'string' ? report.raw_text.trim().length : 0;
    const parsedTextLength = getParsedNarrativeTextLength(report.parsed_json);
    const isTextEmpty = rawTextLength < MAINTENANCE_TEXT_THRESHOLD && parsedTextLength < MAINTENANCE_TEXT_THRESHOLD;

    if (isTextEmpty) {
        return 'text_empty';
    }

    return null;
};

/**
 * GET /report-maintenance - 获取年报维护列表（未上传或内容为空的城市）
 * Query params:
 *   - year (required): 目标年份
 *   - region_id (optional): 限定区域ID及其下级
 */
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const yearParam = req.query.year;
        const regionIdParam = req.query.region_id;

        // 验证年份参数
        if (!yearParam) {
            return res.status(400).json({ error: '年份参数 (year) 必填' });
        }

        const year = Number(yearParam);
        if (isNaN(year) || year < 2000 || year > 2100) {
            return res.status(400).json({ error: '无效的年份' });
        }

        const regionId = regionIdParam ? Number(regionIdParam) : null;
        if (regionIdParam && (isNaN(regionId!) || regionId! < 1)) {
            return res.status(400).json({ error: '无效的区域ID' });
        }

        // 权限检查
        let allowedRegionIds: number[] | null = null;
        if ((req.user as any)?.role === 'admin' || req.user?.username === 'System Admin') {
            allowedRegionIds = null; // null 表示全部访问
        } else {
            allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
        }

        // 构建区域查询
        let regionsResult: any[] = [];
        if (regionId) {
            // 获取指定区域及其所有下级
            const regionTreeQuery = `
                WITH RECURSIVE region_tree AS (
                    SELECT id, name, parent_id, level, code FROM regions WHERE id = $1
                    UNION ALL
                    SELECT r.id, r.name, r.parent_id, r.level, r.code
                    FROM regions r
                    INNER JOIN region_tree rt ON r.parent_id = rt.id
                )
                SELECT id, name, level, parent_id, code FROM region_tree
            `;
            const result = await pool.query(regionTreeQuery, [regionId]);
            regionsResult = result.rows;
        } else {
            // 获取所有区域
            const regionAllQuery = `SELECT id, name, level, parent_id, code FROM regions`;
            const result = await pool.query(regionAllQuery);
            regionsResult = result.rows;
        }

        // 应用权限过滤
        if (allowedRegionIds && allowedRegionIds.length > 0) {
            regionsResult = regionsResult.filter((r: any) => allowedRegionIds!.includes(r.id));
        } else if (allowedRegionIds && allowedRegionIds.length === 0 && (req.user as any)?.role !== 'admin') {
            return res.json({ data: { total: 0, missing_count: 0, empty_count: 0, regions: [] } });
        }

        if (regionsResult.length === 0) {
            return res.json({ data: { total: 0, missing_count: 0, empty_count: 0, regions: [] } });
        }

        const regionIds = regionsResult.map((r: any) => r.id);
        const regionMap = new Map(regionsResult.map((r: any) => [r.id, r]));

        // 构建父级路径映射
        const buildParentPath = (regionId: number): string => {
            const paths: string[] = [];
            let currentId: number | null = regionId;
            while (currentId) {
                const region = regionMap.get(currentId);
                if (region && region.parent_id) {
                    const parent = regionMap.get(region.parent_id);
                    if (parent) {
                        paths.unshift(parent.name);
                    }
                    currentId = region.parent_id;
                } else {
                    break;
                }
            }
            return paths.join(' > ');
        };

        // 查询该年份所有区域的报告情况
        const reportsQuery = `
            SELECT 
                r.id AS report_id,
                r.region_id,
                r.year,
                COALESCE(pending_rv.id, active_rv.id) AS effective_version_id,
                COALESCE(pending_rv.parsed_json, active_rv.parsed_json) AS parsed_json,
                COALESCE(pending_rv.raw_text, active_rv.raw_text) AS raw_text
            FROM reports r
            LEFT JOIN report_versions active_rv ON active_rv.id = r.active_version_id
            LEFT JOIN LATERAL (
                SELECT
                    rv.id,
                    rv.parsed_json,
                    rv.raw_text
                FROM report_versions rv
                WHERE rv.report_id = r.id
                  AND rv.review_status = 'pending_review'
                ORDER BY rv.created_at DESC, rv.id DESC
                LIMIT 1
            ) pending_rv ON true
            WHERE r.region_id = ANY($1::int[]) AND r.year = $2
        `;
        const reportsResult = await pool.query(reportsQuery, [regionIds, year]);
        const reportsByRegion = new Map<number, MaintenanceReportRow>();
        for (const row of reportsResult.rows) {
            reportsByRegion.set(Number(row.region_id), row as MaintenanceReportRow);
        }

        // 构建结果列表
        const results: any[] = [];
        let missingCount = 0;
        let emptyCount = 0;
        let textEmptyCount = 0;

        for (const region of regionsResult) {
            const report = reportsByRegion.get(region.id);
            const status = getReportMaintenanceStatus(report);

            if (status === 'missing') {
                missingCount++;
            } else if (status === 'empty') {
                emptyCount++;
            } else if (status === 'text_empty') {
                textEmptyCount++;
            }

            if (status) {
                results.push({
                    region_id: region.id,
                    region_name: region.name,
                    region_code: region.code,
                    level: region.level,
                    parent_path: buildParentPath(region.id),
                    year,
                    status,
                    report_id: report?.report_id || null
                });
            }
        }

        // 按状态和层级排序：未上传 > 内容为空 > 文字为空，层级低的优先
        results.sort((a, b) => {
            if (a.status !== b.status) {
                // Fixed order: missing, empty, text_empty
                const order = { 'missing': 0, 'empty': 1, 'text_empty': 2 };
                return (order[a.status as keyof typeof order] || 99) - (order[b.status as keyof typeof order] || 99);
            }
            return a.level - b.level;
        });

        return res.json({
            data: {
                year,
                total: results.length,
                missing_count: missingCount,
                empty_count: emptyCount,
                text_empty_count: textEmptyCount,
                regions: results
            }
        });

    } catch (error: any) {
        console.error('[ReportMaintenance] Error:', error);
        return res.status(500).json({ error: '获取年报维护数据失败: ' + error.message });
    }
});

/**
 * GET /report-maintenance/export - 导出年报维护列表为 Excel
 */
router.get('/export', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const yearParam = req.query.year;
        const regionIdParam = req.query.region_id;

        if (!yearParam) {
            return res.status(400).json({ error: '年份参数 (year) 必填' });
        }

        const year = Number(yearParam);
        if (isNaN(year) || year < 2000 || year > 2100) {
            return res.status(400).json({ error: '无效的年份' });
        }

        const regionId = regionIdParam ? Number(regionIdParam) : null;

        // 权限检查
        let allowedRegionIds: number[] | null = null;
        if ((req.user as any)?.role === 'admin' || req.user?.username === 'System Admin') {
            allowedRegionIds = null;
        } else {
            allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
        }

        // 构建区域查询（与上面相同逻辑）
        let regionsResult: any[] = [];
        if (regionId) {
            const regionTreeQuery = `
                WITH RECURSIVE region_tree AS (
                    SELECT id, name, parent_id, level, code FROM regions WHERE id = $1
                    UNION ALL
                    SELECT r.id, r.name, r.parent_id, r.level, r.code
                    FROM regions r
                    INNER JOIN region_tree rt ON r.parent_id = rt.id
                )
                SELECT id, name, level, parent_id, code FROM region_tree
            `;
            const result = await pool.query(regionTreeQuery, [regionId]);
            regionsResult = result.rows;
        } else {
            const regionAllQuery = `SELECT id, name, level, parent_id, code FROM regions`;
            const result = await pool.query(regionAllQuery);
            regionsResult = result.rows;
        }

        // 权限过滤
        if (allowedRegionIds && allowedRegionIds.length > 0) {
            regionsResult = regionsResult.filter((r: any) => allowedRegionIds!.includes(r.id));
        }

        const regionIds = regionsResult.map((r: any) => r.id);
        const regionMap = new Map(regionsResult.map((r: any) => [r.id, r]));

        const buildParentPath = (rid: number): string => {
            const paths: string[] = [];
            let currentId: number | null = rid;
            while (currentId) {
                const region = regionMap.get(currentId);
                if (region && region.parent_id) {
                    const parent = regionMap.get(region.parent_id);
                    if (parent) {
                        paths.unshift(parent.name);
                    }
                    currentId = region.parent_id;
                } else {
                    break;
                }
            }
            return paths.join(' > ');
        };

        // 查询报告
        const reportsQuery = `
            SELECT 
                r.id AS report_id,
                r.region_id,
                r.year,
                COALESCE(pending_rv.id, active_rv.id) AS effective_version_id,
                COALESCE(pending_rv.parsed_json, active_rv.parsed_json) AS parsed_json,
                COALESCE(pending_rv.raw_text, active_rv.raw_text) AS raw_text
            FROM reports r
            LEFT JOIN report_versions active_rv ON active_rv.id = r.active_version_id
            LEFT JOIN LATERAL (
                SELECT
                    rv.id,
                    rv.parsed_json,
                    rv.raw_text
                FROM report_versions rv
                WHERE rv.report_id = r.id
                  AND rv.review_status = 'pending_review'
                ORDER BY rv.created_at DESC, rv.id DESC
                LIMIT 1
            ) pending_rv ON true
            WHERE r.region_id = ANY($1::int[]) AND r.year = $2
        `;
        const reportsResult = await pool.query(reportsQuery, [regionIds, year]);
        const reportsByRegion = new Map<number, MaintenanceReportRow>();
        for (const row of reportsResult.rows) {
            reportsByRegion.set(Number(row.region_id), row as MaintenanceReportRow);
        }

        // 构建结果
        const results: any[] = [];
        for (const region of regionsResult) {
            const report = reportsByRegion.get(region.id);
            const maintenanceStatus = getReportMaintenanceStatus(report);
            let status: string | null = null;

            if (maintenanceStatus === 'missing') {
                status = '未上传';
            } else if (maintenanceStatus === 'empty') {
                status = '内容为空';
            } else if (maintenanceStatus === 'text_empty') {
                status = '文字为空';
            }

            if (status) {
                results.push({
                    region_name: region.name,
                    level: getLevelName(region.level),
                    parent_path: buildParentPath(region.id),
                    year,
                    status
                });
            }
        }

        // 生成 CSV（简单方案，无需额外依赖）
        const headers = ['序号', '区域名称', '区域层级', '上级区域', '年份', '状态'];
        const rows = results.map((r, idx) => [
            idx + 1,
            r.region_name,
            r.level,
            r.parent_path || '-',
            r.year,
            r.status
        ]);

        // 生成 CSV 内容（带 BOM 支持中文）
        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_maintenance_${year}.csv"`);
        return res.send(csvContent);

    } catch (error: any) {
        console.error('[ReportMaintenance] Export error:', error);
        return res.status(500).json({ error: '导出失败: ' + error.message });
    }
});

function getLevelName(level: number): string {
    switch (level) {
        case 0:
        case 1: return '省级';
        case 2: return '市级';
        case 3: return '区县级';
        case 4: return '街道/乡镇';
        default: return `Level ${level}`;
    }
}

export default router;
