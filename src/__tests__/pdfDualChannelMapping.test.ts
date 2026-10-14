/**
 * Phase 0.3 — grid -> canonical skeleton mapping. Pure functions, no DB, no Python:
 * the grids here are hand-built plus the two captured fixture grids.
 */
import fs from 'fs';
import path from 'path';

import {
    TABLE3_CELL_COL_KEYS,
    TABLE3_CELL_ROW_KEYS,
} from '../utils/table3CellKeys';
import {
    buildCandidateParsedJson,
    extractLeadingNumber,
    forwardFillLabelColumns,
    mapGridToSkeleton,
    normalizeForMatch,
    TABLE3_COL_KEY_BY_SCHEMA_KEY,
    TABLE3_ROW_KEY_BY_SCHEMA_KEY,
} from '../services/pdf-dual-channel/tableGridMapping';
import type { LatticePage } from '../services/pdf-dual-channel/types';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/pdf-lattice');

function pagesOf(...tables: Array<{ page: number; rows: (string | null)[][] }>): LatticePage[] {
    const byPage = new Map<number, (string | null)[][][]>();
    tables.forEach((entry) => {
        const list = byPage.get(entry.page) || [];
        list.push(entry.rows);
        byPage.set(entry.page, list);
    });
    return Array.from(byPage.entries()).map(([pageNumber, rowsList]) => ({
        page_number: pageNumber,
        width: 600,
        height: 800,
        tables: rowsList.map((rows, index) => ({
            table_index: index,
            row_count: rows.length,
            col_count: Math.max(...rows.map((row) => row.length)),
            rows,
            bbox: [0, 0, 100, 100],
        })),
    }));
}

function loadFixture(name: string): LatticePage[] {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
    expect(raw.ok).toBe(true);
    return raw.pages;
}

const T3_HEADER: (string | null)[][] = [
    ['（本列数据的勾稽关系为：第一项加第二项之和，等于第三项加第四项之和）', null, '申请人情况', null, null, null, null, null, null],
    [null, null, '自然人', '法人或其他组织', null, null, null, null, '总计'],
    [null, null, null, '商业企 业', '科研 机构', '社会公 益组织', '法律服 务机构', '其他', null],
];

describe('pdf dual-channel key bridge', () => {
    it('covers every 表三 row key exactly once', () => {
        const expected = Object.values(TABLE3_CELL_ROW_KEYS);
        const actual = Object.values(TABLE3_ROW_KEY_BY_SCHEMA_KEY);
        expect(actual).toHaveLength(expected.length);
        expect(new Set(actual).size).toBe(actual.length);
        expect([...actual].sort()).toEqual([...expected].sort());
    });

    it('covers every 表三 applicant column key exactly once', () => {
        const expected = Object.values(TABLE3_CELL_COL_KEYS);
        const actual = Object.values(TABLE3_COL_KEY_BY_SCHEMA_KEY);
        expect(actual).toHaveLength(expected.length);
        expect(new Set(actual).size).toBe(actual.length);
        expect([...actual].sort()).toEqual([...expected].sort());
    });
});

describe('label normalisation', () => {
    it('drops the whitespace pdfplumber inserts at merged-cell line breaks', () => {
        expect(normalizeForMatch('商业企 业')).toBe('商业企业');
        expect(normalizeForMatch('（三）不 予公开')).toBe('三不予公开');
    });

    it('folds full-width digits and punctuation', () => {
        expect(normalizeForMatch('１２３')).toBe('123');
        expect(normalizeForMatch('3.危及“三安全一稳定”')).toBe('3危及三安全一稳定');
        expect(normalizeForMatch(null)).toBe('');
    });

    it('reads the value out of a cell carrying an inline annotation', () => {
        expect(extractLeadingNumber('22 （其中修订16件）')).toBe(22);
        expect(extractLeadingNumber('55 （含自然失效29件）')).toBe(55);
        expect(extractLeadingNumber('1,295')).toBe(1295);
        expect(extractLeadingNumber('0')).toBe(0);
        expect(extractLeadingNumber('不适用')).toBeNull();
        expect(extractLeadingNumber('-')).toBeNull();
    });
});

describe('forwardFillLabelColumns', () => {
    it('carries a vertically merged group label down its rows', () => {
        const { rows } = forwardFillLabelColumns(
            [['（三）不予公开', '1.属于国家秘密', '0'], [null, '2.其他法律行政法规禁止公开', '0']],
            1
        );
        expect(rows[1][0]).toBe('（三）不予公开');
    });

    it('never fills the innermost label column, which is each row of its own item text', () => {
        const { rows } = forwardFillLabelColumns(
            [['三、本年度办理结果', '（七）总计', null], ['四、结转下年度继续办理', null, null]],
            2
        );
        // Row 2 opens a new outer group, so the previous row's 「（七）总计」 must not
        // leak into it — that leak made two rows tie on 「总计」.
        expect(rows[1][1]).toBeNull();
    });

    it('treats an empty string as a blank cell and null as a merge', () => {
        const { rows } = forwardFillLabelColumns([['甲', ''], [null, '']], 1);
        expect(rows[1][0]).toBe('甲');
    });
});

describe('mapGridToSkeleton — 普通表', () => {
    it('maps a single-page 表三 through its header labels', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf({
                page: 1,
                rows: [
                    ...T3_HEADER,
                    ['一、本年新收政府信息公开申请数量', null, '10', '1', '0', '0', '0', '0', '11'],
                    ['二、上年结转政府信息公开申请数量', null, '2', '0', '0', '0', '0', '0', '2'],
                    ['三、本年度办理结果', '（一）予以公开', '3', '0', '0', '0', '0', '0', '3'],
                ],
            })
        );
        expect(skeleton.tableData.naturalPerson).toMatchObject({ newReceived: 10, carriedOver: 2 });
        expect(skeleton.tableData.naturalPerson.results.granted).toBe(3);
        expect(skeleton.tableData.total.newReceived).toBe(11);
        expect(skeleton.tableData.legalPerson.commercial.newReceived).toBe(1);
        expect(skeleton.matched.table_3).toHaveLength(3);
    });
});

describe('mapGridToSkeleton — 跨页表与合并单元格', () => {
    it('continues a group label across a page-split fragment', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf(
                {
                    page: 1,
                    rows: [
                        ...T3_HEADER,
                        ['（三）不予公开', '1.属于国家秘密', '4', '0', '0', '0', '0', '0', '4'],
                    ],
                },
                {
                    page: 2,
                    rows: [[null, '2.其他法律行政法规禁止公开', '0', '0', '0', '0', '0', '0', '0']],
                }
            )
        );
        const denied = skeleton.tableData.naturalPerson.results.denied;
        expect(denied.stateSecret).toBe(4);
        // The continuation row has no group cell of its own; 不予公开 must be inherited,
        // otherwise 「禁止公开」 alone cannot pick the schema row.
        expect(denied.lawForbidden).toBe(0);
    });

    it('records a merge-absorbed data cell as EMPTY and warns about it', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf({
                page: 1,
                rows: [
                    ...T3_HEADER,
                    ['一、本年新收政府信息公开申请数量', null, '10', '1', null, '0', '0', '0', '11'],
                ],
            })
        );
        expect(skeleton.tableData.naturalPerson.newReceived).toBe(10);
        expect(skeleton.tableData.legalPerson.research.newReceived).toBeNull();
        expect(skeleton.warnings.filter((warning) => warning.code === 'merged_cell').length).toBeGreaterThan(0);
    });
});

describe('mapGridToSkeleton — NA / EMPTY / ZERO', () => {
    it('keeps the distinct cell meanings apart', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf({
                page: 1,
                rows: [
                    ...T3_HEADER,
                    [
                        '（三）不予公开',
                        '1.属于国家秘密',
                        '0', // ZERO
                        '-', // NA
                        '', // blank cell -> EMPTY
                        null, // merge-absorbed -> EMPTY
                        '5',
                        '0',
                        '6',
                    ],
                ],
            })
        );
        expect(skeleton.tableData.naturalPerson.results.denied.stateSecret).toBe(0);
        expect(skeleton.tableData.legalPerson.commercial.results.denied.stateSecret).toBe('-');
        expect(skeleton.tableData.legalPerson.research.results.denied.stateSecret).toBeNull();
        expect(skeleton.tableData.legalPerson.social.results.denied.stateSecret).toBeNull();
        expect(skeleton.tableData.legalPerson.legal.results.denied.stateSecret).toBe(5);
        expect(skeleton.tableData.legalPerson.other.results.denied.stateSecret).toBe(0);
        expect(skeleton.tableData.total.results.denied.stateSecret).toBe(6);
        expect(skeleton.warnings.some((warning) => warning.code === 'merged_cell')).toBe(true);
    });

    it('emits "-" for NA so it is never collapsed into a zero', () => {
        const candidate = buildCandidateParsedJson(
            mapGridToSkeleton(
                pagesOf({
                    page: 1,
                    rows: [...T3_HEADER, ['一、本年新收政府信息公开申请数量', null, '-', '0', '0', '0', '0', '0', '-']],
                })
            )
        );
        const tableData = candidate.sections.find((section: any) => section.type === 'table_3').tableData;
        expect(tableData.naturalPerson.newReceived).toBe('-');
        expect(tableData.legalPerson.commercial.newReceived).toBe(0);
    });
});

describe('mapGridToSkeleton — classification guards', () => {
    it('will not read a narrow prose fragment as 表三', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf({
                page: 1,
                rows: [['不予公开的件数为零，结转下年度继续办理'], ['其他说明']],
            })
        );
        expect(skeleton.gridTableCount).toBe(1);
        expect(skeleton.matched.table_3).toHaveLength(0);
        expect(skeleton.warnings.some((warning) => warning.code === 'table_missing' && warning.table === 'table_3')).toBe(true);
    });
});

describe('mapGridToSkeleton — captured fixture grids', () => {
    it('reproduces the 表二 numbers the pdfjs e2e test pins for the kewei sample', () => {
        const skeleton = mapGridToSkeleton(loadFixture('kewei-2024-official-sample-grid.json'));
        // Ground truth: src/__tests__/keweiPdfE2E.p0.test.ts:116-121
        expect(skeleton.activeDisclosureData).toEqual({
            regulations: { made: 0, repealed: 0, valid: 0 },
            normativeDocuments: { made: 13, repealed: 0, valid: 55 },
            licensing: { processed: 97 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
        });
    });

    it('reproduces the 表二 numbers the pdfjs e2e test pins for the shanghai sample', () => {
        const skeleton = mapGridToSkeleton(loadFixture('shanghai-office-2025-official-sample-grid.json'));
        // Ground truth: src/__tests__/keweiPdfE2E.p0.test.ts:179-184
        expect(skeleton.activeDisclosureData).toEqual({
            regulations: { made: 22, repealed: 22, valid: 235 },
            normativeDocuments: { made: 34, repealed: 55, valid: 189 },
            licensing: { processed: 0 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
        });
    });

    it('reads the shanghai 表三 in full and keeps the 勾稽 identity true', () => {
        const skeleton = mapGridToSkeleton(loadFixture('shanghai-office-2025-official-sample-grid.json'));
        expect(skeleton.matched.table_3).toHaveLength(25);
        const natural = skeleton.tableData.naturalPerson;
        expect(natural.newReceived).toBe(1259);
        expect(natural.carriedOver).toBe(170);
        expect(natural.results.totalProcessed).toBe(1139);
        expect(natural.results.carriedForward).toBe(290);
        // 一 + 二 = 七 + 八, which is the identity printed in the table header itself.
        expect(natural.newReceived + natural.carriedOver).toBe(natural.results.totalProcessed + natural.results.carriedForward);
    });

    it('maps 表四 positionally from its 15-column data row', () => {
        const skeleton = mapGridToSkeleton(loadFixture('kewei-2024-official-sample-grid.json'));
        expect(skeleton.reviewLitigationData).toEqual({
            review: { maintain: 1, correct: 0, other: 0, unfinished: 0, total: 1 },
            litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
            litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        });
    });

    it('documents exactly which kewei 表三 rows pdfplumber fails to put in the grid', () => {
        const skeleton = mapGridToSkeleton(loadFixture('kewei-2024-official-sample-grid.json'));
        const filled = skeleton.matched.table_3;
        const missing = Object.values(TABLE3_ROW_KEY_BY_SCHEMA_KEY).filter((rowKey) => !filled.includes(rowKey));
        // The grid on this sample has no 「（六）其他处理」 group cell and no 「3.其他」 row at
        // all, although the PDF text layer does — measured Channel B coverage, recorded so
        // Phase 1 shadow statistics compare against a known baseline instead of a guess.
        expect(missing.sort()).toEqual(['other_other_reasons', 'other_overdue_correction', 'other_overdue_fee']);
        expect(filled).toHaveLength(22);
    });

    it('does not invent values for rows it could not match', () => {
        const skeleton = mapGridToSkeleton(loadFixture('kewei-2024-official-sample-grid.json'));
        const results = skeleton.tableData.naturalPerson.results;
        expect(results.other).toBeUndefined();
        expect(results.totalProcessed).toBe(33);
    });
});

describe('buildCandidateParsedJson', () => {
    it('emits only the sections the grid actually filled', () => {
        const skeleton = mapGridToSkeleton(
            pagesOf({
                page: 1,
                rows: [['信息内容', '本年制发件数', '本年废止件数', '现行有效件数'], ['规章', '1', '0', '0']],
            })
        );
        const candidate = buildCandidateParsedJson(skeleton, { year: 2024, unitName: '某某局' });
        const types = candidate.sections.map((section: any) => section.type);
        expect(types).toEqual(['table_2']);
        expect(candidate.year).toBe(2024);
        expect(candidate.unit_name).toBe('某某局');
        expect(candidate._ingestion).toMatchObject({ mode: 'dual_channel_candidate', generator: 'pdfplumber_lattice' });
    });

    it('gives every section the title/type the parse schema requires', () => {
        const candidate = buildCandidateParsedJson(
            mapGridToSkeleton(loadFixture('kewei-2024-official-sample-grid.json'))
        );
        expect(candidate.sections.length).toBe(3);
        candidate.sections.forEach((section: any) => {
            expect(typeof section.title).toBe('string');
            expect(section.title.length).toBeGreaterThan(0);
            expect(['table_2', 'table_3', 'table_4']).toContain(section.type);
        });
    });
});
