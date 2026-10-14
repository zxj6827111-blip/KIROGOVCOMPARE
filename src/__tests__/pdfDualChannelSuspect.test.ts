/**
 * Phase 3 — suspect table triggers and the "only adopt if FAIL count drops" rule.
 */
jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock('../services/AiModelConfigService', () => ({
    __esModule: true,
    aiModelConfigService: {
        resolveRuntime: jest.fn().mockResolvedValue({
            apiKey: 'k',
            baseUrl: 'https://example.invalid',
            model: 'vision-model',
            provider: 'openai',
            source: 'test',
        }),
    },
}));

import fs from 'fs';
import path from 'path';

import pool from '../config/database-llm';
import { VisionReviewService } from '../services/VisionReviewService';
import { assessRepairImprovement, applyOcrDifferences } from '../services/pdf-dual-channel/visionRepair';
import {
    collectSuspectTables,
    evaluateRepairImprovement,
    suspectTableIds,
    tableIdForCellRef,
    tableIdForCheckKey,
} from '../services/pdf-dual-channel/suspectTables';

describe('suspect table signals', () => {
    it('maps canonical cell refs and check keys to their table', () => {
        expect(tableIdForCellRef('application:new_received:natural_person')).toBe('table_3');
        expect(tableIdForCellRef('active_disclosure:regulations:made')).toBe('table_2');
        expect(tableIdForCellRef('legal_proceeding:review:total')).toBe('table_4');
        expect(tableIdForCellRef('unknown:x:y')).toBeNull();
        expect(tableIdForCheckKey('t3_result_total_total')).toBe('table_3');
        expect(tableIdForCheckKey('t4_sum_review')).toBe('table_4');
    });

    it('fires on a dual-channel conflict even when every 勾稽 check passed', () => {
        // The case the old trigger was blind to: both channels read a figure, they disagree,
        // and each side is internally consistent.
        const suspect = collectSuspectTables({
            consistencyFailureTableIds: [],
            dualChannel: {
                verdict: 'conflict',
                conflicts: [{ ref: 'application:granted:natural_person', status: 'conflict' }],
                coverage: { candidateSectionTypes: ['table_2', 'table_3', 'table_4'] },
            },
        });
        expect(suspectTableIds(suspect)).toEqual(['table_3']);
        expect(suspect.table_3).toEqual(['dual_channel_conflict']);
    });

    it('counts coverage gaps as a missing table, not as agreement', () => {
        const suspect = collectSuspectTables({
            dualChannel: {
                verdict: 'agree',
                conflicts: [],
                coverage: { candidateSectionTypes: ['table_2', 'table_3'], table3RowsFilled: 22, table3RowsExpected: 25 },
            },
        });
        expect(suspect.table_4).toEqual(['table_missing']);
        // A short 表三 is not a missing 表三: the row gap is caught by 勾稽, not here.
        expect(suspect.table_3).toEqual([]);
    });

    it('treats a document without ruled lines as suspect for every table', () => {
        const suspect = collectSuspectTables({ visualBorderMissing: true });
        expect(suspectTableIds(suspect)).toEqual(['table_2', 'table_3', 'table_4']);
        expect(suspect.table_2).toEqual(['visual_border_missing']);
    });

    it('keeps the consistency failures and stacks reasons without duplicating them', () => {
        const suspect = collectSuspectTables({
            consistencyFailureTableIds: ['table_3', 'table_3'],
            visualBorderMissing: true,
            dualChannel: { conflicts: [{ ref: 'application:x:y', status: 'conflict' }] },
        });
        expect(suspect.table_3).toEqual(['consistency_failure', 'visual_border_missing', 'dual_channel_conflict']);
    });

    it('ignores non-conflict diffs (a_gap / b_only are coverage, not disagreement)', () => {
        const suspect = collectSuspectTables({
            dualChannel: {
                conflicts: [
                    { ref: 'application:x:y', status: 'a_only' },
                    { ref: 'active_disclosure:x:y', status: 'b_only' },
                ],
            },
        });
        expect(suspectTableIds(suspect)).toEqual([]);
    });

    it('returns nothing when there is no evidence at all', () => {
        expect(suspectTableIds(collectSuspectTables({}))).toEqual([]);
        expect(suspectTableIds(collectSuspectTables({ dualChannel: null }))).toEqual([]);
    });
});

describe('evaluateRepairImprovement — 只有改善才采纳', () => {
    it('adopts only a repair that removes every failure', () => {
        const decision = evaluateRepairImprovement({
            beforeFailKeys: ['t3_result_total_total', 't4_sum_review'],
            afterFailKeys: [],
        });
        expect(decision).toMatchObject({ adopt: true, reason: 'improved', beforeFailCount: 2, afterFailCount: 0 });
    });

    it('rejects fewer failures that are still failures', () => {
        expect(
            evaluateRepairImprovement({ beforeFailKeys: ['a', 'b'], afterFailKeys: ['a'] }).reason
        ).toBe('still_failing');
    });

    it('rejects a swap: same count, different keys', () => {
        const decision = evaluateRepairImprovement({ beforeFailKeys: ['a'], afterFailKeys: ['b'] });
        expect(decision.adopt).toBe(false);
        expect(decision.reason).toBe('new_failure_introduced');
        expect(decision.newFailKeys).toEqual(['b']);
    });

    it('rejects no change and a worse result', () => {
        expect(evaluateRepairImprovement({ beforeFailKeys: [], afterFailKeys: [] }).reason).toBe('no_change');
        expect(evaluateRepairImprovement({ beforeFailKeys: ['a'], afterFailKeys: ['a', 'b'] }).reason).toBe('worse');
    });

    it('de-duplicates repeated keys before counting', () => {
        expect(
            evaluateRepairImprovement({ beforeFailKeys: ['a', 'a', 'b'], afterFailKeys: [] }).beforeFailCount
        ).toBe(2);
    });
});

describe('vision repair re-verification', () => {
    function table3Payload(granted: number) {
        return {
            sections: [
                {
                    type: 'table_3',
                    title: '三',
                    tableData: {
                        naturalPerson: { newReceived: 10, carriedOver: 0, results: { granted, totalProcessed: 10, carriedForward: 0 } },
                    },
                },
            ],
        };
    }

    /** Fake checker: the identity holds only when granted is 10. */
    const runChecks = (payload: any) => {
        const granted = payload.sections[0].tableData.naturalPerson.results.granted;
        return [{ checkKey: 't3_identity_naturalPerson', autoStatus: granted === 10 ? 'PASS' : 'FAIL' }];
    };

    it('patches the OCR value into a copy, leaving the original untouched', () => {
        const original = table3Payload(9);
        const { patched, applied } = applyOcrDifferences(original, 'table_3', [
            {
                path: 'tableData.naturalPerson.results.granted',
                parsedValue: 9,
                ocrValue: 10,
            },
        ]);
        expect(applied).toBe(1);
        expect(patched.sections[0].tableData.naturalPerson.results.granted).toBe(10);
        expect(original.sections[0].tableData.naturalPerson.results.granted).toBe(9);
    });

    it('adopts only when the repair clears every failure', () => {
        const adopting = assessRepairImprovement({
            parsedJson: table3Payload(9),
            tableId: 'table_3',
            differences: [
                { path: 'tableData.naturalPerson.results.granted', parsedValue: 9, ocrValue: 10 },
            ],
            runChecks,
        });
        expect(adopting).toMatchObject({ adopt: true, reason: 'improved', beforeFailCount: 1, afterFailCount: 0, patchedCellCount: 1 });

        const useless = assessRepairImprovement({
            parsedJson: table3Payload(9),
            tableId: 'table_3',
            differences: [{ path: 'tableData.naturalPerson.results.granted', parsedValue: 9, ocrValue: 8 }],
            runChecks,
        });
        expect(useless).toMatchObject({ adopt: false, reason: 'no_change' });
    });

    it('never patches a path outside its own table, and reports zero cells applied', () => {
        const { patched, applied } = applyOcrDifferences(table3Payload(9), 'table_3', [
            { path: 'activeDisclosureData.regulations.made', parsedValue: 1, ocrValue: 2 },
        ]);
        expect(applied).toBe(0);
        expect(patched.sections[0].tableData.naturalPerson.results.granted).toBe(9);
    });

    it('is a no-op on a payload without sections', () => {
        const input = { foo: 1 };
        expect(applyOcrDifferences(input as any, 'table_2', []).applied).toBe(0);
        expect(applyOcrDifferences(input as any, 'table_2', [
            { path: 'activeDisclosureData.regulations.made', parsedValue: 1, ocrValue: 2 },
        ])).toEqual({ patched: input, applied: 0 });
    });
});

describe('VisionReviewService adoption wiring (source structure)', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/services/VisionReviewService.ts'), 'utf8');

    it('persists the assessment and only adopts when the flag is on', () => {
        expect(source).toContain('assessRepairImprovement');
        expect(source).toContain('repairAssessment');
        expect(source).toContain("parseBooleanEnv(process.env.PDF_VISION_AUTO_ADOPT, false)");
        // the write path is the existing human-approved one, not a bespoke UPDATE
        expect(source).toContain("await import('./OcrCorrectionService')");
        expect(source).toMatch(/if \(!parseBooleanEnv\(process\.env\.PDF_VISION_AUTO_ADOPT, false\)\) \{\s*\n\s*return;/);
    });
});

describe('VisionReviewService enqueue honours the new signals', () => {
    let inserts: Array<{ sql: string; params: any[] }>;
    const service = new VisionReviewService();

    beforeEach(() => {
        process.env.VISION_REVIEW_ENABLED = '1';
        inserts = [];
        (pool.query as jest.Mock).mockReset();
        (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
            const text = String(sql);
            inserts.push({ sql: text, params });
            if (text.includes('FROM report_versions') && text.includes('file_hash')) {
                return {
                    rows: [{ id: 9, report_id: 5, file_hash: 'hash-1', storage_path: 'x.pdf', parsed_json: {} }],
                    rowCount: 1,
                };
            }
            if (text.includes('RETURNING')) {
                return { rows: [{ id: 1, status: 'queued' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        });
    });

    function enqueuedTables(): string[] {
        return inserts
            .filter((entry) => entry.sql.includes('INSERT INTO table_visual_reviews'))
            .map((entry) => String(entry.params[2]));
    }

    it('queues a table that only the dual channel flagged', async () => {
        const count = await service.enqueueForConsistencyItems(5, 9, [], false, {
            dualChannel: {
                verdict: 'conflict',
                conflicts: [{ ref: 'legal_proceeding:review:total', status: 'conflict' }],
                coverage: { candidateSectionTypes: ['table_2', 'table_3', 'table_4'] },
            },
        });
        expect(count).toBe(1);
        expect(enqueuedTables()).toEqual(['table_4']);
    });

    it('queues every table when the borders are missing', async () => {
        await service.enqueueForConsistencyItems(5, 9, [], false, { visualBorderMissing: true });
        expect(enqueuedTables().sort()).toEqual(['table_2', 'table_3', 'table_4']);
    });

    it('queues nothing with no evidence, so the old behaviour is unchanged', async () => {
        await expect(service.enqueueForConsistencyItems(5, 9, [], false)).resolves.toBe(0);
        expect(inserts.filter((entry) => entry.sql.includes('table_visual_reviews'))).toHaveLength(0);
    });

    it('records which signal fired in trigger_reason', async () => {
        await service.enqueueForConsistencyItems(5, 9, [], false, {
            dualChannel: { conflicts: [{ ref: 'application:x:y', status: 'conflict' }] },
        });
        const insert = inserts.find((entry) => entry.sql.includes('INSERT INTO table_visual_reviews'))!;
        const reason = JSON.stringify(insert.params);
        expect(reason).toContain('dual_channel_conflict:table_3');
    });
});
