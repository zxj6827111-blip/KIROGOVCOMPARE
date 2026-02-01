import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();

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
                r.active_version_id,
                rv.parsed_json,
                rv.raw_text
            FROM reports r
            LEFT JOIN report_versions rv ON rv.id = r.active_version_id
            WHERE r.region_id = ANY($1::int[]) AND r.year = $2
        `;
        const reportsResult = await pool.query(reportsQuery, [regionIds, year]);
        const reportsByRegion = new Map<number, any>();
        for (const row of reportsResult.rows) {
            reportsByRegion.set(row.region_id, row);
        }

        // 判断报告是否为空
        const isEmptyReport = (report: any): boolean => {
            if (!report.active_version_id) return true;
            if (!report.parsed_json) return true;
            if (typeof report.parsed_json === 'object' && Object.keys(report.parsed_json).length === 0) return true;
            if (!report.raw_text || report.raw_text.trim().length < 100) return true;
            return false;
        };

        // 构建结果列表
        const results: any[] = [];
        let missingCount = 0;
        let emptyCount = 0;
        let textEmptyCount = 0;

        for (const region of regionsResult) {
            const report = reportsByRegion.get(region.id);
            let status: 'missing' | 'empty' | 'text_empty' | null = null;

            if (!report) {
                status = 'missing';
                missingCount++;
            } else {
                // Helper to check if JSON has meaningful content (sections or tables)
                const hasEffectiveContent = (parsed: any): boolean => {
                    if (!parsed || typeof parsed !== 'object') return false;
                    const hasSections = Array.isArray(parsed.sections) && parsed.sections.length > 0;
                    const hasTables = parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0;
                    return hasSections || hasTables;
                };

                // Check if JSON data is effectively empty
                // We now require actual sections or tables to be present. 
                // Just having 'metadata', 'error' keys etc is considered empty.
                const isJsonEmpty = !report.active_version_id ||
                    !report.parsed_json ||
                    !hasEffectiveContent(report.parsed_json);

                // Check if Text content is effectively empty
                // Note: We only consider text empty if JSON is NOT empty (otherwise it falls into the main 'empty' category)
                // Helper to check if text content exists in parsed sections
                const hasParsedTextContent = (parsed: any): boolean => {
                    if (!parsed || !parsed.sections || !Array.isArray(parsed.sections)) return false;
                    let totalLen = 0;
                    for (const s of parsed.sections) {
                        // Defensive check for null/malformed section objects
                        if (!s) continue;
                        if (s.content && typeof s.content === 'string') {
                            totalLen += s.content.length;
                        }
                        if (totalLen > 100) return true;
                    }
                    return totalLen > 100;
                };

                const isTextEmpty = (!report.raw_text || report.raw_text.trim().length < 100) && (!hasParsedTextContent(report.parsed_json));

                if (isJsonEmpty) {
                    status = 'empty';
                    emptyCount++;
                } else if (isTextEmpty) {
                    status = 'text_empty';
                    textEmptyCount++;
                }
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
                r.active_version_id,
                rv.parsed_json,
                rv.raw_text
            FROM reports r
            LEFT JOIN report_versions rv ON rv.id = r.active_version_id
            WHERE r.region_id = ANY($1::int[]) AND r.year = $2
        `;
        const reportsResult = await pool.query(reportsQuery, [regionIds, year]);
        const reportsByRegion = new Map<number, any>();
        for (const row of reportsResult.rows) {
            reportsByRegion.set(row.region_id, row);
        }

        const isEmptyReport = (report: any): boolean => {
            if (!report.active_version_id) return true;
            if (!report.parsed_json) return true;
            if (typeof report.parsed_json === 'object' && Object.keys(report.parsed_json).length === 0) return true;
            if (!report.raw_text || report.raw_text.trim().length < 100) return true;
            return false;
        };

        // 构建结果
        const results: any[] = [];
        for (const region of regionsResult) {
            const report = reportsByRegion.get(region.id);
            let status: string | null = null;

            if (!report) {
                status = '未上传';
            } else {
                // Helper to check if JSON has meaningful content
                const hasEffectiveContent = (parsed: any): boolean => {
                    if (!parsed || typeof parsed !== 'object') return false;
                    const hasSections = Array.isArray(parsed.sections) && parsed.sections.length > 0;
                    const hasTables = parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0;
                    return hasSections || hasTables;
                };

                const isJsonEmpty = !report.active_version_id ||
                    !report.parsed_json ||
                    !hasEffectiveContent(report.parsed_json);


                // Helper to check if text content exists in parsed sections
                const hasParsedTextContent = (parsed: any): boolean => {
                    if (!parsed || !parsed.sections || !Array.isArray(parsed.sections)) return false;
                    let totalLen = 0;
                    for (const s of parsed.sections) {
                        // Defensive check for null/malformed section objects
                        if (!s) continue;
                        if (s.content && typeof s.content === 'string') {
                            totalLen += s.content.length;
                        }
                        if (totalLen > 100) return true;
                    }
                    return totalLen > 100;
                };

                const isTextEmpty = (!report.raw_text || report.raw_text.trim().length < 100) && (!hasParsedTextContent(report.parsed_json));

                if (isJsonEmpty) {
                    status = '内容为空';
                } else if (isTextEmpty) {
                    status = '文字为空';
                }
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
