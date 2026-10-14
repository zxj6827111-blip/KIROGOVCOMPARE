/**
 * Phase 1 — dual-channel decision table. Every verdict the gate can produce must be
 * reachable here, because Phase 2 will let `agree` skip the LLM.
 */
import { compareChannelOutputs, summariseConsistency } from '../services/pdf-dual-channel/channelCompare';
import { readDualChannelMode, readDualChannelVersion } from '../services/pdf-dual-channel/config';
import {
    rebuildTableDataFromCells,
    TABLE3_CELL_COL_KEYS,
    TABLE3_CELL_ROW_KEYS,
} from '../utils/table3CellKeys';

jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: { query: jest.fn(), connect: jest.fn() },
}));

function table2Payload(regulations: Record<string, any>, extra: Record<string, any> = {}) {
    return {
        sections: [
            {
                type: 'table_2',
                title: '二、主动公开政府信息情况',
                activeDisclosureData: { regulations, ...extra },
            },
        ],
    };
}

describe('compareChannelOutputs decision table', () => {
    it('agree — identical figures on every comparable cell', () => {
        const a = table2Payload({ made: 5, repealed: 1, valid: 2 });
        const b = table2Payload({ made: 5, repealed: 1, valid: 2 });
        const result = compareChannelOutputs(a, b);
        expect(result.verdict).toBe('agree');
        expect(result.confidence).toBe(1);
        expect(result.counts).toEqual({ agree: 3, conflict: 0, a_only: 0, b_only: 0 });
        expect(result.conflicts).toEqual([]);
    });

    it('conflict — both channels have a number and they differ', () => {
        const a = table2Payload({ made: 5, repealed: 1, valid: 2 });
        const b = table2Payload({ made: 6, repealed: 1, valid: 2 });
        const result = compareChannelOutputs(a, b);
        expect(result.verdict).toBe('conflict');
        expect(result.counts.conflict).toBe(1);
        expect(result.conflicts[0]).toMatchObject({
            ref: 'active_disclosure:regulations:made',
            a: 5,
            b: 6,
            status: 'conflict',
        });
        expect(result.confidence).toBeCloseTo(2 / 3, 4);
    });

    it('a_gap — Channel A read a figure Channel B could not', () => {
        const a = table2Payload({ made: 5, repealed: 1, valid: 2 });
        const b = table2Payload({ made: null, repealed: 1, valid: 2 });
        expect(compareChannelOutputs(a, b).verdict).toBe('a_gap');
    });

    it('agree_b_superset — Channel B adds figures without contradicting A', () => {
        const a = table2Payload({ made: 5, repealed: 1, valid: 2 });
        const b = table2Payload({ made: 5, repealed: 1, valid: 2 }, { licensing: { processed: 9 } });
        const result = compareChannelOutputs(a, b);
        expect(result.verdict).toBe('agree_b_superset');
        expect(result.counts.b_only).toBe(1);
        expect(result.counts.conflict).toBe(0);
    });

    it('conflict outranks a superset, so a disagreement can never be traded away', () => {
        const a = table2Payload({ made: 5 });
        const b = table2Payload({ made: 6 }, { licensing: { processed: 9 } });
        const result = compareChannelOutputs(a, b);
        expect(result.verdict).toBe('conflict');
        expect(result.counts).toMatchObject({ conflict: 1, b_only: 1 });
    });

    it('no_candidate — neither side produced a cell', () => {
        const result = compareChannelOutputs({ sections: [] }, { sections: [] });
        expect(result.verdict).toBe('no_candidate');
        expect(result.confidence).toBe(0);
    });

    it('treats NA and EMPTY as agreement, not a numeric disagreement', () => {
        const a = table2Payload({ made: '-', repealed: 1, valid: 2 });
        const b = table2Payload({ made: null, repealed: 1, valid: 2 });
        expect(compareChannelOutputs(a, b).verdict).toBe('agree');
    });

    it('treats two different text answers as a conflict', () => {
        const a = table2Payload({ made: '见附件', repealed: 1 });
        const b = table2Payload({ made: '不适用见附件二', repealed: 1 });
        expect(compareChannelOutputs(a, b).verdict).toBe('conflict');
    });

    it('zero is a figure, not a blank', () => {
        const a = table2Payload({ made: 0 });
        const b = table2Payload({ made: null });
        expect(compareChannelOutputs(a, b).verdict).toBe('a_gap');
    });

    it('compares 表三 on the 25 x 7 canonical key space', () => {
        const build = (granted: number, totalProcessed: number) => ({
            sections: [
                {
                    type: 'table_3',
                    title: '三、收到和处理政府信息公开申请情况',
                    tableData: {
                        naturalPerson: {
                            newReceived: granted,
                            carriedOver: 0,
                            results: { granted, totalProcessed, carriedForward: 0 },
                        },
                    },
                },
            ],
        });
        const result = compareChannelOutputs(build(9, 33), build(8, 33));
        expect(result.verdict).toBe('conflict');
        expect(result.conflicts.map((diff) => diff.ref)).toContain('application:new_received:natural_person');
        expect(result.conflicts.map((diff) => diff.ref)).toContain('application:granted:natural_person');
    });

    it('caps the reported conflict list but keeps the counts exact', () => {
        // 表三 is the only canonical space wide enough to exceed the report cap:
        // 25 rows x 7 applicant columns.
        const buildTable3 = (value: number) => ({
            sections: [
                {
                    type: 'table_3',
                    title: '三、收到和处理政府信息公开申请情况',
                    tableData: rebuildTableDataFromCells(
                        Object.values(TABLE3_CELL_COL_KEYS).flatMap((colKey) =>
                            Object.values(TABLE3_CELL_ROW_KEYS).map((rowKey) => ({
                                colKey,
                                rowKey,
                                semantic: 'NUMERIC' as const,
                                num: value,
                            }))
                        )
                    ),
                },
            ],
        });
        const result = compareChannelOutputs(buildTable3(1), buildTable3(2));
        expect(result.counts.conflict).toBe(25 * 7);
        expect(result.conflicts).toHaveLength(40);
        expect(result.verdict).toBe('conflict');
    });
});

describe('summariseConsistency', () => {
    it('buckets every auto status the checker emits', () => {
        const items = [
            { autoStatus: 'PASS' },
            { autoStatus: 'PASS' },
            { autoStatus: 'FAIL' },
            { autoStatus: 'UNCERTAIN' },
            { autoStatus: 'NOT_ASSESSABLE' },
        ];
        expect(summariseConsistency(items)).toEqual({ pass: 2, fail: 1, uncertain: 1, notAssessable: 1, total: 5 });
    });
});

describe('PDF_DUAL_CHANNEL_MODE', () => {
    it('defaults to off and refuses anything unrecognised', () => {
        expect(readDualChannelMode({})).toBe('off');
        expect(readDualChannelMode({ PDF_DUAL_CHANNEL_MODE: '' })).toBe('off');
        expect(readDualChannelMode({ PDF_DUAL_CHANNEL_MODE: 'yolo' })).toBe('off');
        expect(readDualChannelMode({ PDF_DUAL_CHANNEL_MODE: 'Enforce' })).toBe('enforce');
        expect(readDualChannelMode({ PDF_DUAL_CHANNEL_MODE: ' shadow ' })).toBe('shadow');
    });

    it('keeps a version label for the record', () => {
        expect(readDualChannelVersion({})).toBe('v1');
        expect(readDualChannelVersion({ PDF_DUAL_CHANNEL_VERSION: 'v2' })).toBe('v2');
        expect(readDualChannelVersion({ PDF_DUAL_CHANNEL_VERSION: '   ' })).toBe('v1');
    });
});
