import { ValidationResult, ValidationIssue } from '../types/models';

/**
 * Interface representing the JSON structure from Gemini
 */
interface Table3Data {
    naturalPerson: EntityData;
    legalPerson: {
        commercial: EntityData;
        research: EntityData;
        social: EntityData;
        legal: EntityData;
        other: EntityData;
    };
    total: EntityData;
}

interface EntityData {
    newReceived: number;
    carriedOver: number;
    results: {
        granted: number;
        partialGrant: number;
        denied: {
            stateSecret: number;
            lawForbidden: number;
            safetyStability: number;
            thirdPartyRights: number;
            internalAffairs: number;
            processInfo: number;
            enforcementCase: number;
            adminQuery: number;
        };
        unableToProvide: {
            noInfo: number;
            needCreation: number;
            unclear: number;
        };
        notProcessed: {
            complaint: number;
            repeat: number;
            publication: number;
            massiveRequests: number;
            confirmInfo: number;
        };
        other: {
            overdueCorrection: number;
            overdueFee: number;
            otherReasons: number;
        };
        totalProcessed: number;
        carriedForward: number;
    };
}

export class ConsistencyValidationService {

    /**
     * Validate an entire parsed report for consistency
     */
    public validateReport(parsedData: any): ValidationResult {
        const allIssues: ValidationIssue[] = [];

        // Extract sections and validate Table 3 data if available
        const sections = parsedData?.sections || [];

        // Find Table 3 section
        const table3Section = sections.find((s: any) => s.type === 'table_3');

        if (table3Section?.tableData) {
            // Validate current year data
            const currentYearResult = this.validateTable3(table3Section.tableData, '当前年度');
            allIssues.push(...currentYearResult.issues);
        }

        // Find Table 4 section
        const table4Section = sections.find((s: any) => s.type === 'table_4');

        if (table4Section?.reviewLitigationData) {
            // Validate table 4 data
            const table4Result = this.validateTable4(table4Section.reviewLitigationData, '当前年度');
            allIssues.push(...table4Result.issues);
        }

        // Cross-validate: Text mentions of application totals vs Table 3 data
        // NOTE: Disabled per user request - do not compare text application counts with table
        // const textSections = sections.filter((s: any) => s.type === 'text');
        // if (table3Section?.tableData && textSections.length > 0) {
        //     const crossCheckResult = this.checkTextVsTable(textSections, table3Section.tableData);
        //     allIssues.push(...crossCheckResult);
        // }

        return {
            issues: allIssues,
            score: Math.max(0, 100 - allIssues.length * 10)
        };
    }

    /**
     * Validate a single year's Table 3 data for internal consistency
     */
    public validateTable3(data: any, yearLabel: string): ValidationResult {
        const issues: ValidationIssue[] = [];
        if (!data) return { issues, score: 100 };

        // Assuming data matches the structure from GeminiLlmProvider (table3)
        const table3 = data as Table3Data;

        // 1. Horizontal Check: Natural + Legal(...) = Total
        this.checkHorizontalSum(table3, issues, yearLabel);

        // 2. Vertical Check: Processed Results Sum = Total Processed
        this.checkVerticalSum(table3, issues, yearLabel);

        // 3. Balance Check: New + CarriedOver = TotalProcessed + CarriedForward
        this.checkBalance(table3, issues, yearLabel);

        return {
            issues,
            score: Math.max(0, 100 - issues.length * 10),
        };
    }

    /**
     * Check consistency between two years (Cross-Year Check)
     */
    public validateCrossYear(
        prevYearData: any,
        currYearData: any,
        prevYear: number | string,
        currYear: number | string
    ): ValidationIssue[] {
        const issues: ValidationIssue[] = [];
        if (!prevYearData || !currYearData) return issues;

        const t3Prev = prevYearData as Table3Data;
        const t3Curr = currYearData as Table3Data;

        // Check: PrevYear.CarriedForward == CurrYear.CarriedOver
        // We check this for 'total' column mainly, but can check others

        const prevForward = t3Prev.total?.results?.carriedForward || 0;
        const currOver = t3Curr.total?.carriedOver || 0;

        if (prevForward !== currOver) {
            issues.push({
                severity: 'warning', // Could be error, but sometimes years don't align perfectly due to corrections
                code: 'CROSS_YEAR_MISMATCH',
                message: `跨年数据不一致: ${prevYear}年"结转下年度" (${prevForward}) 不等于 ${currYear}年"上年结转" (${currOver})`,
                location: '跨年勾稽关系',
                relatedValues: {
                    expected: prevForward,
                    actual: currOver
                }
            });
        }

        return issues;
    }

    private checkHorizontalSum(data: Table3Data, issues: ValidationIssue[], yearLabel: string) {
        const categories = ['commercial', 'research', 'social', 'legal', 'other'];

        // Helper to get value
        const getVal = (entity: EntityData, path: string[]) => {
            let val: any = entity;
            for (const p of path) {
                val = val?.[p];
            }
            return Number(val) || 0;
        };

        // Paths to check
        const pathsToCheck = [
            ['newReceived'],
            ['carriedOver'],
            ['results', 'granted'],
            ['results', 'partialGrant'],
            ['results', 'totalProcessed'],
            ['results', 'carriedForward']
            // Can add specific denied reasons if needed
        ];

        pathsToCheck.forEach(path => {
            const natural = getVal(data.naturalPerson, path);
            const othersSum = data.legalPerson ? categories.reduce((sum, cat) => sum + getVal((data.legalPerson as any)[cat], path), 0) : 0;
            const total = getVal(data.total, path);

            if ((data.naturalPerson || data.legalPerson || data.total) && natural + othersSum !== total) {
                issues.push({
                    severity: 'error',
                    code: 'HORIZONTAL_SUM_MISMATCH',
                    message: `${yearLabel} - 横向合计错误: 自然人(${natural}) + 法人其他(${othersSum}) ≠ 总计(${total}) [${path.join('.')}]`,
                    location: `Table 3 - ${path.join('.')}`,
                    relatedValues: {
                        expected: natural + othersSum,
                        actual: total
                    }
                });
            }
        });
    }

    private checkVerticalSum(data: Table3Data, issues: ValidationIssue[], yearLabel: string) {
        const entities = [
            { name: '总计', data: data.total },
            { name: '自然人', data: data.naturalPerson },
            // We can check others, but Total is most critical
        ];

        entities.forEach(ent => {
            const res = ent.data?.results;
            if (!res) return;

            const sum =
                (res.granted || 0) +
                (res.partialGrant || 0) +
                Object.values(res.denied || {}).reduce((a, b) => a + (b || 0), 0) +
                Object.values(res.unableToProvide || {}).reduce((a, b) => a + (b || 0), 0) +
                Object.values(res.notProcessed || {}).reduce((a, b) => a + (b || 0), 0) +
                Object.values(res.other || {}).reduce((a, b) => a + (b || 0), 0);

            if (sum !== res.totalProcessed) {
                issues.push({
                    severity: 'error',
                    code: 'VERTICAL_SUM_MISMATCH',
                    message: `${yearLabel} - 纵向合计错误 (${ent.name}): 各分项之和(${sum}) ≠ 本年处理总数(${res.totalProcessed})`,
                    location: `Table 3 - ${ent.name}`,
                    relatedValues: {
                        expected: sum,
                        actual: res.totalProcessed
                    }
                });
            }
        });
    }

    private checkBalance(data: Table3Data, issues: ValidationIssue[], yearLabel: string) {
        // Input = Output + Pending
        // NewReceived + CarriedOver = TotalProcessed + CarriedForward
        const entities = [{ name: '总计', data: data.total }]; // Checking Total is usually sufficient

        entities.forEach(ent => {
            const d = ent.data;
            if (!d) return;

            const input = (d.newReceived || 0) + (d.carriedOver || 0);
            const output = (d.results?.totalProcessed || 0) + (d.results?.carriedForward || 0);

            if (input !== output) {
                issues.push({
                    severity: 'error',
                    code: 'BALANCE_MISMATCH',
                    message: `${yearLabel} - 借贷平衡错误 (${ent.name}): (新收+结转) ${input} ≠ (办理+结转) ${output}`,
                    location: `Table 3 - ${ent.name}`,
                    relatedValues: {
                        expected: input,
                        actual: output
                    }
                });
            }
        });
    }

    /**
     * Validate Table 4 (行政复议、行政诉讼情况)
     */
    public validateTable4(data: any, yearLabel: string): ValidationResult {
        const issues: ValidationIssue[] = [];
        if (!data) return { issues, score: 100 };

        // 检查三个类别：行政复议、直接行政诉讼、复议后行政诉讼
        const categories = [
            { key: 'review', name: '行政复议' },
            { key: 'litigationDirect', name: '直接行政诉讼' },
            { key: 'litigationPostReview', name: '复议后行政诉讼' }
        ];

        categories.forEach(cat => {
            const categoryData = data[cat.key];
            if (!categoryData) return;

            const maintain = categoryData.maintain || 0;
            const correct = categoryData.correct || 0;
            const other = categoryData.other || 0;
            const unfinished = categoryData.unfinished || 0;
            const total = categoryData.total || 0;

            const calculatedTotal = maintain + correct + other + unfinished;

            if (calculatedTotal !== total) {
                issues.push({
                    severity: 'error',
                    code: 'TABLE4_TOTAL_MISMATCH',
                    message: `${yearLabel} - ${cat.name}总计错误: 维持(${maintain}) + 纠正(${correct}) + 其他(${other}) + 尚未审结(${unfinished}) = ${calculatedTotal} ≠ 总计(${total})`,
                    location: `Table 4 - ${cat.name}`,
                    relatedValues: {
                        expected: calculatedTotal,
                        actual: total
                    }
                });
            }
        });

        return {
            issues,
            score: Math.max(0, 100 - issues.length * 10)
        };
    }

    /**
     * Cross-validate text mentions of application totals against Table 3 data
     * Text should mention: totalProcessed + carriedForward = total applications handled this year
     */
    private checkTextVsTable(textSections: any[], table3Data: Table3Data): ValidationIssue[] {
        const issues: ValidationIssue[] = [];

        // Calculate expected total from Table 3: (七)总计 + 四、结转下年度
        const totalProcessed = table3Data.total?.results?.totalProcessed || 0;
        const carriedForward = table3Data.total?.results?.carriedForward || 0;
        const expectedTotal = totalProcessed + carriedForward;

        // Also check: newReceived + carriedOver = expected total (this should already be validated)
        const newReceived = table3Data.total?.newReceived || 0;
        const carriedOver = table3Data.total?.carriedOver || 0;
        const inputTotal = newReceived + carriedOver;

        // Patterns to match application total mentions in text
        const patterns = [
            /(?:共|总计|合计)?(?:收到|受理|接收|办理)(?:政府信息公开)?申请[：:共计合]?\s*(\d+)\s*(?:件|份|起|条)?/g,
            /(?:政府信息公开)?申请(?:数量|总量|总数)[：:为]?\s*(\d+)\s*(?:件|份|起|条)?/g,
            /(?:本年度|本年|今年)(?:共)?(?:收到|受理|接收|办理).*?(\d+)\s*(?:件|份|起)?(?:申请)?/g,
        ];

        // Scan all text sections for application total mentions
        for (const section of textSections) {
            const content = section.content || '';
            const sectionTitle = section.title || '';

            for (const pattern of patterns) {
                pattern.lastIndex = 0; // Reset regex state
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    const textValue = parseInt(match[1], 10);

                    // Check if the text value matches expected total OR input total
                    // (both should be equal if balance is correct)
                    if (textValue !== expectedTotal && textValue !== inputTotal) {
                        // Only report if the difference is significant and the number seems to be an application count
                        if (textValue > 0 && Math.abs(textValue - expectedTotal) > 0) {
                            issues.push({
                                severity: 'warning',
                                code: 'TEXT_VS_TABLE_MISMATCH',
                                message: `正文与表格数据不一致: 正文提及申请数"${textValue}"件，但表三计算值为 (七)总计(${totalProcessed}) + 四、结转(${carriedForward}) = ${expectedTotal}`,
                                location: `正文「${sectionTitle}」 vs 表三`,
                                relatedValues: {
                                    expected: expectedTotal,
                                    actual: textValue
                                },
                                evidence: {
                                    paths: ['text.content', 'tableData.total.results.totalProcessed', 'tableData.total.results.carriedForward'],
                                    values: {
                                        textValue,
                                        tableTotal: expectedTotal,
                                        totalProcessed,
                                        carriedForward,
                                        matchedText: match[0],
                                        sectionTitle,
                                        context: content.substring(Math.max(0, match.index - 30), match.index + match[0].length + 30)
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }

        return issues;
    }
}

export default new ConsistencyValidationService();
