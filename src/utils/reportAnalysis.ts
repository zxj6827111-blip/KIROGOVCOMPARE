import { calculateTextSimilarity } from './diffRenderer';

interface Section {
    title: string;
    type?: string;
    content?: string;
    tableData?: any;
}

interface ReportData {
    sections: Section[];
}

export const calculateReportMetrics = (leftData: any, rightData: any): { similarity: number, checkStatus: string | null } => {
    // 1. Align Sections (Logic from ComparisonDetailView.js)
    const sections: { title: string, oldSec?: Section, newSec?: Section }[] = [];
    const leftSections: Section[] = leftData?.sections || [];
    const rightSections: Section[] = rightData?.sections || [];

    leftSections.forEach(s => sections.push({ title: s.title, oldSec: s }));

    rightSections.forEach(s => {
        const existing = sections.find(a => a.title === s.title);
        if (existing) existing.newSec = s;
        else sections.push({ title: s.title, newSec: s });
    });

    // 2. Similarity Average (Logic from ComparisonDetailView.js)
    let totalTextSim = 0;
    let textSectionsCount = 0;

    sections.forEach(sec => {
        if (sec.title === '标题' || sec.title?.includes('年度报告')) return;

        if (sec.oldSec?.type === 'text' && sec.newSec?.type === 'text') {
            const sim = calculateTextSimilarity(sec.oldSec.content || '', sec.newSec.content || '');
            totalTextSim += sim;
            textSectionsCount++;
        }
    });

    const avgTextRep = textSectionsCount > 0 ? Math.round(totalTextSim / textSectionsCount) : 0;

    // 3. Consistency Check
    // Find Table 2 and Table 3
    const findTable2 = (data: any) => data?.sections?.find((s: any) => s.type === 'table_2')?.activeDisclosureData;
    const findTable3 = (data: any) => data?.sections?.find((s: any) => s.type === 'table_3')?.tableData;

    const oldT2 = findTable2(leftData);
    const newT2 = findTable2(rightData);
    const oldT3 = findTable3(leftData);
    const newT3 = findTable3(rightData);

    let checkStatus: string | null = null;
    const issues: string[] = [];

    // --- Table 2 Cross-Year Check: 规章/行政规范性文件 ---
    // Formula: CurrentYear.valid = PreviousYear.valid + CurrentYear.made - CurrentYear.repealed
    if (oldT2 && newT2) {
        // Check 规章 (regulations)
        const oldRegValid = oldT2.regulations?.valid;
        const newRegMade = newT2.regulations?.made;
        const newRegRepealed = newT2.regulations?.repealed;
        const newRegValid = newT2.regulations?.valid;

        if (typeof oldRegValid === 'number' && typeof newRegMade === 'number' &&
            typeof newRegRepealed === 'number' && typeof newRegValid === 'number') {
            const expected = oldRegValid + newRegMade - newRegRepealed;
            if (expected !== newRegValid) {
                issues.push(`规章:${oldRegValid}+${newRegMade}-${newRegRepealed}≠${newRegValid}`);
            }
        }

        // Check 行政规范性文件 (normativeDocuments)
        const oldNormValid = oldT2.normativeDocuments?.valid;
        const newNormMade = newT2.normativeDocuments?.made;
        const newNormRepealed = newT2.normativeDocuments?.repealed;
        const newNormValid = newT2.normativeDocuments?.valid;

        if (typeof oldNormValid === 'number' && typeof newNormMade === 'number' &&
            typeof newNormRepealed === 'number' && typeof newNormValid === 'number') {
            const expected = oldNormValid + newNormMade - newNormRepealed;
            if (expected !== newNormValid) {
                issues.push(`规范性文件:${oldNormValid}+${newNormMade}-${newNormRepealed}≠${newNormValid}`);
            }
        }
    }

    // --- Table 3 Cross-Year Check: 结转下年 vs 上年结转 ---
    if (oldT3 && newT3) {
        const oldVal = oldT3.total?.results?.carriedForward;
        const newVal = newT3.total?.carriedOver;

        if (typeof oldVal === 'number' && typeof newVal === 'number') {
            if (oldVal !== newVal) {
                issues.push(`结转:${oldVal}≠${newVal}`);
            }
        } else if (!((oldVal === null || oldVal === undefined) && (newVal === null || newVal === undefined))) {
            // One exists one doesn't
            issues.push(`结转数据不完整`);
        }
    }

    // Determine final status with details
    if (issues.length > 0) {
        // Format: "异常(结转|规章|规范性文件)"
        const issueTypes = issues.map(i => i.split(':')[0]).join('|');
        checkStatus = `异常(${issueTypes})`;
    } else if ((oldT2 && newT2) || (oldT3 && newT3)) {
        checkStatus = '正常';
    }
    // If no tables found, checkStatus remains null

    return { similarity: avgTextRep, checkStatus };
};
