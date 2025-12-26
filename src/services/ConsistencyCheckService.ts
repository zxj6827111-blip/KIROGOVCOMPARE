import crypto from 'crypto';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

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
export type GroupKey = 'table2' | 'table3' | 'table4' | 'text';

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

                const paths = [
                    `${basePath}.results.granted`,
                    `${basePath}.results.partialGrant`,
                    `${basePath}.results.denied.*`,
                    `${basePath}.results.unableToProvide.*`,
                    `${basePath}.results.notProcessed.*`,
                    `${basePath}.results.other.*`,
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
        const fieldsToCheck = [
            { field: 'newReceived', name: '本年新收' },
            { field: 'carriedOver', name: '上年结转' },
            { field: 'totalProcessed', isResult: true, name: '办理结果总计' },
            { field: 'carriedForward', isResult: true, name: '结转下年度' },
        ];

        for (const { field, isResult, name } of fieldsToCheck) {
            const entityKeysForSum = [
                'naturalPerson',
                'legalPerson.commercial',
                'legalPerson.research',
                'legalPerson.social',
                'legalPerson.legal',
                'legalPerson.other',
            ];

            const paths: string[] = [];
            const values: Record<string, any> = {};
            let hasAll = true;
            let sum = 0;

            for (const ek of entityKeysForSum) {
                const entity = this.getEntityData(tableData, ek);
                const val = isResult
                    ? this.parseNumber((entity?.results as any)?.[field])
                    : this.parseNumber((entity as any)?.[field]);

                const path = isResult
                    ? `tableData.${ek}.results.${field}`
                    : `tableData.${ek}.${field}`;

                paths.push(path);
                values[ek] = val;

                if (val === null) {
                    hasAll = false;
                } else {
                    sum += val;
                }
            }

            const totalEntity = tableData.total;
            const totalVal = isResult
                ? this.parseNumber((totalEntity?.results as any)?.[field])
                : this.parseNumber((totalEntity as any)?.[field]);

            paths.push(`tableData.total${isResult ? '.results' : ''}.${field}`);
            values['total'] = totalVal;

            items.push(this.createItem(
                'table3',
                `t3_col_sum_${field}`,
                `表三：自然人+商业企业+科研机构+社会公益组织+法律服务机构+其他=总计（${name}，合计校验）`,
                `sum(all_entities.${field}) = total.${field}`,
                hasAll ? sum : null,
                totalVal,
                0,
                paths,
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
                    // 增强: 支持"回复"、"答复"、"办结"
                    regex: /(?:办理结果|办结|办理|答复|回复).*?(\d+)\s*件/,
                    field: 'totalProcessed',
                    table: 'table3',
                    path: 'tableData.total.results.totalProcessed',
                    getValue: () => this.parseNumber(tableData?.total?.results?.totalProcessed),
                    name: '办理结果总计',
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
                    // 增强: 增加"行政复议"的容错
                    regex: /行政复议.*?(\d+)\s*件/,
                    field: 'reviewTotal',
                    table: 'table4',
                    path: 'reviewLitigationData.review.total',
                    getValue: () => this.parseNumber(table4Data?.review?.total),
                    name: '行政复议总计',
                },
                {
                    // 新增: 行政诉讼总计 = 未经复议 + 复议后起诉
                    regex: /行政诉讼.*?(\d+)\s*件/,
                    field: 'litigationTotal',
                    table: 'table4',
                    path: 'table4.litigationDirect.total + table4.litigationPostReview.total',
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

        // Find Table 3 section
        const table3Section = sections.find((s: any) => s.type === 'table_3');
        const tableData: Table3Data | undefined = table3Section?.tableData;

        // Find Table 4 section
        const table4Section = sections.find((s: any) => s.type === 'table_4');
        const table4Data: Table4Data | undefined = table4Section?.reviewLitigationData;

        // Collect text content
        // Note: generateTextItems now takes sections directly to preserve section titles

        // Generate items for each group
        items.push(...this.generateTable3Items(tableData));
        items.push(...this.generateTable4Items(table4Data));
        items.push(...this.generateTextItems(sections, tableData, table4Data));

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
    public runAndPersist(reportVersionId: number, parsedJson: any): { runId: number; items: ConsistencyItem[] } {
        ensureSqliteMigrations();

        // Create a new run record
        const runResult = querySqlite(`
      INSERT INTO report_consistency_runs (report_version_id, status, engine_version, created_at)
      VALUES (${sqlValue(reportVersionId)}, 'running', ${sqlValue(ENGINE_VERSION)}, datetime('now'))
      RETURNING id;
    `);

        const runId = (runResult[0] as any)?.id as number;
        if (!runId) {
            throw new Error('Failed to create consistency run');
        }

        const items = this.runChecks(parsedJson);

        // Upsert each item, preserving human_status and human_comment
        for (const item of items) {
            const evidenceStr = JSON.stringify(item.evidenceJson);

            querySqlite(`
        INSERT INTO report_consistency_items (
          run_id, report_version_id, group_key, check_key, fingerprint,
          title, expr, left_value, right_value, delta, tolerance, auto_status,
          evidence_json, human_status, created_at, updated_at
        ) VALUES (
          ${sqlValue(runId)}, ${sqlValue(reportVersionId)}, ${sqlValue(item.groupKey)}, ${sqlValue(item.checkKey)}, ${sqlValue(item.fingerprint)},
          ${sqlValue(item.title)}, ${sqlValue(item.expr)}, ${sqlValue(item.leftValue)}, ${sqlValue(item.rightValue)}, ${sqlValue(item.delta)}, ${sqlValue(item.tolerance)}, ${sqlValue(item.autoStatus)},
          ${sqlValue(evidenceStr)}, 'pending', datetime('now'), datetime('now')
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
          updated_at = datetime('now');
      `);
        }

        // Update run with summary
        const summary = {
            fail: items.filter(i => i.autoStatus === 'FAIL').length,
            uncertain: items.filter(i => i.autoStatus === 'UNCERTAIN').length,
            pass: items.filter(i => i.autoStatus === 'PASS').length,
            notAssessable: items.filter(i => i.autoStatus === 'NOT_ASSESSABLE').length,
            total: items.length,
        };

        querySqlite(`
      UPDATE report_consistency_runs
      SET status = 'succeeded', summary_json = ${sqlValue(JSON.stringify(summary))}, finished_at = datetime('now')
      WHERE id = ${sqlValue(runId)};
    `);

        return { runId, items };
    }
}

export const consistencyCheckService = new ConsistencyCheckService();
