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
}

export default new ConsistencyValidationService();
