import crypto from 'crypto';
import pool from '../config/database-llm';

// Types for parsed JSON structure
interface EntityResults {
    granted?: number | string;
    partialGrant?: number | string;
    denied?: {
        stateSecret?: number | string;
        lawForbidden?: number | string;
        safetyStability?: number | string;
        thirdPartyRights?: number | string;
        internalAffairs?: number | string;
        processInfo?: number | string;
        enforcementCase?: number | string;
        adminQuery?: number | string;
    };
    unableToProvide?: {
        noInfo?: number | string;
        needCreation?: number | string;
        unclear?: number | string;
    };
    notProcessed?: {
        complaint?: number | string;
        repeat?: number | string;
        publication?: number | string;
        massiveRequests?: number | string;
        confirmInfo?: number | string;
    };
    other?: {
        overdueCorrection?: number | string;
        overdueFee?: number | string;
        otherReasons?: number | string;
    };
    totalProcessed?: number | string;
    carriedForward?: number | string;
}

interface EntityData {
    newReceived?: number | string;
    carriedOver?: number | string;
    results?: EntityResults;
}

interface Table3Data {
    naturalPerson?: EntityData;
    legalPerson?: {
        commercial?: EntityData;
        research?: EntityData;
        social?: EntityData;
        legal?: EntityData;
        other?: EntityData;
    };
    total?: EntityData;
}

interface Table4Category {
    maintain?: number | string;
    correct?: number | string;
    other?: number | string;
    unfinished?: number | string;
    total?: number | string;
}

interface Table4Data {
    review?: Table4Category;
    litigationDirect?: Table4Category;
    litigationPostReview?: Table4Category;
}

export type AutoStatus = 'PASS' | 'FAIL' | 'UNCERTAIN' | 'NOT_ASSESSABLE';
export type HumanStatus = 'pending' | 'confirmed' | 'dismissed';
export type GroupKey = 'table2' | 'table3' | 'table4' | 'text' | 'visual' | 'structure' | 'quality' | 'hierarchy';

export interface ConsistencyItem {
    groupKey: GroupKey;
    checkKey: string;
    fingerprint: string;
    title: string;
    expr: string;
    leftValue: number | null;
    rightValue: number | null;
    delta: number | null;
    tolerance: number;
    autoStatus: AutoStatus;
    evidenceJson: {
        paths: string[];
        leftPaths?: string[];  // 左值数据来源路径
        rightPaths?: string[]; // 右值数据来源路径
        values: Record<string, any>;
        textMatches?: Array<{ text: string; position?: number }>;
    };
}

export interface ConsistencySummaryCounts {
    fail: number;
    uncertain: number;
    pass: number;
    notAssessable: number;
}

export interface ConsistencyHumanSummaryCounts {
    pending: number;
    confirmed: number;
    dismissed: number;
}

export interface ConsistencyActiveSummaryCounts {
    rawFailCount: number;
    activeProblemCount: number;
    reviewCount: number;
}

export interface ConsistencySummaryBucket extends ConsistencySummaryCounts, ConsistencyHumanSummaryCounts, ConsistencyActiveSummaryCounts {
    total: number;
}

export interface ConsistencyRunSummary extends ConsistencySummaryCounts {
    total: number;
    auto: ConsistencySummaryCounts;
    human: ConsistencyHumanSummaryCounts;
    active: ConsistencyActiveSummaryCounts;
    byGroupKey: Record<string, ConsistencySummaryBucket>;
}

type ConsistencySummarySourceItem = {
    groupKey?: string | null;
    group_key?: string | null;
    autoStatus?: string | null;
    auto_status?: string | null;
    humanStatus?: string | null;
    human_status?: string | null;
};

const ENGINE_VERSION = 'v2';

interface TextPattern {
    regex: RegExp;
    field: string;
    table: 'table3' | 'table4';
    path: string;
    getValue: () => number | null;
    name: string;
    extract?: (content: string) => RegExpMatchArray | null;
}

interface Table2ThreeCountRow {
    made?: number | string | null;
    repealed?: number | string | null;
    valid?: number | string | null;
}

interface Table2ProcessedRow {
    processed?: number | string | null;
}

interface Table2FeeRow {
    amount?: number | string | null;
}

interface Table2Data {
    regulations?: Table2ThreeCountRow | null;
    normativeDocuments?: Table2ThreeCountRow | null;
    licensing?: Table2ProcessedRow | null;
    punishment?: Table2ProcessedRow | null;
    coercion?: Table2ProcessedRow | null;
    fees?: Table2FeeRow | null;
}

type Table2ValueSemantic = 'EMPTY' | 'ZERO' | 'NA' | 'TEXT' | 'NUMERIC';

interface Table2FieldAnalysis {
    raw: number | string | null;
    normalized: number | null;
    semantic: Table2ValueSemantic;
}

interface Table2FieldConfig {
    rowKey: 'regulations' | 'normativeDocuments' | 'licensing' | 'punishment' | 'coercion' | 'fees';
    columnKey: 'made' | 'repealed' | 'valid' | 'processed' | 'amount';
    fieldPath: string;
    fieldLabel: string;
    checkKeySuffix: string;
    kind: 'count' | 'amount';
}

interface HierarchyReportContext {
    reportId: number;
    versionId: number;
    regionId: number;
    regionName: string;
    regionLevel: number | null;
    unitName: string;
    year: number;
}

interface HierarchyChildReportContext {
    regionId: number;
    regionName: string;
    regionLevel: number | null;
    sortOrder: number | null;
    reportId: number | null;
    versionId: number | null;
    unitName: string | null;
}

interface HierarchyMetricValue {
    source: 'parent' | 'child';
    reportId: number;
    versionId: number;
    regionId: number;
    regionName: string;
    metricKey: string;
    metricLabel: string;
    tableLabel: string;
    value: number | null;
}

interface HierarchyMetricBucket {
    metricKey: string;
    metricLabel: string;
    tableLabel: string;
    parentValue: number | null;
    childValues: HierarchyMetricValue[];
}

const HIERARCHY_ACTIVE_CATEGORY_LABELS: Record<string, string> = {
    regulations: '规章',
    normative_documents: '行政规范性文件',
    licensing: '行政许可',
    punishment: '行政处罚',
    coercion: '行政强制',
    fees: '行政事业性收费',
};

const HIERARCHY_ACTIVE_FIELD_LABELS: Record<string, string> = {
    made_count: '本年制发件数',
    repealed_count: '本年废止件数',
    valid_count: '现行有效件数',
    processed_count: '处理决定数量',
    amount: '收费金额',
};

const HIERARCHY_APPLICATION_APPLICANT_LABELS: Record<string, string> = {
    natural_person: '自然人',
    legal_person_commercial: '商业企业',
    legal_person_research: '科研机构',
    legal_person_social: '社会公益组织',
    legal_person_legal: '法律服务机构',
    legal_person_other: '其他组织',
    total: '合计',
};

const HIERARCHY_APPLICATION_RESPONSE_LABELS: Record<string, string> = {
    new_received: '本年新收',
    carried_over: '上年结转',
    granted: '予以公开',
    partial_grant: '部分公开',
    denied_state_secret: '不予公开-国家秘密',
    denied_law_forbidden: '不予公开-法律行政法规禁止',
    denied_safety_stability: '不予公开-三安全一稳定',
    denied_third_party_rights: '不予公开-第三方合法权益',
    denied_internal_affairs: '不予公开-内部事务信息',
    denied_process_info: '不予公开-过程性信息',
    denied_enforcement_case: '不予公开-行政执法案卷',
    denied_admin_query: '不予公开-行政查询事项',
    unable_no_info: '无法提供-本机关不掌握',
    unable_need_creation: '无法提供-需另行制作',
    unable_unclear: '无法提供-补正后仍不明确',
    not_processed_complaint: '不予处理-信访举报投诉',
    not_processed_repeat: '不予处理-重复申请',
    not_processed_publication: '不予处理-公开出版物',
    not_processed_massive_requests: '不予处理-大量反复申请',
    not_processed_confirm_info: '不予处理-确认或重新出具',
    other_overdue_correction: '其他处理-逾期未补正',
    other_overdue_fee: '其他处理-逾期未缴费',
    other_other_reasons: '其他处理-其他',
    total_processed: '办理结果总计',
    carried_forward: '结转下年度继续办理',
};

const HIERARCHY_LEGAL_CASE_LABELS: Record<string, string> = {
    review: '行政复议',
    litigation_direct: '未经复议直接起诉',
    litigation_post_review: '复议后起诉',
};

const HIERARCHY_LEGAL_RESULT_LABELS: Record<string, string> = {
    maintain: '结果维持',
    correct: '结果纠正',
    other: '其他结果',
    unfinished: '尚未审结',
    total: '总计',
};

function createEmptySummaryBucket(): ConsistencySummaryBucket {
    return {
        total: 0,
        fail: 0,
        uncertain: 0,
        pass: 0,
        notAssessable: 0,
        pending: 0,
        confirmed: 0,
        dismissed: 0,
        rawFailCount: 0,
        activeProblemCount: 0,
        reviewCount: 0,
    };
}

function getSummaryItemGroupKey(item: ConsistencySummarySourceItem): string {
    return String(item.groupKey || item.group_key || 'unknown');
}

function getSummaryItemAutoStatus(item: ConsistencySummarySourceItem): AutoStatus | null {
    const status = item.autoStatus || item.auto_status;
    return status === 'FAIL' || status === 'UNCERTAIN' || status === 'PASS' || status === 'NOT_ASSESSABLE'
        ? status
        : null;
}

function getSummaryItemHumanStatus(item: ConsistencySummarySourceItem): HumanStatus {
    const status = item.humanStatus || item.human_status;
    return status === 'confirmed' || status === 'dismissed' ? status : 'pending';
}

function applySummaryItem(bucket: ConsistencySummaryBucket, item: ConsistencySummarySourceItem): void {
    const autoStatus = getSummaryItemAutoStatus(item);
    const humanStatus = getSummaryItemHumanStatus(item);

    bucket.total += 1;

    if (autoStatus === 'FAIL') {
        bucket.fail += 1;
        bucket.rawFailCount += 1;
        if (humanStatus !== 'dismissed') {
            bucket.activeProblemCount += 1;
        }
    } else if (autoStatus === 'UNCERTAIN') {
        bucket.uncertain += 1;
    } else if (autoStatus === 'PASS') {
        bucket.pass += 1;
    } else if (autoStatus === 'NOT_ASSESSABLE') {
        bucket.notAssessable += 1;
    }

    if (humanStatus === 'confirmed') {
        bucket.confirmed += 1;
    } else if (humanStatus === 'dismissed') {
        bucket.dismissed += 1;
    } else {
        bucket.pending += 1;
    }

    if (humanStatus === 'pending' && autoStatus !== 'NOT_ASSESSABLE') {
        bucket.reviewCount += 1;
    }
}

export function buildConsistencyRunSummary(items: ConsistencySummarySourceItem[]): ConsistencyRunSummary {
    const overall = createEmptySummaryBucket();
    const byGroupKey: Record<string, ConsistencySummaryBucket> = {};

    items.forEach((item) => {
        applySummaryItem(overall, item);

        const groupKey = getSummaryItemGroupKey(item);
        if (!byGroupKey[groupKey]) {
            byGroupKey[groupKey] = createEmptySummaryBucket();
        }
        applySummaryItem(byGroupKey[groupKey], item);
    });

    return {
        fail: overall.fail,
        uncertain: overall.uncertain,
        pass: overall.pass,
        notAssessable: overall.notAssessable,
        total: overall.total,
        auto: {
            fail: overall.fail,
            uncertain: overall.uncertain,
            pass: overall.pass,
            notAssessable: overall.notAssessable,
        },
        human: {
            pending: overall.pending,
            confirmed: overall.confirmed,
            dismissed: overall.dismissed,
        },
        active: {
            rawFailCount: overall.rawFailCount,
            activeProblemCount: overall.activeProblemCount,
            reviewCount: overall.reviewCount,
        },
        byGroupKey,
    };
}

export class ConsistencyCheckService {
    private readonly table2FieldConfigs: Table2FieldConfig[] = [
        { rowKey: 'regulations', columnKey: 'made', fieldPath: 'activeDisclosureData.regulations.made', fieldLabel: '规章-本年制发件数', checkKeySuffix: 'regulations_made', kind: 'count' },
        { rowKey: 'regulations', columnKey: 'repealed', fieldPath: 'activeDisclosureData.regulations.repealed', fieldLabel: '规章-本年废止件数', checkKeySuffix: 'regulations_repealed', kind: 'count' },
        { rowKey: 'regulations', columnKey: 'valid', fieldPath: 'activeDisclosureData.regulations.valid', fieldLabel: '规章-现行有效件数', checkKeySuffix: 'regulations_valid', kind: 'count' },
        { rowKey: 'normativeDocuments', columnKey: 'made', fieldPath: 'activeDisclosureData.normativeDocuments.made', fieldLabel: '行政规范性文件-本年制发件数', checkKeySuffix: 'normativeDocuments_made', kind: 'count' },
        { rowKey: 'normativeDocuments', columnKey: 'repealed', fieldPath: 'activeDisclosureData.normativeDocuments.repealed', fieldLabel: '行政规范性文件-本年废止件数', checkKeySuffix: 'normativeDocuments_repealed', kind: 'count' },
        { rowKey: 'normativeDocuments', columnKey: 'valid', fieldPath: 'activeDisclosureData.normativeDocuments.valid', fieldLabel: '行政规范性文件-现行有效件数', checkKeySuffix: 'normativeDocuments_valid', kind: 'count' },
        { rowKey: 'licensing', columnKey: 'processed', fieldPath: 'activeDisclosureData.licensing.processed', fieldLabel: '行政许可-处理决定数量', checkKeySuffix: 'licensing_processed', kind: 'count' },
        { rowKey: 'punishment', columnKey: 'processed', fieldPath: 'activeDisclosureData.punishment.processed', fieldLabel: '行政处罚-处理决定数量', checkKeySuffix: 'punishment_processed', kind: 'count' },
        { rowKey: 'coercion', columnKey: 'processed', fieldPath: 'activeDisclosureData.coercion.processed', fieldLabel: '行政强制-处理决定数量', checkKeySuffix: 'coercion_processed', kind: 'count' },
        { rowKey: 'fees', columnKey: 'amount', fieldPath: 'activeDisclosureData.fees.amount', fieldLabel: '行政事业性收费-收费金额', checkKeySuffix: 'fees_amount', kind: 'amount' },
    ];
    /**
     * Parse a number from various formats: number, string, "-", "—", "", null
     */
    private parseNumber(value: any): number | null {
        if (value === null || value === undefined) return null;
        if (typeof value === 'number') return isNaN(value) ? null : value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed === '' || trimmed === '-' || trimmed === '—' || trimmed === '/' || trimmed === 'N/A') {
                return null;
            }
            const parsed = parseFloat(trimmed.replace(/,/g, ''));
            return isNaN(parsed) ? null : parsed;
        }
        return null;
    }

    private getTable2CellRef(config: Table2FieldConfig): string {
        const rowMap: Record<Table2FieldConfig['rowKey'], string> = {
            regulations: 'regulations',
            normativeDocuments: 'normative_documents',
            licensing: 'licensing',
            punishment: 'punishment',
            coercion: 'coercion',
            fees: 'fees',
        };
        return `active_disclosure:${rowMap[config.rowKey]}:${config.columnKey}`;
    }

    private analyzeTable2Value(rawValue: any): Table2FieldAnalysis {
        if (rawValue === null || rawValue === undefined) {
            return { raw: null, normalized: null, semantic: 'EMPTY' };
        }

        if (typeof rawValue === 'number') {
            if (!Number.isFinite(rawValue)) return { raw: rawValue, normalized: null, semantic: 'TEXT' };
            if (rawValue === 0) return { raw: rawValue, normalized: 0, semantic: 'ZERO' };
            return { raw: rawValue, normalized: rawValue, semantic: 'NUMERIC' };
        }

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (trimmed === '') return { raw: rawValue, normalized: null, semantic: 'EMPTY' };

            const normalizedPlaceholder = trimmed.toUpperCase();
            if (
                trimmed === '/' ||
                trimmed === '-' ||
                trimmed === '—' ||
                trimmed === '--' ||
                trimmed === '不适用' ||
                normalizedPlaceholder === 'N/A' ||
                normalizedPlaceholder === 'NA'
            ) {
                return { raw: rawValue, normalized: null, semantic: 'NA' };
            }

            const compact = trimmed.replace(/,/g, '');
            if (/^[+-]?\d+(?:\.\d+)?$/.test(compact)) {
                const parsed = Number(compact);
                if (!Number.isFinite(parsed)) return { raw: rawValue, normalized: null, semantic: 'TEXT' };
                if (parsed === 0) return { raw: rawValue, normalized: 0, semantic: 'ZERO' };
                return { raw: rawValue, normalized: parsed, semantic: 'NUMERIC' };
            }

            return { raw: rawValue, normalized: null, semantic: 'TEXT' };
        }

        return { raw: String(rawValue), normalized: null, semantic: 'TEXT' };
    }

    private createTable2RuleItem(
        checkKey: string,
        title: string,
        expr: string,
        autoStatus: AutoStatus,
        config: Table2FieldConfig,
        analysis: Table2FieldAnalysis,
        reason: string,
        compareTarget: number | null = null
    ): ConsistencyItem {
        const leftValue = analysis.normalized;
        const rightValue = compareTarget;
        const delta = leftValue !== null && rightValue !== null ? leftValue - rightValue : null;

        return {
            groupKey: 'table2',
            checkKey,
            fingerprint: this.generateFingerprint('table2', checkKey, expr),
            title,
            expr,
            leftValue,
            rightValue,
            delta,
            tolerance: 0,
            autoStatus,
            evidenceJson: {
                paths: [config.fieldPath],
                rightPaths: [config.fieldPath],
                values: {
                    tableId: 'table_2',
                    fieldPath: config.fieldPath,
                    cell_ref: this.getTable2CellRef(config),
                    raw: analysis.raw,
                    normalized: analysis.normalized,
                    semantic: analysis.semantic,
                    auto_status: autoStatus,
                    reason,
                },
            },
        };
    }

    private hasTable2ApplicableFields(table2Data: Table2Data | undefined): boolean {
        if (!table2Data || typeof table2Data !== 'object') return false;
        return this.table2FieldConfigs.some((config) => {
            const row = (table2Data as any)?.[config.rowKey];
            return Boolean(row && Object.prototype.hasOwnProperty.call(row, config.columnKey));
        });
    }

    private generateTable2Items(table2Data: Table2Data | undefined): { items: ConsistencyItem[]; hasApplicableFields: boolean } {
        const items: ConsistencyItem[] = [];
        const hasApplicableFields = this.hasTable2ApplicableFields(table2Data);

        if (!table2Data || typeof table2Data !== 'object') {
            return { items, hasApplicableFields };
        }

        for (const config of this.table2FieldConfigs) {
            const row = (table2Data as any)?.[config.rowKey];
            if (!row || !Object.prototype.hasOwnProperty.call(row, config.columnKey)) continue;

            const analysis = this.analyzeTable2Value(row[config.columnKey]);

            if (analysis.semantic === 'EMPTY' || analysis.semantic === 'NA') {
                items.push(this.createTable2RuleItem(
                    `t2_empty_semantics_hint_${config.checkKeySuffix}`,
                    `表二：${config.fieldLabel}为空或为特殊占位`,
                    `${config.fieldPath} is meaningful numeric value or explicit zero`,
                    'UNCERTAIN',
                    config,
                    analysis,
                    'empty_or_placeholder_value'
                ));
                continue;
            }

            if (analysis.semantic === 'TEXT') {
                items.push(this.createTable2RuleItem(
                    config.kind === 'count'
                        ? `t2_numeric_parseable_counts_${config.checkKeySuffix}`
                        : `t2_numeric_parseable_fee_amount_${config.checkKeySuffix}`,
                    `表二：${config.fieldLabel}应可解析为数字`,
                    `${config.fieldPath} parseable as numeric`,
                    'UNCERTAIN',
                    config,
                    analysis,
                    config.kind === 'count' ? 'count_field_not_numeric' : 'fee_amount_not_numeric'
                ));
                continue;
            }

            if (analysis.normalized === null) continue;

            if (analysis.normalized < 0) {
                items.push(this.createTable2RuleItem(
                    config.kind === 'count'
                        ? `t2_non_negative_counts_${config.checkKeySuffix}`
                        : `t2_non_negative_fee_amount_${config.checkKeySuffix}`,
                    `表二：${config.fieldLabel}应为非负数`,
                    `${config.fieldPath} >= 0`,
                    'FAIL',
                    config,
                    analysis,
                    config.kind === 'count' ? 'count_field_negative' : 'fee_amount_negative',
                    0
                ));
            }

            if (config.kind === 'count' && !Number.isInteger(analysis.normalized)) {
                items.push(this.createTable2RuleItem(
                    `t2_integer_counts_${config.checkKeySuffix}`,
                    `表二：${config.fieldLabel}应为整数`,
                    `${config.fieldPath} is integer`,
                    'UNCERTAIN',
                    config,
                    analysis,
                    'count_field_not_integer'
                ));
            }
        }

        return { items, hasApplicableFields };
    }

    /**
     * Generate stable fingerprint for a check item
     */
    private generateFingerprint(groupKey: string, checkKey: string, expr: string): string {
        const input = `${groupKey}:${checkKey}:${expr}`;
        return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
    }

    /**
     * Sum all numeric values in an object
     */
    private sumObject(obj: Record<string, any> | undefined): number | null {
        if (!obj) return null;
        let hasValue = false;
        let sum = 0;
        for (const key of Object.keys(obj)) {
            const val = this.parseNumber(obj[key]);
            if (val !== null) {
                hasValue = true;
                sum += val;
            }
        }
        return hasValue ? sum : null;
    }

    private extractTotalProcessedTextMatch(content: string): RegExpMatchArray | null {
        if (!content) return null;

        const patterns = [
            /(?:答复|办结|办理结果(?:总计)?|处理结果(?:总计)?)(?:政府信息公开申请)?(?:总计|共计|共|数量)?\s*(\d+)\s*件/,
            /(?:办理结果(?:总计)?|处理结果(?:总计)?)(?:为|是|：|:)?\s*(\d+)\s*件/,
        ];

        for (const pattern of patterns) {
            const match = content.match(pattern);
            if (match) return match;
        }

        return null;
    }

    /**
     * Create an item with computed status based on left-right comparison
     */
    private createItem(
        groupKey: GroupKey,
        checkKey: string,
        title: string,
        expr: string,
        leftValue: number | null,
        rightValue: number | null,
        tolerance: number,
        paths: string[],
        values: Record<string, any>,
        leftPaths?: string[],   // Added
        rightPaths?: string[]   // Added
    ): ConsistencyItem {
        const fingerprint = this.generateFingerprint(groupKey, checkKey, expr);

        let autoStatus: AutoStatus;
        let delta: number | null = null;

        if (leftValue === null || rightValue === null) {
            autoStatus = 'UNCERTAIN';
        } else {
            delta = leftValue - rightValue;
            if (Math.abs(delta) <= tolerance) {
                autoStatus = 'PASS';
            } else {
                autoStatus = 'FAIL';
            }
        }

        return {
            groupKey,
            checkKey,
            fingerprint,
            title,
            expr,
            leftValue,
            rightValue,
            delta,
            tolerance,
            autoStatus,
            evidenceJson: { paths, values, leftPaths, rightPaths }, // Store distinct paths
        };
    }

    private createManualItem(
        groupKey: GroupKey,
        checkKey: string,
        title: string,
        expr: string,
        leftValue: number | null,
        rightValue: number | null,
        delta: number | null,
        tolerance: number,
        autoStatus: AutoStatus,
        paths: string[],
        values: Record<string, any>,
        leftPaths?: string[],
        rightPaths?: string[]
    ): ConsistencyItem {
        return {
            groupKey,
            checkKey,
            fingerprint: this.generateFingerprint(groupKey, checkKey, expr),
            title,
            expr,
            leftValue,
            rightValue,
            delta,
            tolerance,
            autoStatus,
            evidenceJson: { paths, values, leftPaths, rightPaths },
        };
    }

    private async loadHierarchyContext(reportVersionId: number): Promise<HierarchyReportContext | null> {
        const result = await pool.query(
            `SELECT
                r.id AS report_id,
                rv.id AS version_id,
                r.region_id,
                COALESCE(reg.name, r.unit_name, '') AS region_name,
                reg.level AS region_level,
                r.unit_name,
                r.year
             FROM report_versions rv
             JOIN reports r ON r.id = rv.report_id
             JOIN regions reg ON reg.id = r.region_id
             WHERE rv.id = $1
             LIMIT 1`,
            [reportVersionId]
        );

        const row = result.rows?.[0];
        if (!row) return null;

        return {
            reportId: Number(row.report_id),
            versionId: Number(row.version_id),
            regionId: Number(row.region_id),
            regionName: String(row.region_name || row.unit_name || row.region_id),
            regionLevel: row.region_level === null || row.region_level === undefined ? null : Number(row.region_level),
            unitName: String(row.unit_name || ''),
            year: Number(row.year),
        };
    }

    private async loadDirectChildReportContexts(context: HierarchyReportContext): Promise<HierarchyChildReportContext[]> {
        const result = await pool.query(
            `SELECT
                child.id AS region_id,
                child.name AS region_name,
                child.level AS region_level,
                child.sort_order,
                r.id AS report_id,
                rv.id AS version_id,
                r.unit_name
             FROM regions child
             LEFT JOIN reports r ON r.region_id = child.id AND r.year = $2
             LEFT JOIN report_versions rv ON rv.id = r.active_version_id
             WHERE child.parent_id = $1
             ORDER BY child.sort_order NULLS LAST, child.id ASC`,
            [context.regionId, context.year]
        );

        return (result.rows || []).map((row: any) => ({
            regionId: Number(row.region_id),
            regionName: String(row.region_name || row.region_id),
            regionLevel: row.region_level === null || row.region_level === undefined ? null : Number(row.region_level),
            sortOrder: row.sort_order === null || row.sort_order === undefined ? null : Number(row.sort_order),
            reportId: row.report_id === null || row.report_id === undefined ? null : Number(row.report_id),
            versionId: row.version_id === null || row.version_id === undefined ? null : Number(row.version_id),
            unitName: row.unit_name === null || row.unit_name === undefined ? null : String(row.unit_name),
        }));
    }

    private buildHierarchyMetricKey(tableName: string, parts: Array<string | number | null | undefined>): string {
        return [tableName, ...parts.map((part) => String(part || '').replace(/[^a-zA-Z0-9]+/g, '_'))]
            .filter(Boolean)
            .join('__');
    }

    private getHierarchyMetricBucket(
        buckets: Map<string, HierarchyMetricBucket>,
        metricKey: string,
        metricLabel: string,
        tableLabel: string
    ): HierarchyMetricBucket {
        let bucket = buckets.get(metricKey);
        if (!bucket) {
            bucket = {
                metricKey,
                metricLabel,
                tableLabel,
                parentValue: null,
                childValues: [],
            };
            buckets.set(metricKey, bucket);
        }
        return bucket;
    }

    private buildHierarchyValueFromRow(
        row: any,
        source: 'parent' | 'child',
        metricKey: string,
        metricLabel: string,
        tableLabel: string,
        value: unknown
    ): HierarchyMetricValue {
        return {
            source,
            reportId: Number(row.report_id),
            versionId: Number(row.version_id),
            regionId: Number(row.region_id),
            regionName: String(row.region_name || row.unit_name || row.region_id),
            metricKey,
            metricLabel,
            tableLabel,
            value: value === null || value === undefined ? null : Number(value),
        };
    }

    private async loadHierarchyMetricBuckets(
        context: HierarchyReportContext,
        childVersionIds: number[]
    ): Promise<Map<string, HierarchyMetricBucket>> {
        const buckets = new Map<string, HierarchyMetricBucket>();
        const versionIds = [context.versionId, ...childVersionIds];
        if (versionIds.length === 0) {
            return buckets;
        }

        const activeRows = await pool.query(
            `SELECT
                fad.report_id,
                fad.version_id,
                r.region_id,
                COALESCE(reg.name, r.unit_name, '') AS region_name,
                r.unit_name,
                fad.category,
                fad.made_count,
                fad.repealed_count,
                fad.valid_count,
                fad.processed_count,
                fad.amount
             FROM fact_active_disclosure fad
             JOIN reports r ON r.id = fad.report_id
             LEFT JOIN regions reg ON reg.id = r.region_id
             WHERE fad.version_id = ANY($1::bigint[])`,
            [versionIds]
        );

        for (const row of activeRows.rows || []) {
            const category = String(row.category || '');
            const categoryLabel = HIERARCHY_ACTIVE_CATEGORY_LABELS[category] || category;
            for (const column of ['made_count', 'repealed_count', 'valid_count', 'processed_count', 'amount']) {
                if (row[column] === null || row[column] === undefined) continue;
                const fieldLabel = HIERARCHY_ACTIVE_FIELD_LABELS[column] || column;
                const metricKey = this.buildHierarchyMetricKey('active', [category, column]);
                const metricLabel = `${categoryLabel}-${fieldLabel}`;
                const bucket = this.getHierarchyMetricBucket(buckets, metricKey, metricLabel, '表二');
                const source = Number(row.version_id) === context.versionId ? 'parent' : 'child';
                const metricValue = this.buildHierarchyValueFromRow(row, source, metricKey, metricLabel, '表二', row[column]);
                if (source === 'parent') {
                    bucket.parentValue = metricValue.value;
                } else {
                    bucket.childValues.push(metricValue);
                }
            }
        }

        const applicationRows = await pool.query(
            `SELECT
                fa.report_id,
                fa.version_id,
                r.region_id,
                COALESCE(reg.name, r.unit_name, '') AS region_name,
                r.unit_name,
                fa.applicant_type,
                fa.response_type,
                fa.count
             FROM fact_application fa
             JOIN reports r ON r.id = fa.report_id
             LEFT JOIN regions reg ON reg.id = r.region_id
             WHERE fa.version_id = ANY($1::bigint[])`,
            [versionIds]
        );

        for (const row of applicationRows.rows || []) {
            if (row.count === null || row.count === undefined) continue;
            const applicantType = String(row.applicant_type || '');
            const responseType = String(row.response_type || '');
            const applicantLabel = HIERARCHY_APPLICATION_APPLICANT_LABELS[applicantType] || applicantType;
            const responseLabel = HIERARCHY_APPLICATION_RESPONSE_LABELS[responseType] || responseType;
            const metricKey = this.buildHierarchyMetricKey('application', [applicantType, responseType]);
            const metricLabel = `${applicantLabel}-${responseLabel}`;
            const bucket = this.getHierarchyMetricBucket(buckets, metricKey, metricLabel, '表三');
            const source = Number(row.version_id) === context.versionId ? 'parent' : 'child';
            const metricValue = this.buildHierarchyValueFromRow(row, source, metricKey, metricLabel, '表三', row.count);
            if (source === 'parent') {
                bucket.parentValue = metricValue.value;
            } else {
                bucket.childValues.push(metricValue);
            }
        }

        const legalRows = await pool.query(
            `SELECT
                flp.report_id,
                flp.version_id,
                r.region_id,
                COALESCE(reg.name, r.unit_name, '') AS region_name,
                r.unit_name,
                flp.case_type,
                flp.result_type,
                flp.count
             FROM fact_legal_proceeding flp
             JOIN reports r ON r.id = flp.report_id
             LEFT JOIN regions reg ON reg.id = r.region_id
             WHERE flp.version_id = ANY($1::bigint[])`,
            [versionIds]
        );

        for (const row of legalRows.rows || []) {
            if (row.count === null || row.count === undefined) continue;
            const caseType = String(row.case_type || '');
            const resultType = String(row.result_type || '');
            const caseLabel = HIERARCHY_LEGAL_CASE_LABELS[caseType] || caseType;
            const resultLabel = HIERARCHY_LEGAL_RESULT_LABELS[resultType] || resultType;
            const metricKey = this.buildHierarchyMetricKey('legal', [caseType, resultType]);
            const metricLabel = `${caseLabel}-${resultLabel}`;
            const bucket = this.getHierarchyMetricBucket(buckets, metricKey, metricLabel, '表四');
            const source = Number(row.version_id) === context.versionId ? 'parent' : 'child';
            const metricValue = this.buildHierarchyValueFromRow(row, source, metricKey, metricLabel, '表四', row.count);
            if (source === 'parent') {
                bucket.parentValue = metricValue.value;
            } else {
                bucket.childValues.push(metricValue);
            }
        }

        return buckets;
    }

    private createHierarchyItem(
        context: HierarchyReportContext,
        bucket: HierarchyMetricBucket,
        childContexts: HierarchyChildReportContext[],
        childWithReports: HierarchyChildReportContext[],
        missingReportChildren: HierarchyChildReportContext[]
    ): ConsistencyItem {
        const childSum = bucket.childValues.reduce((sum, item) => sum + (item.value || 0), 0);
        const hasParentValue = bucket.parentValue !== null && bucket.parentValue !== undefined;
        const childVersionSet = new Set(bucket.childValues.map((item) => item.versionId));
        const childMissingMetric = childWithReports.filter((child) => child.versionId && !childVersionSet.has(child.versionId));
        const hasComparableChildren = childWithReports.length > 0;
        const canCompare = hasParentValue && hasComparableChildren && childMissingMetric.length === 0 && missingReportChildren.length === 0;
        const autoStatus: AutoStatus = canCompare
            ? (Math.abs((bucket.parentValue || 0) - childSum) <= 0 ? 'PASS' : 'FAIL')
            : 'UNCERTAIN';
        const leftValue = hasParentValue ? bucket.parentValue : null;
        const rightValue = hasComparableChildren ? childSum : null;
        const delta = leftValue !== null && rightValue !== null ? leftValue - rightValue : null;
        const childNames = bucket.childValues.map((item) => item.regionName);
        const missingReportNames = missingReportChildren.map((item) => item.regionName);
        const missingMetricNames = childMissingMetric.map((item) => item.regionName);
        const summarizeNames = (names: string[], limit = 12): string => {
            if (names.length <= limit) {
                return names.join('、');
            }
            return `${names.slice(0, limit).join('、')}等${names.length}个`;
        };
        const checkKey = `hierarchy_sum_${bucket.metricKey}`;

        return this.createManualItem(
            'hierarchy',
            checkKey,
            `层级汇总一致性：${context.regionName} ${bucket.tableLabel} ${bucket.metricLabel}`,
            `self.${bucket.metricKey} = sum(direct_children.${bucket.metricKey})`,
            leftValue,
            rightValue,
            delta,
            0,
            autoStatus,
            [`hierarchy.${context.regionId}.${bucket.metricKey}`],
            {
                reason: autoStatus === 'FAIL'
                    ? 'hierarchy_sum_mismatch'
                    : canCompare
                        ? 'hierarchy_sum_matched'
                        : 'hierarchy_sum_incomplete_inputs',
                table: bucket.tableLabel,
                metricKey: bucket.metricKey,
                metricLabel: bucket.metricLabel,
                parent: {
                    regionId: context.regionId,
                    regionName: context.regionName,
                    reportId: context.reportId,
                    versionId: context.versionId,
                    value: leftValue,
                },
                childSum,
                childCount: childContexts.length,
                childReportCount: childWithReports.length,
                childMetricCount: bucket.childValues.length,
                includedChildrenPreview: bucket.childValues.slice(0, 12).map((item) => ({
                    regionId: item.regionId,
                    regionName: item.regionName,
                    reportId: item.reportId,
                    versionId: item.versionId,
                    value: item.value,
                })),
                missingReports: missingReportChildren.map((item) => ({
                    regionId: item.regionId,
                    regionName: item.regionName,
                })),
                missingMetricChildren: childMissingMetric.map((item) => ({
                    regionId: item.regionId,
                    regionName: item.regionName,
                    reportId: item.reportId,
                    versionId: item.versionId,
                })),
                context: [
                    `${context.regionName}：${leftValue ?? '缺失'}`,
                    `直接下级合计：${rightValue ?? '缺失'}`,
                    childNames.length ? `已纳入下级：${summarizeNames(childNames)}` : '',
                    missingReportNames.length ? `缺少同年报告：${summarizeNames(missingReportNames)}` : '',
                    missingMetricNames.length ? `缺少该字段：${summarizeNames(missingMetricNames)}` : '',
                ].filter(Boolean).join('\n'),
            },
            [`hierarchy.parent.${context.regionId}.${bucket.metricKey}`],
            bucket.childValues.map((item) => `hierarchy.child.${item.regionId}.${bucket.metricKey}`)
        );
    }

    private async generateHierarchyItems(reportVersionId: number): Promise<ConsistencyItem[]> {
        const context = await this.loadHierarchyContext(reportVersionId);
        if (!context) {
            return [
                this.createManualItem(
                    'hierarchy',
                    'hierarchy_context_missing',
                    '层级汇总一致性：当前报告未绑定可用区域层级',
                    'report_region_hierarchy_context_exists',
                    null,
                    null,
                    null,
                    0,
                    'NOT_ASSESSABLE',
                    ['hierarchy'],
                    {
                        reason: 'hierarchy_context_missing',
                        reportVersionId,
                    }
                ),
            ];
        }

        const childContexts = await this.loadDirectChildReportContexts(context);
        if (childContexts.length === 0) {
            return [
                this.createManualItem(
                    'hierarchy',
                    'hierarchy_no_direct_children',
                    `层级汇总一致性：${context.regionName} 暂无直接下级机构`,
                    'direct_children_exists',
                    null,
                    null,
                    null,
                    0,
                    'NOT_ASSESSABLE',
                    [`hierarchy.${context.regionId}`],
                    {
                        reason: 'hierarchy_no_direct_children',
                        parent: {
                            regionId: context.regionId,
                            regionName: context.regionName,
                            reportId: context.reportId,
                            versionId: context.versionId,
                        },
                    }
                ),
            ];
        }

        const childWithReports = childContexts.filter((child) => child.versionId);
        const missingReportChildren = childContexts.filter((child) => !child.versionId);

        if (childWithReports.length === 0) {
            return [
                this.createManualItem(
                    'hierarchy',
                    'hierarchy_no_child_reports',
                    `层级汇总一致性：${context.regionName} 下级缺少同年年报`,
                    'direct_child_reports_exist_for_same_year',
                    null,
                    null,
                    null,
                    0,
                    'UNCERTAIN',
                    [`hierarchy.${context.regionId}`],
                    {
                        reason: 'hierarchy_no_child_reports',
                        year: context.year,
                        parent: {
                            regionId: context.regionId,
                            regionName: context.regionName,
                            reportId: context.reportId,
                            versionId: context.versionId,
                        },
                        missingReports: missingReportChildren.map((child) => ({
                            regionId: child.regionId,
                            regionName: child.regionName,
                        })),
                    }
                ),
            ];
        }

        const buckets = await this.loadHierarchyMetricBuckets(
            context,
            childWithReports.map((child) => child.versionId!).filter(Boolean)
        );

        const items = Array.from(buckets.values())
            .filter((bucket) => bucket.parentValue !== null || bucket.childValues.length > 0)
            .map((bucket) => this.createHierarchyItem(
                context,
                bucket,
                childContexts,
                childWithReports,
                missingReportChildren
            ));

        if (items.length === 0) {
            return [
                this.createManualItem(
                    'hierarchy',
                    'hierarchy_no_materialized_metrics',
                    `层级汇总一致性：${context.regionName} 暂无可汇总事实数据`,
                    'hierarchy_materialized_metrics_exist',
                    null,
                    null,
                    null,
                    0,
                    'NOT_ASSESSABLE',
                    [`hierarchy.${context.regionId}`],
                    {
                        reason: 'hierarchy_no_materialized_metrics',
                        year: context.year,
                        parent: {
                            regionId: context.regionId,
                            regionName: context.regionName,
                            reportId: context.reportId,
                            versionId: context.versionId,
                        },
                        childReportCount: childWithReports.length,
                    }
                ),
            ];
        }

        return items;
    }

    /**
     * Get entity display name in Chinese
     */
    private getEntityName(entityKey: string): string {
        const names: Record<string, string> = {
            'naturalPerson': '自然人列',
            'legalPerson.commercial': '商业企业列',
            'legalPerson.research': '科研机构列',
            'legalPerson.social': '社会公益组织列',
            'legalPerson.legal': '法律服务机构列',
            'legalPerson.other': '其他组织列',
            'total': '总计列',
        };
        return names[entityKey] || entityKey;
    }

    /**
     * Get entity data from Table3Data by key path
     */
    private getEntityData(tableData: Table3Data, entityKey: string): EntityData | undefined {
        if (entityKey === 'naturalPerson') return tableData.naturalPerson;
        if (entityKey === 'total') return tableData.total;
        if (entityKey.startsWith('legalPerson.')) {
            const subKey = entityKey.split('.')[1] as keyof NonNullable<Table3Data['legalPerson']>;
            return tableData.legalPerson?.[subKey];
        }
        return undefined;
    }

    /**
     * Generate Table 3 consistency check items
     */
    private generateTable3Items(tableData: Table3Data | undefined): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        // If table3 doesn't exist, return a NOT_ASSESSABLE item
        if (!tableData) {
            items.push({
                groupKey: 'table3',
                checkKey: 't3_missing',
                fingerprint: this.generateFingerprint('table3', 't3_missing', 'table3_exists'),
                title: '表三：数据缺失',
                expr: 'table3_exists',
                leftValue: null,
                rightValue: null,
                delta: null,
                tolerance: 0,
                autoStatus: 'NOT_ASSESSABLE',
                evidenceJson: { paths: ['sections[type=table_3].tableData'], values: { tableData: null } },
            });
            return items;
        }

        const entityKeys = [
            'naturalPerson',
            'legalPerson.commercial',
            'legalPerson.research',
            'legalPerson.social',
            'legalPerson.legal',
            'legalPerson.other',
            'total',
        ];

        // For each entity: 办理结果总计校验 and 恒等式校验
        for (const entityKey of entityKeys) {
            const entity = this.getEntityData(tableData, entityKey);
            const entityName = this.getEntityName(entityKey);
            const basePath = entityKey === 'naturalPerson' || entityKey === 'total'
                ? `tableData.${entityKey}`
                : `tableData.${entityKey}`;

            if (!entity) continue;

            const results = entity.results;

            // 1. 办理结果总计校验
            if (results) {
                const granted = this.parseNumber(results.granted);
                const partialGrant = this.parseNumber(results.partialGrant);
                const deniedSum = this.sumObject(results.denied);
                const unableSum = this.sumObject(results.unableToProvide);
                const notProcessedSum = this.sumObject(results.notProcessed);
                const otherSum = this.sumObject(results.other);
                const totalProcessed = this.parseNumber(results.totalProcessed);

                const components = [granted, partialGrant, deniedSum, unableSum, notProcessedSum, otherSum];
                const hasAllComponents = components.every(c => c !== null);
                const leftSum = hasAllComponents
                    ? components.reduce((sum, c) => sum! + c!, 0)
                    : null;

                // Left Paths: All components
                const leftPaths = [
                    `${basePath}.results.granted`,
                    `${basePath}.results.partialGrant`,
                    // Denied (8 items)
                    `${basePath}.results.denied.stateSecret`,
                    `${basePath}.results.denied.lawForbidden`,
                    `${basePath}.results.denied.safetyStability`,
                    `${basePath}.results.denied.thirdPartyRights`,
                    `${basePath}.results.denied.internalAffairs`,
                    `${basePath}.results.denied.processInfo`,
                    `${basePath}.results.denied.enforcementCase`,
                    `${basePath}.results.denied.adminQuery`,
                    // UnableToProvide (3 items)
                    `${basePath}.results.unableToProvide.noInfo`,
                    `${basePath}.results.unableToProvide.needCreation`,
                    `${basePath}.results.unableToProvide.unclear`,
                    // NotProcessed (5 items)
                    `${basePath}.results.notProcessed.complaint`,
                    `${basePath}.results.notProcessed.repeat`,
                    `${basePath}.results.notProcessed.publication`,
                    `${basePath}.results.notProcessed.massiveRequests`,
                    `${basePath}.results.notProcessed.confirmInfo`,
                    // Other (3 items)
                    `${basePath}.results.other.overdueCorrection`,
                    `${basePath}.results.other.overdueFee`,
                    `${basePath}.results.other.otherReasons`,
                ];

                // Right Path: Total
                const rightPaths = [`${basePath}.results.totalProcessed`];

                // Combined paths for backward compatibility or general highlighting
                const paths = [...leftPaths, ...rightPaths];

                const values: Record<string, any> = {
                    granted,
                    partialGrant,
                    deniedSum,
                    unableSum,
                    notProcessedSum,
                    otherSum,
                    totalProcessed,
                };

                items.push(this.createItem(
                    'table3',
                    `t3_result_total_${entityKey.replace('.', '_')}`,
                    `表三：予以公开+部分公开+不予公开(8项)+无法提供(3项)+不予处理(5项)+其他(3项)=办理结果总计（${entityName}）`,
                    'granted + partialGrant + sum(denied.*) + sum(unableToProvide.*) + sum(notProcessed.*) + sum(other.*) = totalProcessed',
                    leftSum,
                    totalProcessed,
                    0,
                    paths,
                    values,
                    leftPaths,  // Pass left paths
                    rightPaths  // Pass right paths
                ));
            }

            // 2. 恒等式校验: newReceived + carriedOver = totalProcessed + carriedForward
            const newReceived = this.parseNumber(entity.newReceived);
            const carriedOver = this.parseNumber(entity.carriedOver);
            const totalProcessed = this.parseNumber(entity.results?.totalProcessed);
            const carriedForward = this.parseNumber(entity.results?.carriedForward);

            const leftInput = (newReceived !== null && carriedOver !== null)
                ? newReceived + carriedOver
                : null;
            const rightOutput = (totalProcessed !== null && carriedForward !== null)
                ? totalProcessed + carriedForward
                : null;

            const identityLeftPaths = [
                `${basePath}.newReceived`,
                `${basePath}.carriedOver`,
            ];
            const identityRightPaths = [
                `${basePath}.results.totalProcessed`,
                `${basePath}.results.carriedForward`,
            ];

            items.push(this.createItem(
                'table3',
                `t3_identity_${entityKey.replace('.', '_')}`,
                `表三：本年新收+上年结转=办理结果总计+结转下年度继续办理（${entityName}）`,
                'newReceived + carriedOver = totalProcessed + carriedForward',
                leftInput,
                rightOutput,
                0,
                [...identityLeftPaths, ...identityRightPaths],
                { newReceived, carriedOver, totalProcessed, carriedForward },
                identityLeftPaths,
                identityRightPaths
            ));
        }

        // 3. 总计列 = 各列求和 (for newReceived, carriedOver, totalProcessed, carriedForward)
        // 3. 总计列 = 各列求和 (for ALL rows in Table 3)
        // Rule: Sum(Natural + Legal.Commercial + ... + Legal.Other) = Total
        const fieldsToCheck = [
            // Top level
            { path: 'newReceived', name: '本年新收' },
            { path: 'carriedOver', name: '上年结转' },
            // Results - Main
            { path: 'results.granted', name: '予以公开' },
            { path: 'results.partialGrant', name: '部分公开' },
            // Results - Denied
            { path: 'results.denied.stateSecret', name: '属于国家秘密' },
            { path: 'results.denied.lawForbidden', name: '其他法律行政法规禁止公开' },
            { path: 'results.denied.safetyStability', name: '危及“三安全一稳定”' },
            { path: 'results.denied.thirdPartyRights', name: '保护第三方合法权益' },
            { path: 'results.denied.internalAffairs', name: '属于三类内部事务信息' },
            { path: 'results.denied.processInfo', name: '属于四类过程性信息' },
            { path: 'results.denied.enforcementCase', name: '属于行政执法案卷' },
            { path: 'results.denied.adminQuery', name: '属于行政查询事项' },
            // Results - Unable
            { path: 'results.unableToProvide.noInfo', name: '本机关不掌握相关政府信息' },
            { path: 'results.unableToProvide.needCreation', name: '没有现成信息需要另行制作' },
            { path: 'results.unableToProvide.unclear', name: '补正后申请内容仍不明确' },
            // Results - Not Processed
            { path: 'results.notProcessed.complaint', name: '信访举报投诉类申请' },
            { path: 'results.notProcessed.repeat', name: '重复申请' },
            { path: 'results.notProcessed.publication', name: '要求提供公开出版物' },
            { path: 'results.notProcessed.massiveRequests', name: '无正当理由大量反复申请' },
            { path: 'results.notProcessed.confirmInfo', name: '要求行政机关确认或重新出具' },
            // Results - Other
            { path: 'results.other.overdueCorrection', name: '申请人无正当理由逾期不补正' },
            { path: 'results.other.overdueFee', name: '申请人逾期未按收费通知要求缴纳费用' },
            { path: 'results.other.otherReasons', name: '其他' },
            // Results - Totals
            { path: 'results.totalProcessed', name: '办理结果总计' },
            { path: 'results.carriedForward', name: '结转下年度' },
        ];

        // Helper to safely get nested value
        const getNestedVal = (obj: any, path: string): number | null => {
            if (!obj) return null;
            const parts = path.split('.');
            let current = obj;
            for (const part of parts) {
                if (current === null || current === undefined) return null;
                current = current[part];
            }
            return this.parseNumber(current);
        };

        for (const { path, name } of fieldsToCheck) {
            const entityKeysForSum = [
                'naturalPerson',
                'legalPerson.commercial',
                'legalPerson.research',
                'legalPerson.social',
                'legalPerson.legal',
                'legalPerson.other',
            ];

            const leftPaths: string[] = [];
            const values: Record<string, any> = {};
            let hasAll = true;
            let sum = 0;

            for (const ek of entityKeysForSum) {
                const entity = this.getEntityData(tableData, ek);
                const val = getNestedVal(entity, path);
                const fullPath = `tableData.${ek}.${path}`;

                leftPaths.push(fullPath);
                values[ek] = val;

                if (val === null) {
                    hasAll = false;
                } else {
                    sum += val;
                }
            }

            const totalEntity = tableData.total;
            const totalVal = getNestedVal(totalEntity, path);

            const rightPaths = [`tableData.total.${path}`];
            values['total'] = totalVal;

            items.push(this.createItem(
                'table3',
                `t3_col_sum_${path.replace(/\./g, '_')}`,
                `表三：各列求和=总计（${name}）`,
                `sum(all_entities.${path}) = total.${path}`,
                hasAll ? sum : null,
                totalVal,
                0,
                [...leftPaths, ...rightPaths],
                values,
                leftPaths,
                rightPaths
            ));
        }

        return items;
    }

    /**
     * Generate Table 4 consistency check items
     */
    private generateTable4Items(table4Data: Table4Data | undefined): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        if (!table4Data) {
            items.push({
                groupKey: 'table4',
                checkKey: 't4_missing',
                fingerprint: this.generateFingerprint('table4', 't4_missing', 'table4_exists'),
                title: '表四：数据缺失',
                expr: 'table4_exists',
                leftValue: null,
                rightValue: null,
                delta: null,
                tolerance: 0,
                autoStatus: 'NOT_ASSESSABLE',
                evidenceJson: { paths: ['sections[type=table_4].reviewLitigationData'], values: { reviewLitigationData: null } },
            });
            return items;
        }

        const categories = [
            { key: 'review', name: '行政复议' },
            { key: 'litigationDirect', name: '未经复议直接起诉' },
            { key: 'litigationPostReview', name: '行政诉讼-复议后起诉' },
        ];

        for (const { key, name } of categories) {
            const cat = (table4Data as any)[key] as Table4Category | undefined;
            if (!cat) continue;

            const maintain = this.parseNumber(cat.maintain);
            const correct = this.parseNumber(cat.correct);
            const other = this.parseNumber(cat.other);
            const unfinished = this.parseNumber(cat.unfinished);
            const total = this.parseNumber(cat.total);

            const components = [maintain, correct, other, unfinished];
            const hasAll = components.every(c => c !== null);
            const leftSum = hasAll ? components.reduce((s, c) => s! + c!, 0) : null;

            const basePath = `reviewLitigationData.${key}`;
            const leftPaths = [
                `${basePath}.maintain`,
                `${basePath}.correct`,
                `${basePath}.other`,
                `${basePath}.unfinished`,
            ];
            const rightPaths = [`${basePath}.total`];

            items.push(this.createItem(
                'table4',
                `t4_sum_${key}`,
                `表四：结果维持+结果纠正+其他结果+尚未审结=总计（${name}）`,
                'maintain + correct + other + unfinished = total',
                leftSum,
                total,
                0,
                [...leftPaths, ...rightPaths],
                { maintain, correct, other, unfinished, total },
                leftPaths,
                rightPaths
            ));
        }

        return items;
    }

    /**
     * Generate Text consistency check items by matching numbers in text to table values
     * Updated to include patterns for Section 5 and 6 if they contain numerical summaries.
     */
    private generateTextItems(sections: any[], tableData: Table3Data | undefined, table4Data: Table4Data | undefined): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        // Get text sections with their titles and indices
        const textSections = sections
            .map((s: any, index: number) => ({
                content: s.type === 'text' && typeof s.content === 'string' ? s.content : null,
                title: s.title || s.header || s.heading || `第${this.getChineseNumber(index + 1)}部分`,
                sectionIndex: index,
                type: s.type,
            }))
            .filter(s => s.content !== null);

        if (textSections.length === 0) {
            return [];
        }

        // Basic patterns for extracting key numbers from text
        const patterns: TextPattern[] = [
                {
                    regex: /本年(?:度)?新收.*?(\d+)\s*件/,
                    field: 'newReceived',
                    table: 'table3',
                    path: 'tableData.total.newReceived',
                    getValue: () => this.parseNumber(tableData?.total?.newReceived),
                    name: '本年新收',
                },
                {
                    regex: /上年结转.*?(\d+)\s*件/,
                    field: 'carriedOver',
                    table: 'table3',
                    path: 'tableData.total.carriedOver',
                    getValue: () => this.parseNumber(tableData?.total?.carriedOver),
                    name: '上年结转',
                },
                {
                    // 正文中"收到政务公开申请"数量 = 本年新收
                    regex: /(?:共计?|合计)?收到.*?(?:政府信息公开|政务公开)?申请.*?(\d+)\s*件/,
                    field: 'totalApplications',
                    table: 'table3',
                    path: 'tableData.total.newReceived',
                    getValue: () => this.parseNumber(tableData?.total?.newReceived),
                    name: '收到申请总量',
                },
                {
                    // Tighten the gap before the number so narrative phrases like
                    // "办理政府信息公开申请。...受理3259件，答复3278件" do not
                    // incorrectly capture the earlier received-count. Also avoid
                    // treating following branch numbers, e.g. "办结，8件申请人撤销",
                    // as the total processed count.
                    regex: /(?:答复|办结|办理结果(?:总计)?|处理结果(?:总计)?)(?:政府信息公开申请)?(?:总计|共计|共|数量)?\s*(\d+)\s*件/,
                    field: 'totalProcessed',
                    table: 'table3',
                    path: 'tableData.total.results.totalProcessed',
                    getValue: () => this.parseNumber(tableData?.total?.results?.totalProcessed),
                    name: '办理结果总计',
                    extract: (content) => this.extractTotalProcessedTextMatch(content),
                },
                {
                    regex: /结转下年度(?:继续办理)?.*?(\d+)\s*件/,
                    field: 'carriedForward',
                    table: 'table3',
                    path: 'tableData.total.results.carriedForward',
                    getValue: () => this.parseNumber(tableData?.total?.results?.carriedForward),
                    name: '结转下年度',
                },
                {
                    // 增强: 增加"行政复议"的容错，确保匹配的是总数
                    // 排除"尚未审结"等后缀
                    regex: /行政复议[^，。、；]*?(\d+)\s*件(?!.*(?:尚未审结|结果维持))/,
                    field: 'reviewTotal',
                    table: 'table4',
                    path: 'reviewLitigationData.review.total',
                    getValue: () => this.parseNumber(table4Data?.review?.total),
                    name: '行政复议总计',
                },
                {
                    // 增强: 行政诉讼总计 = 未经复议 + 复议后起诉
                    regex: /行政诉讼[类案件]{0,10}?(\d+)\s*件(?!.*(?:尚未审结|结果维持))/,
                    field: 'litigationTotal',
                    table: 'table4',
                    path: 'reviewLitigationData.litigationDirect.total + reviewLitigationData.litigationPostReview.total',
                    getValue: () => {
                        const direct = this.parseNumber(table4Data?.litigationDirect?.total);
                        const postReview = this.parseNumber(table4Data?.litigationPostReview?.total);
                        if (direct === null && postReview === null) return null;
                        return (direct || 0) + (postReview || 0);
                    },
                    name: '行政诉讼总计',
                },
            ];

        // Search in each text section separately to track position
        for (const pattern of patterns) {
            for (const section of textSections) {
                const match = pattern.extract ? pattern.extract(section.content) : section.content.match(pattern.regex);
                if (match) {
                    const textValue = parseInt(match[1], 10);
                    const tableValue = pattern.getValue();

                    // Find the position of the match in the section
                    const matchStart = section.content.indexOf(match[0]);
                    const contextStart = Math.max(0, matchStart - 20);
                    const contextEnd = Math.min(section.content.length, matchStart + match[0].length + 20);
                    const context = section.content.substring(contextStart, contextEnd);

                    // Parse table path(s) - handle potential expressions like "path1 + path2"
                    const tablePaths = pattern.path.includes('+')
                        ? pattern.path.split('+').map(p => p.trim())
                        : [pattern.path];
                    const textPath = `sections[${section.sectionIndex}].content`;

                    items.push(this.createItem(
                        'text',
                        `text_vs_${pattern.table}_${pattern.field}`,
                        `正文一致性：正文提及"${pattern.name}"与${pattern.table === 'table3' ? '表三' : '表四'}数据对照`,
                        `text("${pattern.name}") = ${pattern.path}`,
                        textValue,
                        tableValue,
                        0,
                        [...tablePaths, textPath],
                        {
                            textValue,
                            tableValue,
                            matchedText: match[0],
                            context: `...${context}...`,
                            sectionTitle: section.title,
                            sectionIndex: section.sectionIndex + 1, // 1-indexed for display
                        },
                        [textPath],
                        tablePaths
                    ));

                    // Only match once per pattern (first occurrence)
                    break;
                }
            }
        }

        return items;
    }

    /**
     * Convert number to Chinese ordinal (1 -> 一, 2 -> 二, etc.)
     */
    private getChineseNumber(num: number): string {
        const chars = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        if (num <= 10) return chars[num];
        if (num < 20) return '十' + (num === 10 ? '' : chars[num - 10]);
        if (num < 100) {
            const tens = Math.floor(num / 10);
            const ones = num % 10;
            return chars[tens] + '十' + (ones === 0 ? '' : chars[ones]);
        }
        return num.toString();
    }

    /**
     * Main entry: Run all consistency checks on parsed JSON
     */
    /**
     * Generate Visual Audit items (Layer 1)
     * Supports both code-detected (border_missing) and AI-detected (table_border_missing) flags
     * 
     * NOTE: 2026-02-06 - 表格边框检测功能已禁用，因为误报率过高
     * PDF检测的stroke比例算法和HTML的border属性检测都不够准确
     */
    private generateVisualAuditItems(_visualAudit: { border_missing?: boolean; table_border_missing?: boolean; notes?: string } | undefined): ConsistencyItem[] {
        // 功能已禁用 - 直接返回空数组
        return [];
    }

    /**
     * Generate Structure Audit items (Missing Tables, Empty Cells)
     */
    private generateParseRuleGateItems(ruleGate: any): ConsistencyItem[] {
        if (!ruleGate || ruleGate.passed !== false || !Array.isArray(ruleGate.issues)) {
            return [];
        }

        return ruleGate.issues.slice(0, 30).map((issue: unknown, index: number) => {
            const issueText = String(issue || 'parse_rule_gate_failed');
            const groupKey: GroupKey = issueText.startsWith('table_4.') || issueText.startsWith('table_4 ')
                ? 'table4'
                : 'table3';
            const checkKey = `parse_rule_gate_${index + 1}`;
            return {
                groupKey,
                checkKey,
                fingerprint: this.generateFingerprint(groupKey, checkKey, issueText),
                title: `解析规则复核：${issueText}`,
                expr: 'parse_rule_gate',
                leftValue: null,
                rightValue: null,
                delta: null,
                tolerance: 0,
                autoStatus: 'FAIL',
                evidenceJson: {
                    paths: this.extractPathsFromParseRuleIssue(issueText),
                    values: {
                        issue: issueText,
                        source: 'parse_rule_gate',
                        action: 'show_result_and_require_review',
                    },
                },
            } as ConsistencyItem;
        });
    }

    private extractPathsFromParseRuleIssue(issue: string): string[] {
        const match = issue.match(/^(table_[34])\.([^\s]+)\s/);
        if (!match) {
            return ['parsed_json'];
        }
        const tableId = match[1];
        const relativePath = match[2];
        const payloadKey = tableId === 'table_4' ? 'reviewLitigationData' : 'tableData';
        return [`sections[type=${tableId}].${payloadKey}.${relativePath}`];
    }

    private generateStructureAuditItems(sections: any[]): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        // 1. Check for Missing Table 3
        const section3 = sections.find((s: any) => s.title && (s.title.includes('三、') || s.title.includes('收到和处理')));
        const table3Section = sections.find((s: any) => s.type === 'table_3');
        const hasTable3Data = table3Section && table3Section.tableData && Object.keys(table3Section.tableData).length > 0;

        if (section3 && !hasTable3Data) {
            items.push({
                groupKey: 'visual',
                checkKey: 'visual_table3_missing',
                fingerprint: this.generateFingerprint('visual', 'table3_missing', 'structure_check'),
                title: '表格审计：第三部分表格缺失',
                expr: 'has_table_3_data',
                leftValue: 0,
                rightValue: 1,
                delta: 1,
                tolerance: 0,
                autoStatus: 'FAIL',
                evidenceJson: {
                    paths: ['sections'],
                    values: { section_title: section3.title, has_data: false }
                }
            });
        }

        // 2. Check for Empty/Slash cells in Table 3
        if (hasTable3Data) {
            const emptySlashCells = this.countEmptyOrSlashCells(table3Section.tableData);
            if (emptySlashCells.count > 0) {
                items.push({
                    groupKey: 'visual',
                    checkKey: 'visual_table3_empty_cells',
                    fingerprint: this.generateFingerprint('visual', 'table3_empty_cells', 'empty_check'),
                    title: `表格审计：表三存在${emptySlashCells.count}个空白或"/"单元格`,
                    expr: 'empty_or_slash_cells == 0',
                    leftValue: emptySlashCells.count,
                    rightValue: 0,
                    delta: emptySlashCells.count,
                    tolerance: 0,
                    autoStatus: emptySlashCells.count > 10 ? 'FAIL' : 'UNCERTAIN',
                    evidenceJson: {
                        paths: ['sections[type=table_3].tableData'],
                        values: {
                            empty_count: emptySlashCells.count,
                            examples: emptySlashCells.examples.slice(0, 5),
                            note: '表格中存在空白或"/"符号，可能表示数据缺失'
                        }
                    }
                });
            }
        }

        // 3. Check for Empty/Slash cells in Table 4
        const table4Section = sections.find((s: any) => s.type === 'table_4');
        if (table4Section && table4Section.reviewLitigationData) {
            const emptySlashCells = this.countEmptyOrSlashCells(table4Section.reviewLitigationData);
            if (emptySlashCells.count > 0) {
                items.push({
                    groupKey: 'visual',
                    checkKey: 'visual_table4_empty_cells',
                    fingerprint: this.generateFingerprint('visual', 'table4_empty_cells', 'empty_check'),
                    title: `表格审计：表四存在${emptySlashCells.count}个空白或"/"单元格`,
                    expr: 'empty_or_slash_cells == 0',
                    leftValue: emptySlashCells.count,
                    rightValue: 0,
                    delta: emptySlashCells.count,
                    tolerance: 0,
                    autoStatus: emptySlashCells.count > 5 ? 'FAIL' : 'UNCERTAIN',
                    evidenceJson: {
                        paths: ['sections[type=table_4].reviewLitigationData'],
                        values: {
                            empty_count: emptySlashCells.count,
                            examples: emptySlashCells.examples.slice(0, 5),
                            note: '表格中存在空白或"/"符号，可能表示数据缺失'
                        }
                    }
                });
            }
        }

        return items;
    }

    /**
     * Helper: Count empty or "/" cells in a nested object (table data)
     */
    private countEmptyOrSlashCells(obj: any, path: string = ''): { count: number; examples: string[] } {
        let count = 0;
        const examples: string[] = [];

        const isEmptyOrSlash = (val: any): boolean => {
            if (val === null || val === undefined) return true;
            if (typeof val === 'string') {
                const trimmed = val.trim();
                return trimmed === '' || trimmed === '/' || trimmed === '-' || trimmed === '—';
            }
            return false;
        };

        const traverse = (current: any, currentPath: string) => {
            if (current === null || current === undefined) return;

            if (typeof current === 'object' && !Array.isArray(current)) {
                for (const key of Object.keys(current)) {
                    const value = current[key];
                    const newPath = currentPath ? `${currentPath}.${key}` : key;

                    if (typeof value === 'object' && value !== null) {
                        traverse(value, newPath);
                    } else if (isEmptyOrSlash(value)) {
                        count++;
                        if (examples.length < 10) {
                            examples.push(`${newPath}: "${value ?? 'null'}"`);
                        }
                    }
                }
            }
        };

        traverse(obj, path);
        return { count, examples };
    }

    /**
     * Generate Section 5 Gap Analysis
     */
    private generateSection5GapItems(sections: any[]): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];
        const section5 = sections.find((s: any) => s.type === 'text' && (s.title?.includes('五、') || s.title?.includes('存在的主要问题')));

        if (section5) {
            const content = (section5.content || '').trim();
            const isNone = content === '无' || content === '无。' || content === 'None' || content === '';
            const isTooShort = content.length < 10;

            if (isNone || isTooShort) {
                items.push({
                    groupKey: 'quality', // UPDATED from 'text'
                    checkKey: 'narrative_sec5_gap',
                    fingerprint: this.generateFingerprint('quality', 'sec5_gap', 'content_length'),
                    title: '语义审计：第五部分存在问题及改进情况空缺',
                    expr: 'content_length > 10 && content != "无"',
                    leftValue: content.length,
                    rightValue: 10,
                    delta: content.length,
                    tolerance: 0,
                    autoStatus: 'FAIL', // This is a specific user requirement to flag as issue
                    evidenceJson: {
                        paths: ['sections[5].content'],
                        values: { content: content, issue: 'Content is missing or too brief' }
                    }
                });
            }
        }
        return items;
    }

    /**
     * Generate Section 6 Fee Disclosure Logic Check
     */
    private generateSection6LogicItems(sections: any[]): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        // 1. Check if Fees exist (from Table 2)
        const table2 = sections.find((s: any) => s.type === 'table_2');
        const feesAmount = this.parseNumber(table2?.activeDisclosureData?.fees?.amount) || 0;

        // 2. Check Section 6 Content
        const section6 = sections.find((s: any) => s.type === 'text' && (s.title?.includes('六、') || s.title?.includes('其他需要报告')));

        if (feesAmount > 0 && section6) {
            const content = (section6.content || '').trim();
            const hasFeeKeywords = content.includes('费') || content.includes('无') === false; // Crude check: if it says "无" it likely misses instructions.
            // Better logic: if content is "无" or "None"
            const isNone = content === '无' || content === '无。' || content === 'None' || content.match(/^无[。！]?$/);

            if (isNone) {
                items.push({
                    groupKey: 'quality', // UPDATED from 'text'
                    checkKey: 'narrative_sec6_fee_conflict',
                    fingerprint: this.generateFingerprint('quality', 'sec6_fee_conflict', 'fee_logic'),
                    title: '语义审计：存在收费但未在第六部分说明',
                    expr: 'fees > 0 => section6 != "无"',
                    leftValue: feesAmount, // Active fees
                    rightValue: 0,      // Expected 0 if Section 6 says "None"? Or simply a logic fail.
                    delta: feesAmount,
                    tolerance: 0,
                    autoStatus: 'FAIL',
                    evidenceJson: {
                        paths: ['sections[table_2].fees.amount', 'sections[6].content'],
                        values: { fees: feesAmount, section6_content: content }
                    }
                });
            }
        }
        return items;
    }

    /**
     * Generate Year Mismatch Items - 检查正文中年份与报告实际年份的一致性
     * 例如：2023年报告却在正文中写"本单位2022年度..."，这是明显的年份错误
     */
    private generateYearMismatchItems(sections: any[], reportYear: number | null): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        if (!reportYear || reportYear <= 0) {
            return items;
        }

        // 获取所有文本内容进行检查
        const textSections = sections
            .map((s: any, index: number) => ({
                content: s.type === 'text' && typeof s.content === 'string' ? s.content : null,
                title: s.title || s.header || s.heading || `第${this.getChineseNumber(index + 1)}部分`,
                sectionIndex: index,
                type: s.type,
            }))
            .filter(s => s.content !== null);

        if (textSections.length === 0) {
            return items;
        }

        // 用于检测的年份：报告年份及其可能的错误年份
        // 例如2023年报告，正文应该说的是2023年的工作，不应该是2022年
        const expectedYear = reportYear;
        const wrongYears = [reportYear - 1, reportYear + 1]; // 前一年和后一年都可能是错误

        // 匹配在正文中表述年份的模式
        // 例如：本年(度)、XXXX年度、XXXX年
        // 特别关注像 "本单位2022年度通过门户网站..." 这样的表述
        const yearPatterns: Array<{
            regex: RegExp;
            description: string;
            extractYear: (match: RegExpMatchArray) => number | null;
        }> = [
                {
                    // 匹配 "本单位/本机关/我局 XXXX年度" 等表述
                    regex: /(?:本单位|本机关|我局|我办|本街道|本区|本委|本厅)(\d{4})年[度]?(?:通过|主动|收到|共|公开|受理|办理|处理)/g,
                    description: '机构自称+年度表述',
                    extractYear: (match) => parseInt(match[1], 10),
                },
                {
                    // 匹配 "XXXX年度通过门户网站主动公开政府信息" 等表述
                    regex: /(\d{4})年[度]?(?:通过|本年|全年)?(?:门户网站)?(?:主动公开|政府信息公开|依申请公开|公开)(?:政府信息|年报|工作)/g,
                    description: '年度+政务公开表述',
                    extractYear: (match) => parseInt(match[1], 10),
                },
                {
                    // 匹配工作总结性质的年份表述
                    regex: /(\d{4})年[度]?[:,，]?(?:本机关|本单位|我局)?(?:共|累计|合计)?(?:收到|受理|办理|处理|答复)/g,
                    description: '年度+工作数据表述',
                    extractYear: (match) => parseInt(match[1], 10),
                },
            ];

        // 记录已发现的年份不一致问题
        const foundMismatches: Array<{
            wrongYear: number;
            context: string;
            sectionTitle: string;
            sectionIndex: number;
            description: string;
            matchPosition: number; // 用于去重
        }> = [];

        // 用于去重的集合：章节索引 + 匹配位置
        const seenPositions = new Set<string>();

        for (const section of textSections) {
            for (const pattern of yearPatterns) {
                // 重置 regex 的 lastIndex
                pattern.regex.lastIndex = 0;
                let match;
                while ((match = pattern.regex.exec(section.content)) !== null) {
                    const mentionedYear = pattern.extractYear(match);
                    if (mentionedYear && wrongYears.includes(mentionedYear)) {
                        // 发现年份不一致
                        const matchStart = match.index;

                        // 基于章节+位置去重（避免不同正则匹配同一位置）
                        // 使用10个字符的容差范围来判断是否是同一位置
                        const positionKey = `${section.sectionIndex}:${Math.floor(matchStart / 20)}`;
                        if (seenPositions.has(positionKey)) {
                            continue; // 跳过已经记录的位置
                        }
                        seenPositions.add(positionKey);

                        // 扩大上下文范围，确保能显示完整的句子
                        const contextStart = Math.max(0, matchStart - 30);
                        const contextEnd = Math.min(section.content.length, matchStart + match[0].length + 50);
                        const context = section.content.substring(contextStart, contextEnd);

                        foundMismatches.push({
                            wrongYear: mentionedYear,
                            context: `...${context}...`,
                            sectionTitle: section.title,
                            sectionIndex: section.sectionIndex,
                            description: pattern.description,
                            matchPosition: matchStart,
                        });
                    }
                }
            }
        }

        // 为每个发现的年份不一致问题生成检查项
        if (foundMismatches.length > 0) {
            // 如果有多个相同年份的问题，合并为一个检查项
            const mismatchesByYear = new Map<number, typeof foundMismatches>();
            for (const mismatch of foundMismatches) {
                if (!mismatchesByYear.has(mismatch.wrongYear)) {
                    mismatchesByYear.set(mismatch.wrongYear, []);
                }
                mismatchesByYear.get(mismatch.wrongYear)!.push(mismatch);
            }

            for (const [wrongYear, matches] of Array.from(mismatchesByYear)) {
                // 构建可展示的上下文文本，格式化为多行显示
                const contextTexts = matches.slice(0, 5).map((m, idx) =>
                    `【${idx + 1}】${m.sectionTitle}：${m.context}`
                );
                const displayContext = contextTexts.join('\n');

                // 构建详细的匹配信息用于展示
                const matchDetails = matches.slice(0, 5).map(m => ({
                    context: m.context,
                    sectionTitle: m.sectionTitle,
                    patternType: m.description,
                    sectionIndex: m.sectionIndex,
                }));

                items.push({
                    groupKey: 'quality',
                    checkKey: `year_mismatch_${wrongYear}`,
                    fingerprint: this.generateFingerprint('quality', `year_mismatch_${wrongYear}`, 'year_consistency'),
                    title: `年份不一致：报告年份为${expectedYear}年，但正文中发现${wrongYear}年的表述`,
                    expr: `text_year == report_year (${expectedYear})`,
                    leftValue: wrongYear,
                    rightValue: expectedYear,
                    delta: Math.abs(wrongYear - expectedYear),
                    tolerance: 0,
                    autoStatus: 'FAIL',
                    evidenceJson: {
                        paths: matches.map(m => `sections[${m.sectionIndex}].content`),
                        // 添加 leftPaths 和 rightPaths 以支持前端定位和展示
                        leftPaths: [`正文中年份表述: ${wrongYear}年`],
                        rightPaths: [`报告实际年份: ${expectedYear}年`],
                        values: {
                            reportYear: expectedYear,
                            wrongYear: wrongYear,
                            matchCount: matches.length,
                            // 提供 context 和 matchedText 供前端展示
                            context: displayContext,
                            matchedText: displayContext,
                            textValue: wrongYear,
                            // 详细匹配信息
                            matches: matchDetails,
                            note: `报告应描述${expectedYear}年的工作，但发现${matches.length}处提及${wrongYear}年的表述，可能是年份错误`
                        }
                    }
                });
            }
        }

        return items;
    }

    public runChecks(parsedJson: any, reportYear?: number | null): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];

        // Parse if string
        let parsed = parsedJson;
        if (typeof parsedJson === 'string') {
            try {
                parsed = JSON.parse(parsedJson);
            } catch {
                items.push({
                    groupKey: 'table3',
                    checkKey: 'parse_error',
                    fingerprint: this.generateFingerprint('table3', 'parse_error', 'json_parse'),
                    title: '解析错误：无法解析 parsed_json',
                    expr: 'JSON.parse(parsed_json)',
                    leftValue: null,
                    rightValue: null,
                    delta: null,
                    tolerance: 0,
                    autoStatus: 'NOT_ASSESSABLE',
                    evidenceJson: { paths: ['parsed_json'], values: { error: 'JSON parse failed' } },
                });
                return items;
            }
        }

        const sections = parsed?.sections || [];
        const visualAudit = parsed?.visual_audit;

        // Find Table 3 section
        const table3Section = sections.find((s: any) => s.type === 'table_3');
        const tableData: Table3Data | undefined = table3Section?.tableData;

        // Find Table 4 section
        const table4Section = sections.find((s: any) => s.type === 'table_4');
        const table4Data: Table4Data | undefined = table4Section?.reviewLitigationData;

        // Find Table 2 section
        const table2Section = sections.find((s: any) => s.type === 'table_2');
        const table2Data: Table2Data | undefined = table2Section?.activeDisclosureData;

        // Generate items for each group
        const table2Result = this.generateTable2Items(table2Data);
        items.push(...table2Result.items);
        items.push(...this.generateTable3Items(tableData));
        items.push(...this.generateTable4Items(table4Data));
        items.push(...this.generateTextItems(sections, tableData, table4Data)); // Keeping original text checks

        // NEW Premium Checks
        items.push(...this.generateVisualAuditItems(visualAudit));
        items.push(...this.generateParseRuleGateItems(parsed?.parse_rule_gate || visualAudit?.parse_rule_gate));
        items.push(...this.generateStructureAuditItems(sections));
        items.push(...this.generateSection5GapItems(sections));
        items.push(...this.generateSection6LogicItems(sections));

        // Year Mismatch Check - 检查正文年份与报告年份一致性
        if (reportYear) {
            items.push(...this.generateYearMismatchItems(sections, reportYear));
        }


        // Table2 placeholder (no rules yet, but group must exist)
        // We add an info item if table2 section exists but has no checks
        if (!table2Section || !table2Result.hasApplicableFields) {
            items.push({
                groupKey: 'table2',
                checkKey: 't2_no_rules',
                fingerprint: this.generateFingerprint('table2', 't2_no_rules', 'table2_placeholder'),
                title: '表二：暂无校验规则',
                expr: 'table2_placeholder',
                leftValue: null,
                rightValue: null,
                delta: null,
                tolerance: 0,
                autoStatus: 'NOT_ASSESSABLE',
                evidenceJson: { paths: ['sections[type=table_2]'], values: { hasTable2: Boolean(table2Section) } },
            });
        }

        return items;
    }

    /**
     * Run checks and persist to database. Uses upsert to preserve human_status.
     */
    public async runAndPersist(reportVersionId: number, parsedJson: any): Promise<{ runId: number; items: ConsistencyItem[] }> {
        // ensureDbMigrations(); // Removed: migrations should be handled at app startup

        // Get report year from database for year consistency check
        let reportYear: number | null = null;
        try {
            const yearResult = await pool.query(`
                SELECT r.year
                FROM report_versions rv
                JOIN reports r ON rv.report_id = r.id
                WHERE rv.id = $1
                LIMIT 1
            `, [reportVersionId]);
            reportYear = yearResult.rows[0]?.year ? Number(yearResult.rows[0].year) : null;
        } catch (err) {
            console.warn('[ConsistencyCheck] Failed to get report year:', err);
        }

        const runResult = await pool.query(`
      INSERT INTO report_consistency_runs (report_version_id, status, engine_version, created_at)
      VALUES ($1, 'running', $2, NOW())
      RETURNING id;
    `, [reportVersionId, ENGINE_VERSION]);

        const runId = (runResult.rows[0] as any)?.id as number;
        if (!runId) {
            throw new Error('Failed to create consistency run');
        }

        const items = this.runChecks(parsedJson, reportYear);
        try {
            items.push(...await this.generateHierarchyItems(reportVersionId));
        } catch (err: any) {
            console.warn('[ConsistencyCheck] Failed to generate hierarchy checks:', err);
            items.push(this.createManualItem(
                'hierarchy',
                'hierarchy_generation_failed',
                '层级汇总一致性：生成失败',
                'hierarchy_checks_generate_successfully',
                null,
                null,
                null,
                0,
                'NOT_ASSESSABLE',
                ['hierarchy'],
                {
                    reason: 'hierarchy_generation_failed',
                    error: err?.message || String(err),
                }
            ));
        }

        // Upsert each item, resetting human_status to pending on re-run
        for (const item of items) {
            const evidenceStr = JSON.stringify(item.evidenceJson);

            await pool.query(`
        INSERT INTO report_consistency_items (
          run_id, report_version_id, group_key, check_key, fingerprint,
          title, expr, left_value, right_value, delta, tolerance, auto_status,
          evidence_json, human_status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11, $12,
          $13, 'pending', NOW(), NOW()
        )
        ON CONFLICT(report_version_id, fingerprint) DO UPDATE SET
          run_id = excluded.run_id,
          check_key = excluded.check_key,
          title = excluded.title,
          expr = excluded.expr,
          left_value = excluded.left_value,
          right_value = excluded.right_value,
          delta = excluded.delta,
          tolerance = excluded.tolerance,
          auto_status = excluded.auto_status,
          evidence_json = excluded.evidence_json,
          human_status = 'pending',
          human_comment = NULL,
          updated_at = NOW();
      `, [
                runId, reportVersionId, item.groupKey, item.checkKey, item.fingerprint,
                item.title, item.expr, item.leftValue, item.rightValue, item.delta, item.tolerance, item.autoStatus,
                evidenceStr
            ]);
        }

        // Delete stale items that were not updated in this run
        // This handles the case where a rule was removed
        await pool.query(`
          DELETE FROM report_consistency_items
          WHERE report_version_id = $1
            AND run_id != $2;
        `, [reportVersionId, runId]);

        // Update run with summary
        const summary = buildConsistencyRunSummary(items);

        await pool.query(`
      UPDATE report_consistency_runs
      SET status = 'succeeded', summary_json = $1, finished_at = NOW()
      WHERE id = $2;
    `, [JSON.stringify(summary), runId]);

        // Cache aggregated counts on report_versions for fast lookup
        const failItems = items.filter(i => i.autoStatus === 'FAIL');
        const visualCount = failItems.filter(i => i.groupKey === 'visual').length;
        const qualityCount = failItems.filter(i => i.groupKey === 'quality').length;
        const structureCount = failItems.filter(i => ['structure', 'table2', 'table3', 'table4', 'text', 'hierarchy'].includes(i.groupKey)).length;
        const totalCount = failItems.length;

        await pool.query(`
      UPDATE report_versions
      SET check_total = $2,
          check_visual = $3,
          check_structure = $4,
          check_quality = $5,
          checks_updated_at = NOW()
      WHERE id = $1;
    `, [reportVersionId, totalCount, visualCount, structureCount, qualityCount]);

        return { runId, items };
    }
}

export const consistencyCheckService = new ConsistencyCheckService();
