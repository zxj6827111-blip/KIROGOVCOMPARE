import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
    MaintenanceReportRow,
    getReportMaintenanceStatus,
    toRegionKey,
} from '../utils/reportMaintenance';
import { HIERARCHY_COMPLETENESS_SQL_EXCLUSION } from '../utils/consistencyReviewSemantics';

const router = express.Router();

type ExportScope = 'all' | 'abnormal' | 'review';

interface RegionRow {
    id: number;
    name: string;
    parent_id: number | null;
    level: number;
    code?: string | null;
}

interface MaintenanceDetailRow {
    region_id: number;
    region_name: string;
    region_code: string | null;
    level: number;
    parent_region_id: number | null;
    parent_unit_name: string;
    parent_path: string;
    year: number;
    report_id: number | null;
    unit_id: number;
    unit_name: string;
    upload_status: 'uploaded' | 'not_uploaded';
    parse_status: string;
    compare_status: string;
    abnormal_count: number | null;
    abnormal_types: string[];
    review_status: string;
    archive_status: string;
    maintenance_status: string;
    file_name: string | null;
    file_size: number | null;
    upload_time: string | null;
    parse_time: string | null;
    compare_time: string | null;
    reviewed_at: string | null;
    archived_at: string | null;
    updated_at: string | null;
    latest_job: {
        job_id: number;
        kind: string;
        status: string;
        progress: number | null;
        error_code: string | null;
        error_message: string | null;
        updated_at: string | null;
    } | null;
}

const isAdminUser = (req: AuthRequest) => {
    return req.user?.permissions?.system_admin === true;
};

const parseDbJson = (value: unknown) => {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return value;
};

const hasParsedContentForMaintenance = (parsed: unknown): boolean => {
    if (!parsed || typeof parsed !== 'object') return false;
    if (Array.isArray((parsed as any).sections) && (parsed as any).sections.length > 0) return true;
    if ((parsed as any).tables && typeof (parsed as any).tables === 'object' && Object.keys((parsed as any).tables).length > 0) return true;
    if (Array.isArray((parsed as any).content) && (parsed as any).content.length > 0) return true;
    return Object.keys(parsed as Record<string, unknown>).length > 0;
};

const toInteger = (value: unknown, fallback = 0): number => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const toIsoStringOrNull = (value: unknown): string | null => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
};

const validateYear = (raw: unknown): number | null => {
    const year = Number(raw);
    if (!raw || Number.isNaN(year) || year < 2000 || year > 2100) {
        return null;
    }
    return year;
};

const validateRegionId = (raw: unknown): number | null => {
    if (raw == null || raw === '') return null;
    const regionId = Number(raw);
    if (Number.isNaN(regionId) || regionId < 1) {
        return NaN;
    }
    return regionId;
};

const getAllowedRegionIds = async (req: AuthRequest): Promise<number[] | null> => {
    if (isAdminUser(req)) {
        return null;
    }
    return getAllowedRegionIdsAsync(req.user);
};

const loadRegions = async (regionId: number | null, allowedRegionIds: number[] | null): Promise<RegionRow[]> => {
    let regionsResult: RegionRow[] = [];

    if (regionId) {
        const result = await pool.query(
            `
                WITH RECURSIVE region_tree AS (
                    SELECT id, name, parent_id, level, code FROM regions WHERE id = $1
                    UNION ALL
                    SELECT r.id, r.name, r.parent_id, r.level, r.code
                    FROM regions r
                    INNER JOIN region_tree rt ON r.parent_id = rt.id
                )
                SELECT id, name, level, parent_id, code FROM region_tree
            `,
            [regionId]
        );
        regionsResult = result.rows;
    } else {
        const result = await pool.query('SELECT id, name, level, parent_id, code FROM regions');
        regionsResult = result.rows;
    }

    if (allowedRegionIds) {
        if (allowedRegionIds.length === 0) {
            return [];
        }
        const allowedSet = new Set(allowedRegionIds.map(Number));
        regionsResult = regionsResult.filter((region) => allowedSet.has(Number(region.id)));
    }

    return regionsResult;
};

const buildRegionHelpers = (regions: RegionRow[]) => {
    const regionMap = new Map(regions.map((region) => [toRegionKey(region.id), region]));

    const buildParentPath = (regionId: number): string => {
        const paths: string[] = [];
        let currentId: number | string | null = regionId;
        while (currentId) {
            const region = regionMap.get(toRegionKey(currentId));
            if (region && region.parent_id) {
                const parent = regionMap.get(toRegionKey(region.parent_id));
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

    const getParentName = (region: RegionRow): string => {
        if (!region.parent_id) return '';
        return regionMap.get(toRegionKey(region.parent_id))?.name || '';
    };

    return { regionMap, buildParentPath, getParentName };
};

const buildReportRows = async (regions: RegionRow[], year: number): Promise<Map<string, any>> => {
    if (regions.length === 0) {
        return new Map();
    }

    const regionIds = regions.map((region) => region.id);
    const reportsQuery = `
        WITH ranked_reports AS (
            SELECT
                r.id AS report_id,
                r.region_id,
                r.year,
                COALESCE(NULLIF(r.unit_name, ''), reg.name) AS unit_name,
                r.created_at AS report_created_at,
                r.updated_at AS report_updated_at,
                COALESCE(pending_rv.id, active_rv.id) AS effective_version_id,
                COALESCE(pending_rv.file_name, active_rv.file_name) AS file_name,
                COALESCE(pending_rv.file_size, active_rv.file_size) AS file_size,
                COALESCE(pending_rv.created_at, active_rv.created_at) AS version_created_at,
                COALESCE(pending_rv.updated_at, active_rv.updated_at) AS version_updated_at,
                COALESCE(pending_rv.parsed_json, active_rv.parsed_json) AS parsed_json,
                COALESCE(pending_rv.raw_text, active_rv.raw_text) AS raw_text,
                COALESCE(pending_rv.review_status, active_rv.review_status) AS version_review_status,
                COALESCE(pending_rv.state, active_rv.state) AS version_state,
                COALESCE(pending_rv.approved_at, active_rv.approved_at) AS approved_at,
                COALESCE(pending_rv.check_total, active_rv.check_total) AS cached_check_total,
                COALESCE(pending_rv.check_visual, active_rv.check_visual) AS cached_check_visual,
                COALESCE(pending_rv.check_structure, active_rv.check_structure) AS cached_check_structure,
                COALESCE(pending_rv.check_quality, active_rv.check_quality) AS cached_check_quality,
                COALESCE(pending_rv.checks_updated_at, active_rv.checks_updated_at) AS cached_checks_updated_at,
                ROW_NUMBER() OVER (
                    PARTITION BY r.region_id
                    ORDER BY
                        (pending_rv.id IS NOT NULL) DESC,
                        (active_rv.id IS NOT NULL) DESC,
                        r.updated_at DESC,
                        r.id DESC
                ) AS rn
            FROM reports r
            LEFT JOIN regions reg ON reg.id = r.region_id
            LEFT JOIN report_versions active_rv ON active_rv.id = r.active_version_id
            LEFT JOIN LATERAL (
                SELECT
                    rv.id,
                    rv.file_name,
                    rv.file_size,
                    rv.created_at,
                    rv.updated_at,
                    rv.parsed_json,
                    rv.raw_text,
                    rv.review_status,
                    rv.state,
                    rv.approved_at,
                    rv.check_total,
                    rv.check_visual,
                    rv.check_structure,
                    rv.check_quality,
                    rv.checks_updated_at
                FROM report_versions rv
                WHERE rv.report_id = r.id
                  AND rv.review_status = 'pending_review'
                ORDER BY rv.created_at DESC, rv.id DESC
                LIMIT 1
            ) pending_rv ON true
            WHERE r.region_id = ANY($1::bigint[]) AND r.year = $2
        )
        SELECT
            rr.*,
            pr.id AS parse_run_id,
            pr.status AS parse_run_status,
            pr.created_at AS parse_created_at,
            pr.started_at AS parse_started_at,
            pr.finished_at AS parse_finished_at,
            pr.accepted_at AS parse_accepted_at,
            pr.error_code AS parse_error_code,
            pr.error_message AS parse_error_message,
            j.id AS latest_job_id,
            j.kind AS latest_job_kind,
            j.status AS latest_job_status,
            j.progress AS latest_job_progress,
            j.error_code AS latest_job_error_code,
            j.error_message AS latest_job_error_message,
            COALESCE(j.finished_at, j.started_at, j.created_at) AS latest_job_updated_at,
            ci.open_issue_count,
            ci.pending_issue_count,
            ci.confirmed_issue_count,
            ci.dismissed_issue_count,
            ci.table2_issue_count,
            ci.table3_issue_count,
            ci.table4_issue_count,
            ci.structure_issue_count,
            ci.visual_issue_count,
            ci.quality_issue_count,
            ci.text_issue_count,
            ci.abnormal_types
        FROM ranked_reports rr
        LEFT JOIN LATERAL (
            SELECT pr.*
            FROM parse_runs pr
            WHERE pr.report_version_id = rr.effective_version_id
            ORDER BY pr.created_at DESC, pr.id DESC
            LIMIT 1
        ) pr ON true
        LEFT JOIN LATERAL (
            SELECT j.*
            FROM jobs j
            WHERE j.report_id = rr.report_id
            ORDER BY j.id DESC
            LIMIT 1
        ) j ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                ) AS open_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') = 'pending'
                ) AS pending_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND human_status = 'confirmed'
                ) AS confirmed_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND human_status = 'dismissed'
                ) AS dismissed_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'table2'
                ) AS table2_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'table3'
                ) AS table3_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'table4'
                ) AS table4_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'structure'
                ) AS structure_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'visual'
                ) AS visual_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'quality'
                ) AS quality_issue_count,
                COUNT(*) FILTER (
                    WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                      AND auto_status IN ('FAIL', 'UNCERTAIN')
                      AND COALESCE(human_status, 'pending') != 'dismissed'
                      AND group_key = 'text'
                ) AS text_issue_count,
                COALESCE(
                    ARRAY_AGG(DISTINCT group_key) FILTER (
                        WHERE ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
                          AND auto_status IN ('FAIL', 'UNCERTAIN')
                          AND COALESCE(human_status, 'pending') != 'dismissed'
                    ),
                    ARRAY[]::varchar[]
                ) AS abnormal_types
            FROM report_consistency_items ci
            WHERE ci.report_version_id = rr.effective_version_id
        ) ci ON true
        WHERE rr.rn = 1
    `;

    const reportsResult = await pool.query(reportsQuery, [regionIds, year]);
    const reportsByRegion = new Map<string, any>();
    for (const row of reportsResult.rows) {
        reportsByRegion.set(toRegionKey(row.region_id), row);
    }
    return reportsByRegion;
};

const mapParseStatus = (report: any, legacyStatus: string | null): string => {
    if (!report) return 'not_uploaded';

    const jobKind = String(report.latest_job_kind || '');
    const jobStatus = String(report.latest_job_status || '');
    if (jobKind === 'parse' && ['queued', 'running'].includes(jobStatus)) {
        return jobStatus === 'queued' ? 'pending' : 'running';
    }

    const parseRunStatus = String(report.parse_run_status || '');
    if (parseRunStatus === 'running') return 'running';
    if (parseRunStatus === 'created') return 'pending';
    if (['failed', 'gate_failed', 'finalize_failed'].includes(parseRunStatus)) return 'failed';
    if (legacyStatus === 'empty' || legacyStatus === 'text_empty') return 'failed';
    if (parseRunStatus === 'accepted') return 'success';

    if (jobKind === 'parse' && jobStatus === 'failed') return 'failed';

    const parsed = parseDbJson(report.parsed_json);
    if (hasParsedContentForMaintenance(parsed)) return 'success';
    if (report.effective_version_id) return 'pending';
    return 'not_uploaded';
};

const mapCompareStatus = (report: any, abnormalCount: number | null): string => {
    if (!report?.effective_version_id) return 'not_compared';
    if (!report.cached_checks_updated_at && abnormalCount === null) return 'not_compared';
    return Number(abnormalCount || 0) > 0 ? 'abnormal' : 'normal';
};

const mapReviewStatus = (report: any, pendingIssueCount: number | null, parseStatus: string): string => {
    if (!report?.effective_version_id) return 'none';
    if (parseStatus === 'failed' || Number(pendingIssueCount || 0) > 0) return 'pending_review';
    const versionStatus = String(report.version_review_status || '');
    if (versionStatus === 'published') return 'archived';
    if (versionStatus === 'pending_review') return 'pending_review';
    if (versionStatus === 'history') return 'returned';
    return 'passed';
};

const mapMaintenanceStatus = (
    uploadStatus: string,
    parseStatus: string,
    compareStatus: string,
    reviewStatus: string
): string => {
    if (uploadStatus === 'not_uploaded') return 'not_uploaded';
    if (parseStatus === 'failed') return 'parse_failed';
    if (reviewStatus === 'pending_review') return 'pending_review';
    if (reviewStatus === 'archived' || reviewStatus === 'passed') return 'completed';
    if (compareStatus === 'abnormal') return 'compare_abnormal';
    return 'in_progress';
};

const buildMaintenanceRows = async (regions: RegionRow[], year: number): Promise<MaintenanceDetailRow[]> => {
    const reportsByRegion = await buildReportRows(regions, year);
    const { buildParentPath, getParentName } = buildRegionHelpers(regions);

    const rows = regions.map((region) => {
        const report = reportsByRegion.get(toRegionKey(region.id));
        const legacyStatus = getReportMaintenanceStatus(report as MaintenanceReportRow | undefined);
        const uploadStatus = report ? 'uploaded' : 'not_uploaded';
        const hasCompareEvidence = Boolean(
            report?.cached_checks_updated_at
            || Number(report?.open_issue_count || 0) > 0
            || Number(report?.cached_check_total || 0) > 0
        );
        const abnormalCount = report?.effective_version_id && hasCompareEvidence
            ? toInteger(report.open_issue_count ?? report.cached_check_total, 0)
            : null;
        const pendingIssueCount = report?.effective_version_id && hasCompareEvidence
            ? toInteger(report.pending_issue_count, 0)
            : null;
        const parseStatus = mapParseStatus(report, legacyStatus);
        const compareStatus = mapCompareStatus(report, abnormalCount);
        const reviewStatus = mapReviewStatus(report, pendingIssueCount, parseStatus);
        const maintenanceStatus = mapMaintenanceStatus(uploadStatus, parseStatus, compareStatus, reviewStatus);
        const abnormalTypes = Array.isArray(report?.abnormal_types)
            ? report.abnormal_types.filter(Boolean).map(String)
            : [];

        return {
            region_id: Number(region.id),
            region_name: region.name,
            region_code: region.code || null,
            level: Number(region.level),
            parent_region_id: region.parent_id ? Number(region.parent_id) : null,
            parent_unit_name: getParentName(region),
            parent_path: buildParentPath(Number(region.id)),
            year,
            report_id: report?.report_id ? Number(report.report_id) : null,
            unit_id: Number(region.id),
            unit_name: report?.unit_name || region.name,
            upload_status: uploadStatus,
            parse_status: parseStatus,
            compare_status: compareStatus,
            abnormal_count: abnormalCount,
            abnormal_types: abnormalTypes,
            review_status: reviewStatus,
            archive_status: reviewStatus === 'archived' || reviewStatus === 'passed' ? 'archived' : 'not_archived',
            maintenance_status: maintenanceStatus,
            file_name: report?.file_name || null,
            file_size: report?.file_size ? Number(report.file_size) : null,
            upload_time: toIsoStringOrNull(report?.version_created_at || report?.report_created_at),
            parse_time: toIsoStringOrNull(report?.parse_accepted_at || report?.parse_finished_at || report?.parse_started_at),
            compare_time: toIsoStringOrNull(report?.cached_checks_updated_at),
            reviewed_at: toIsoStringOrNull(report?.approved_at),
            archived_at: toIsoStringOrNull(report?.approved_at),
            updated_at: toIsoStringOrNull(report?.version_updated_at || report?.report_updated_at),
            latest_job: report?.latest_job_id
                ? {
                    job_id: Number(report.latest_job_id),
                    kind: String(report.latest_job_kind || ''),
                    status: String(report.latest_job_status || ''),
                    progress: report.latest_job_progress == null ? null : Number(report.latest_job_progress),
                    error_code: report.latest_job_error_code || null,
                    error_message: report.latest_job_error_message || null,
                    updated_at: toIsoStringOrNull(report.latest_job_updated_at),
                }
                : null,
        } as MaintenanceDetailRow;
    });

    rows.sort((a, b) => {
        const priority: Record<string, number> = {
            parse_failed: 0,
            pending_review: 1,
            compare_abnormal: 2,
            not_uploaded: 3,
            in_progress: 4,
            completed: 5,
        };
        const statusDiff = (priority[a.maintenance_status] ?? 99) - (priority[b.maintenance_status] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        const levelDiff = a.level - b.level;
        if (levelDiff !== 0) return levelDiff;
        return a.unit_name.localeCompare(b.unit_name, 'zh-Hans-CN');
    });

    return rows;
};

const summarizeRows = (rows: MaintenanceDetailRow[]) => {
    const total = rows.length;
    const uploaded = rows.filter((row) => row.upload_status === 'uploaded').length;
    const parseSuccess = rows.filter((row) => row.parse_status === 'success').length;
    const parseFailed = rows.filter((row) => row.parse_status === 'failed').length;
    const compareAbnormal = rows.filter((row) => row.compare_status === 'abnormal').length;
    const pendingReview = rows.filter((row) => row.review_status === 'pending_review').length;
    const archived = rows.filter((row) => row.review_status === 'archived' || row.review_status === 'passed').length;
    const notUploaded = total - uploaded;

    return {
        total,
        maintenance_total: total,
        uploaded_count: uploaded,
        parse_success_count: parseSuccess,
        parse_failed_count: parseFailed,
        compare_abnormal_count: compareAbnormal,
        pending_review_count: pendingReview,
        archived_count: archived,
        not_uploaded_count: notUploaded,
        missing_count: notUploaded,
        empty_count: parseFailed,
        text_empty_count: rows.filter((row) => row.parse_status === 'failed' && row.upload_status === 'uploaded').length,
        issue_total: rows.reduce((sum, row) => sum + Number(row.abnormal_count || 0), 0),
    };
};

const filterRowsForExport = (rows: MaintenanceDetailRow[], scope: ExportScope): MaintenanceDetailRow[] => {
    if (scope === 'abnormal') {
        return rows.filter((row) => (
            row.upload_status === 'not_uploaded'
            || row.parse_status === 'failed'
            || row.compare_status === 'abnormal'
            || row.review_status === 'pending_review'
        ));
    }
    if (scope === 'review') {
        return rows.filter((row) => row.review_status === 'pending_review');
    }
    return rows;
};

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;

const getExportScope = (raw: unknown): ExportScope => {
    const scope = String(raw || 'abnormal').trim();
    if (scope === 'all' || scope === 'review' || scope === 'abnormal') {
        return scope;
    }
    return 'abnormal';
};

router.get('/', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const year = validateYear(req.query.year);
        if (!year) {
            return res.status(400).json({ error: '年份参数 (year) 必填且必须有效' });
        }

        const regionId = validateRegionId(req.query.region_id);
        if (Number.isNaN(regionId)) {
            return res.status(400).json({ error: '无效的区域ID' });
        }

        const allowedRegionIds = await getAllowedRegionIds(req);
        const regions = await loadRegions(regionId, allowedRegionIds);

        if (regions.length === 0) {
            return res.json({
                data: {
                    year,
                    summary: summarizeRows([]),
                    total: 0,
                    maintenance_total: 0,
                    missing_count: 0,
                    empty_count: 0,
                    text_empty_count: 0,
                    regions: [],
                },
            });
        }

        const rows = await buildMaintenanceRows(regions, year);
        const summary = summarizeRows(rows);

        return res.json({
            data: {
                year,
                ...summary,
                summary,
                regions: rows,
            },
        });
    } catch (error: any) {
        console.error('[ReportMaintenance] Error:', error);
        return res.status(500).json({ error: '获取年报维护数据失败: ' + error.message });
    }
});

router.get('/export', authMiddleware, async (req: AuthRequest, res) => {
    try {
        const year = validateYear(req.query.year);
        if (!year) {
            return res.status(400).json({ error: '年份参数 (year) 必填且必须有效' });
        }

        const regionId = validateRegionId(req.query.region_id);
        if (Number.isNaN(regionId)) {
            return res.status(400).json({ error: '无效的区域ID' });
        }

        const scope = getExportScope(req.query.scope);
        const allowedRegionIds = await getAllowedRegionIds(req);
        const regions = await loadRegions(regionId, allowedRegionIds);
        const rows = filterRowsForExport(await buildMaintenanceRows(regions, year), scope);

        const headers = [
            '序号',
            '单位名称',
            '地区',
            '层级',
            '上级单位',
            '年份',
            '上传状态',
            '解析状态',
            '比对状态',
            '异常数',
            '异常类型',
            '复核状态',
            '最后更新时间',
            '报告ID',
        ];

        const csvRows = rows.map((row, idx) => [
            idx + 1,
            row.unit_name,
            row.region_name,
            getLevelName(row.level),
            row.parent_unit_name || row.parent_path || '--',
            row.year,
            row.upload_status === 'uploaded' ? '已上传' : '未上传',
            parseStatusLabel(row.parse_status),
            compareStatusLabel(row.compare_status),
            row.abnormal_count ?? '--',
            row.abnormal_types.join('、') || '--',
            reviewStatusLabel(row.review_status),
            row.updated_at || '--',
            row.report_id || '--',
        ]);

        const BOM = '\uFEFF';
        const csvContent = BOM + [
            headers.map(csvCell).join(','),
            ...csvRows.map((row) => row.map(csvCell).join(',')),
        ].join('\n');

        const scopeLabel = scope === 'all' ? '全部' : scope === 'review' ? '待复核' : '异常';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="report_maintenance_${year}_${scope}.csv"`);
        res.setHeader('X-Export-Name', encodeURIComponent(`年报维护_${year}年_${scopeLabel}.csv`));
        return res.send(csvContent);
    } catch (error: any) {
        console.error('[ReportMaintenance] Export error:', error);
        return res.status(500).json({ error: '导出失败: ' + error.message });
    }
});

function getLevelName(level: number): string {
    switch (Number(level)) {
        case 0:
        case 1: return '省级';
        case 2: return '市级';
        case 3: return '区县级';
        case 4: return '街道/乡镇';
        default: return `Level ${level}`;
    }
}

function parseStatusLabel(status: string): string {
    switch (status) {
        case 'not_uploaded': return '未上传';
        case 'pending': return '待解析';
        case 'running': return '解析中';
        case 'success': return '解析成功';
        case 'failed': return '解析失败';
        default: return status || '--';
    }
}

function compareStatusLabel(status: string): string {
    switch (status) {
        case 'not_compared': return '未比对';
        case 'normal': return '无异常';
        case 'abnormal': return '有异常';
        default: return status || '--';
    }
}

function reviewStatusLabel(status: string): string {
    switch (status) {
        case 'none': return '未进入复核';
        case 'pending_review': return '待复核';
        case 'passed': return '复核通过';
        case 'returned': return '已退回';
        case 'archived': return '已归档';
        default: return status || '--';
    }
}

export default router;
