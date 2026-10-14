import { evaluateRepairImprovement, type ImprovementDecision } from './suspectTables';

/**
 * Phase 3 — visual repair re-verification.
 *
 * A vision reading that disagrees with the stored figures is only useful if we can say
 * whether adopting it would actually make the document more consistent. That is decided here,
 * in memory, before anything is written: patch the OCR values into a copy of the payload,
 * re-run the 勾稽 checks on both versions, and compare the FAIL sets.
 */

export type VisionReviewTableId = 'table_2' | 'table_3' | 'table_4';

const PAYLOAD_KEY: Record<VisionReviewTableId, string> = {
    table_2: 'activeDisclosureData',
    table_3: 'tableData',
    table_4: 'reviewLitigationData',
};

export interface RepairDifference {
    path: string;
    parsedValue: unknown;
    ocrValue: unknown;
}

export interface RepairAssessment extends ImprovementDecision {
    tableId: VisionReviewTableId;
    patchedCellCount: number;
}

/** 'tableData.naturalPerson.results.granted' minus the payload key -> nested path. */
function splitPath(path: string, tableId: VisionReviewTableId): string[] | null {
    const prefix = `${PAYLOAD_KEY[tableId]}.`;
    if (!String(path || '').startsWith(prefix)) {
        return null;
    }
    return path.slice(prefix.length).split('.').filter(Boolean);
}

/**
 * Returns a patched clone of the payload. Untouched inputs are left alone: an unknown path,
 * a missing section, or an empty diff list all yield the original object, so a bad vision
 * answer can never silently invent structure.
 */
export function applyOcrDifferences(
    parsedJson: Record<string, any>,
    tableId: VisionReviewTableId,
    differences: RepairDifference[]
): { patched: Record<string, any>; applied: number } {
    if (!parsedJson || !Array.isArray(differences) || differences.length === 0) {
        return { patched: parsedJson, applied: 0 };
    }

    const sections = Array.isArray(parsedJson.sections) ? parsedJson.sections : null;
    if (!sections) {
        return { patched: parsedJson, applied: 0 };
    }

    const patched: Record<string, any> = JSON.parse(JSON.stringify(parsedJson));
    const section = (patched.sections as any[]).find((entry) => entry?.type === tableId);
    if (!section) {
        return { patched: parsedJson, applied: 0 };
    }

    const payloadKey = PAYLOAD_KEY[tableId];
    if (!section[payloadKey] || typeof section[payloadKey] !== 'object') {
        section[payloadKey] = {};
    }

    let applied = 0;
    for (const difference of differences) {
        const segments = splitPath(difference.path, tableId);
        if (!segments || segments.length === 0) {
            continue;
        }
        let cursor = section[payloadKey];
        for (const segment of segments.slice(0, -1)) {
            if (cursor[segment] === undefined || cursor[segment] === null || typeof cursor[segment] !== 'object') {
                cursor[segment] = {};
            }
            cursor = cursor[segment];
        }
        cursor[segments[segments.length - 1]] = difference.ocrValue;
        applied += 1;
    }

    return { patched, applied };
}

export interface AssessInput {
    parsedJson: Record<string, any>;
    tableId: VisionReviewTableId;
    differences: RepairDifference[];
    /** runChecks is injected so this module stays free of the checker's DB imports. */
    runChecks: (payload: Record<string, any>) => Array<{ checkKey: string; autoStatus: string }>;
    reportYear?: number | null;
}

/**
 * Decide whether adopting this vision repair would lower the FAIL count. Only a repair that
 * clears every failure is adopted, so "fewer wrong figures" is never treated as fixed.
 */
export function assessRepairImprovement(input: AssessInput): RepairAssessment {
    const failKeys = (payload: Record<string, any>) =>
        input
            .runChecks(payload)
            .filter((item) => item.autoStatus === 'FAIL')
            .map((item) => item.checkKey);

    const { patched, applied } = applyOcrDifferences(input.parsedJson, input.tableId, input.differences);
    const decision = evaluateRepairImprovement({
        beforeFailKeys: failKeys(input.parsedJson),
        afterFailKeys: applied > 0 ? failKeys(patched) : failKeys(input.parsedJson),
    });

    return { ...decision, tableId: input.tableId, patchedCellCount: applied };
}
