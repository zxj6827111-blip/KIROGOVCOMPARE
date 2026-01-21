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
export type GroupKey = 'table2' | 'table3' | 'table4' | 'text' | 'visual' | 'structure' | 'quality';

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
        values: Record<string, any>;
        textMatches?: Array<{ text: string; position?: number }>;
    };
}

const ENGINE_VERSION = 'v2';

export class ConsistencyCheckService {
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
        values: Record<string, any>
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
            evidenceJson: { paths, values },
        };
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

                // Expand wildcards to explicit paths for frontend highlighting
                const paths = [
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
                    `${basePath}.results.totalProcessed`,
                ];

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
                    values
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

            items.push(this.createItem(
                'table3',
                `t3_identity_${entityKey.replace('.', '_')}`,
                `表三：本年新收+上年结转=办理结果总计+结转下年度继续办理（${entityName}）`,
                'newReceived + carriedOver = totalProcessed + carriedForward',
                leftInput,
                rightOutput,
                0,
                [
                    `${basePath}.newReceived`,
                    `${basePath}.carriedOver`,
                    `${basePath}.results.totalProcessed`,
                    `${basePath}.results.carriedForward`,
                ],
                { newReceived, carriedOver, totalProcessed, carriedForward }
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

            const evidencePaths: string[] = [];
            const values: Record<string, any> = {};
            let hasAll = true;
            let sum = 0;

            for (const ek of entityKeysForSum) {
                const entity = this.getEntityData(tableData, ek);
                const val = getNestedVal(entity, path);
                const fullPath = `tableData.${ek}.${path}`;

                evidencePaths.push(fullPath);
                values[ek] = val;

                if (val === null) {
                    hasAll = false;
                } else {
                    sum += val;
                }
            }

            const totalEntity = tableData.total;
            const totalVal = getNestedVal(totalEntity, path);

            evidencePaths.push(`tableData.total.${path}`);
            values['total'] = totalVal;

            items.push(this.createItem(
                'table3',
                `t3_col_sum_${path.replace(/\./g, '_')}`,
                `表三：各列求和=总计（${name}）`,
                `sum(all_entities.${path}) = total.${path}`,
                hasAll ? sum : null,
                totalVal,
                0,
                evidencePaths,
                values
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
            const paths = [
                `${basePath}.maintain`,
                `${basePath}.correct`,
                `${basePath}.other`,
                `${basePath}.unfinished`,
                `${basePath}.total`,
            ];

            items.push(this.createItem(
                'table4',
                `t4_sum_${key}`,
                `表四：结果维持+结果纠正+其他结果+尚未审结=总计（${name}）`,
                'maintain + correct + other + unfinished = total',
                leftSum,
                total,
                0,
                paths,
                { maintain, correct, other, unfinished, total }
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
        const patterns: Array<{
            regex: RegExp;
            field: string;
            table: 'table3' | 'table4';
            path: string;
            getValue: () => number | null;
            name: string;
        }> = [
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
                    // 正文中"收到政务公开申请"数量 = (七)总计 + 四、结转下年度
                    regex: /(?:共计?|合计)?收到.*?(?:政府信息公开|政务公开)?申请.*?(\d+)\s*件/,
                    field: 'totalApplications',
                    table: 'table3',
                    path: 'tableData.total.results.totalProcessed + tableData.total.results.carriedForward',
                    getValue: () => {
                        const totalProcessed = this.parseNumber(tableData?.total?.results?.totalProcessed);
                        const carriedForward = this.parseNumber(tableData?.total?.results?.carriedForward);
                        if (totalProcessed === null && carriedForward === null) return null;
                        return (totalProcessed || 0) + (carriedForward || 0);
                    },
                    name: '收到申请总量',
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
                    // 增强: 增加"行政复议"的容错，限制中间字符避免跨越匹配
                    regex: /行政复议[^，。、；]*?(\d+)\s*件/,
                    field: 'reviewTotal',
                    table: 'table4',
                    path: 'reviewLitigationData.review.total',
                    getValue: () => this.parseNumber(table4Data?.review?.total),
                    name: '行政复议总计',
                },
                {
                    // 新增: 行政诉讼总计 = 未经复议 + 复议后起诉
                    // 限制中间只能有少量文字（类、案件等），避免跨越"行政复议...134件，行政诉讼...57件"
                    regex: /行政诉讼[类案件]{0,10}?(\d+)\s*件/,
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
                const match = section.content.match(pattern.regex);
                if (match) {
                    const textValue = parseInt(match[1], 10);
                    const tableValue = pattern.getValue();

                    // Find the position of the match in the section
                    const matchStart = section.content.indexOf(match[0]);
                    const contextStart = Math.max(0, matchStart - 20);
                    const contextEnd = Math.min(section.content.length, matchStart + match[0].length + 20);
                    const context = section.content.substring(contextStart, contextEnd);

                    items.push(this.createItem(
                        'text',
                        `text_vs_${pattern.table}_${pattern.field}`,
                        `正文一致性：正文提及"${pattern.name}"与${pattern.table === 'table3' ? '表三' : '表四'}数据对照`,
                        `text("${pattern.name}") = ${pattern.path}`,
                        textValue,
                        tableValue,
                        0,
                        [pattern.path, `sections[${section.sectionIndex}].content`],
                        {
                            textValue,
                            tableValue,
                            matchedText: match[0],
                            context: `...${context}...`,
                            sectionTitle: section.title,
                            sectionIndex: section.sectionIndex + 1, // 1-indexed for display
                        }
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
     */
    private generateVisualAuditItems(visualAudit: { border_missing?: boolean; table_border_missing?: boolean; notes?: string } | undefined): ConsistencyItem[] {
        const items: ConsistencyItem[] = [];
        if (!visualAudit) return items;

        // Check both possible field names (code detection uses border_missing, AI uses table_border_missing)
        const hasBorderIssue = visualAudit.border_missing === true || visualAudit.table_border_missing === true;

        if (hasBorderIssue) {
            items.push({
                groupKey: 'visual',
                checkKey: 'visual_border_missing',
                fingerprint: this.generateFingerprint('visual', 'border_missing', 'lines_count'),
                title: '视觉审计：表格边框缺失',
                expr: 'table_has_borders == true',
                leftValue: 0,
                rightValue: 1,
                delta: 1,
                tolerance: 0,
                autoStatus: 'FAIL',
                evidenceJson: {
                    paths: ['visual_audit.table_border_missing', 'visual_audit.border_missing'],
                    values: {
                        border_missing: true,
                        ai_notes: visualAudit.notes || null,
                        note: '原始文档的表格缺少可见的边框线'
                    }
                }
            });
        }
        return items;
    }

    /**
     * Generate Structure Audit items (Missing Tables, Empty Cells)
     */
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

    public runChecks(parsedJson: any): ConsistencyItem[] {
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

        // Generate items for each group
        items.push(...this.generateTable3Items(tableData));
        items.push(...this.generateTable4Items(table4Data));
        items.push(...this.generateTextItems(sections, tableData, table4Data)); // Keeping original text checks

        // NEW Premium Checks
        items.push(...this.generateVisualAuditItems(visualAudit));
        items.push(...this.generateStructureAuditItems(sections));
        items.push(...this.generateSection5GapItems(sections));
        items.push(...this.generateSection6LogicItems(sections));


        // Table2 placeholder (no rules yet, but group must exist)
        // We add an info item if table2 section exists but has no checks
        const table2Section = sections.find((s: any) => s.type === 'table_2');
        if (table2Section) {
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
                evidenceJson: { paths: ['sections[type=table_2]'], values: { hasTable2: true } },
            });
        }

        return items;
    }

    /**
     * Run checks and persist to database. Uses upsert to preserve human_status.
     */
    public async runAndPersist(reportVersionId: number, parsedJson: any): Promise<{ runId: number; items: ConsistencyItem[] }> {
        // ensureDbMigrations(); // Removed: migrations should be handled at app startup

        const runResult = await pool.query(`
      INSERT INTO report_consistency_runs (report_version_id, status, engine_version, created_at)
      VALUES ($1, 'running', $2, NOW())
      RETURNING id;
    `, [reportVersionId, ENGINE_VERSION]);

        const runId = (runResult.rows[0] as any)?.id as number;
        if (!runId) {
            throw new Error('Failed to create consistency run');
        }

        const items = this.runChecks(parsedJson);

        // Upsert each item, preserving human_status and human_comment
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
        const summary = {
            fail: items.filter(i => i.autoStatus === 'FAIL').length,
            uncertain: items.filter(i => i.autoStatus === 'UNCERTAIN').length,
            pass: items.filter(i => i.autoStatus === 'PASS').length,
            notAssessable: items.filter(i => i.autoStatus === 'NOT_ASSESSABLE').length,
            total: items.length,
        };

        await pool.query(`
      UPDATE report_consistency_runs
      SET status = 'succeeded', summary_json = $1, finished_at = NOW()
      WHERE id = $2;
    `, [JSON.stringify(summary), runId]);

        return { runId, items };
    }
}

export const consistencyCheckService = new ConsistencyCheckService();
