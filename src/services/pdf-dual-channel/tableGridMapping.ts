import annualReportSchemaJson from '../../schemas/annual_report_table_schema_v2.json';
import {
    rebuildTableDataFromCells,
    TABLE3_CELL_COL_KEYS,
    TABLE3_CELL_ROW_KEYS,
    type TableCellSemantic,
} from '../../utils/table3CellKeys';
import type { LatticePage, LatticeTable } from './types';

/**
 * Channel B: pdfplumber grid -> canonical parsed_json skeleton.
 *
 * Pure functions only — no DB, no fs, no env. Everything downstream of
 * `buildCandidateParsedJson` is the same contract the LLM path already satisfies.
 */

export type CanonicalTableId = 'table_2' | 'table_3' | 'table_4';

export interface MappingWarning {
    code:
        | 'row_unmatched'
        | 'duplicate_row'
        | 'column_layout_fallback'
        | 'short_row'
        | 'table_missing'
        | 'table_shape_unsupported'
        | 'merged_cell';
    message: string;
    table?: CanonicalTableId;
    schemaKey?: string;
    page?: number;
}

export interface CanonicalSkeleton {
    activeDisclosureData: Record<string, Record<string, any>>;
    tableData: Record<string, any>;
    reviewLitigationData: Record<string, Record<string, any>>;
    /** row keys filled per canonical table. */
    matched: Record<CanonicalTableId, string[]>;
    warnings: MappingWarning[];
    gridTableCount: number;
}

interface SchemaColumn {
    key: string;
    name: string;
}

interface SchemaRow {
    key: string;
    label: string;
    match: string[];
}

interface SchemaTable {
    id: string;
    section: string;
    title: string;
    locateKeywords?: string[];
    labelColumns?: number;
    columns: SchemaColumn[];
    rows: SchemaRow[];
}

interface AnnualReportSchemaDoc {
    tables: SchemaTable[];
}

const schemaDoc = annualReportSchemaJson as unknown as AnnualReportSchemaDoc;

const SCHEMA_TABLE2 = schemaDoc.tables.filter((table) => table.id.startsWith('sec2'));

function requireSchemaTable(id: string): SchemaTable {
    const table = schemaDoc.tables.find((candidate) => candidate.id === id);
    if (!table) {
        throw new Error(`annual_report_table_schema_v2.json is missing ${id}`);
    }
    return table;
}

const SCHEMA_TABLE3 = requireSchemaTable('sec3_requests');
const SCHEMA_TABLE4 = requireSchemaTable('sec4_review_litigation');

/**
 * Bridge from schema-v2 row keys to the snake_case cells/fact keys in
 * table3CellKeys.ts. Those DB keys are an immutable external contract (historical
 * rows already carry them), while the schema file is a spec that has never been
 * wired into code — so the bridge is written out by hand and the mapping test
 * asserts both sides are covered exactly once, which fails loudly on drift.
 */
export const TABLE3_ROW_KEY_BY_SCHEMA_KEY: Record<string, string> = {
    new_received: 'new_received',
    carry_over: 'carried_over',
    result_open: 'granted',
    result_partial: 'partial_grant',
    not_open_secret: 'denied_state_secret',
    not_open_other_law: 'denied_law_forbidden',
    not_open_3s1w: 'denied_safety_stability',
    not_open_third_party: 'denied_third_party_rights',
    not_open_internal: 'denied_internal_affairs',
    not_open_process: 'denied_process_info',
    not_open_casefile: 'denied_enforcement_case',
    not_open_query: 'denied_admin_query',
    cannot_provide_not_held: 'unable_no_info',
    cannot_provide_need_make: 'unable_need_creation',
    cannot_provide_unclear: 'unable_unclear',
    no_process_petition: 'not_processed_complaint',
    no_process_repeat: 'not_processed_repeat',
    no_process_publications: 'not_processed_publication',
    no_process_massive: 'not_processed_massive_requests',
    no_process_confirm: 'not_processed_confirm_info',
    other_fix_timeout: 'other_overdue_correction',
    other_fee_unpaid: 'other_overdue_fee',
    other_other: 'other_other_reasons',
    result_total: 'total_processed',
    carry_to_next: 'carried_forward',
};

export const TABLE3_COL_KEY_BY_SCHEMA_KEY: Record<string, string> = {
    natural_person: 'natural_person',
    commercial_enterprise: 'legal_person_commercial',
    research_institute: 'legal_person_research',
    social_org: 'legal_person_social',
    legal_service: 'legal_person_legal',
    other: 'legal_person_other',
    total: 'total',
};

const TABLE2_KEY_BY_SCHEMA_ROW: Record<string, string> = {
    rules: 'regulations',
    normative_files: 'normativeDocuments',
    admin_license: 'licensing',
    admin_penalty: 'punishment',
    admin_coercion: 'coercion',
    admin_fees: 'fees',
};

const TABLE2_FIELD_BY_SCHEMA_COL: Record<string, string> = {
    issued: 'made',
    repealed: 'repealed',
    valid: 'valid',
    decisions: 'processed',
    amount_wanyuan: 'amount',
};

const TABLE4_CASE_BY_SCHEMA_COL: Record<string, string> = {
    review_keep: 'review',
    review_correct: 'review',
    review_other: 'review',
    review_pending: 'review',
    review_total: 'review',
    lawsuit_direct_keep: 'litigationDirect',
    lawsuit_direct_correct: 'litigationDirect',
    lawsuit_direct_other: 'litigationDirect',
    lawsuit_direct_pending: 'litigationDirect',
    lawsuit_direct_total: 'litigationDirect',
    lawsuit_after_keep: 'litigationPostReview',
    lawsuit_after_correct: 'litigationPostReview',
    lawsuit_after_other: 'litigationPostReview',
    lawsuit_after_pending: 'litigationPostReview',
    lawsuit_after_total: 'litigationPostReview',
};

const TABLE4_FIELD_BY_SCHEMA_COL: Record<string, string> = {
    review_keep: 'maintain',
    review_correct: 'correct',
    review_other: 'other',
    review_pending: 'unfinished',
    review_total: 'total',
    lawsuit_direct_keep: 'maintain',
    lawsuit_direct_correct: 'correct',
    lawsuit_direct_other: 'other',
    lawsuit_direct_pending: 'unfinished',
    lawsuit_direct_total: 'total',
    lawsuit_after_keep: 'maintain',
    lawsuit_after_correct: 'correct',
    lawsuit_after_other: 'other',
    lawsuit_after_pending: 'unfinished',
    lawsuit_after_total: 'total',
};

const NA_TOKENS = new Set(['/', '-', '--', '—', '－', 'n/a', 'na', '不适用', '×']);

const PUNCT_CLASS = '[\\u3001-\\u303F\\uFF01-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B\\uFF5D\\u2010-\\u2027\\u2030-\\u205E·•・.!?:;’‘“”]';

/**
 * Fold a label for keyword matching: full-width digits to half-width, all whitespace
 * dropped (a merged cell's soft line break arrives as "商业企 业"), punctuation replaced
 * by nothing, and CJK punctuation stripped so 「（三）不予公开」 and the spec's
 * "不予公开" meet on the same string.
 */
export function normalizeForMatch(value: string | null): string {
    if (!value) {
        return '';
    }
    const halfWidth = value
        .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/[\uFF08\uFF09]/g, (ch) => (ch === '\uFF08' ? '(' : ')'));
    return halfWidth
        .replace(/[\u2000-\u200B\u3000\u00A0\s]+/g, '')
        .replace(new RegExp(PUNCT_CLASS, 'g'), '')
        .replace(/[()]/g, '')
        .toLowerCase();
}

/** Drop parenthesised annotations: 「本年收费金额（单位：万元）」 vs 「本年收费金额」. */
function stripParenthetical(text: string): string {
    return text.replace(/\([^()]*\)/g, '');
}

/** A cell often reads "22 （其中修订16件）" — the value is the leading number. */
export function extractLeadingNumber(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim().replace(/[,，]/g, '');
    const match = /^(-?\d+(?:\.\d+)?)/.exec(trimmed);
    if (!match) {
        return null;
    }
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) ? numeric : null;
}

function isNaToken(value: string): boolean {
    return NA_TOKENS.has(value.trim().toLowerCase());
}

function isDataCell(value: string | null | undefined): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return false;
    }
    return isNaToken(trimmed) || extractLeadingNumber(trimmed) !== null;
}

function classifyCell(value: string | null | undefined): { semantic: TableCellSemantic; num: number | null } {
    if (value === null || value === undefined) {
        return { semantic: 'EMPTY', num: null };
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return { semantic: 'EMPTY', num: null };
    }
    if (isNaToken(trimmed)) {
        return { semantic: 'NA', num: null };
    }
    const numeric = extractLeadingNumber(trimmed);
    if (numeric !== null) {
        return { semantic: numeric === 0 ? 'ZERO' : 'NUMERIC', num: numeric };
    }
    return { semantic: 'TEXT', num: null };
}

function cellToPayloadValue(value: string | null | undefined): any {
    const { semantic, num } = classifyCell(value);
    // NA stays the string '-' and EMPTY stays null: rebuildTableDataFromCells and
    // MaterializeService distinguish those two, and collapsing them would silently
    // turn "不适用" into a zero.
    if (semantic === 'NA') {
        return '-';
    }
    if (semantic === 'EMPTY' || semantic === 'TEXT') {
        return null;
    }
    return num;
}

interface GridFragment {
    page: number;
    tableIndex: number;
    colCount: number;
    /** null means the cell was absorbed by a merge; see forwardFillLabelColumns. */
    rows: (string | null)[][];
}

function collectFragments(pages: LatticePage[]): GridFragment[] {
    const fragments: GridFragment[] = [];
    for (const page of pages) {
        for (const table of (page.tables || []) as LatticeTable[]) {
            if (!Array.isArray(table.rows) || table.rows.length === 0) {
                continue;
            }
            fragments.push({
                page: page.page_number,
                tableIndex: table.table_index,
                colCount: table.col_count || Math.max(...table.rows.map((row) => row.length)),
                rows: table.rows,
            });
        }
    }
    return fragments;
}

/**
 * A vertically merged group cell ("（三）不予公开") is emitted once and null afterwards.
 * Filling those nulls per label column is what lets a sub-item row see its own group:
 * 「1.属于国家秘密」 alone does not contain the "不予公开" the spec requires.
 * Only null is filled — an empty string is a genuinely blank cell, not a merge.
 *
 * `fillEnd` deliberately stops before the innermost label column: only group columns
 * merge vertically, while the innermost cell holds each row's own item text. Filling it
 * would attach the previous row's item to a row like 「四、结转下年度继续办理」 and let a
 * stale keyword win the match.
 *
 * `initialCarried` threads state across fragments, because a 表三 that continues onto the
 * next page usually repeats no group label at all.
 */
export function forwardFillLabelColumns(
    rows: (string | null)[][],
    fillEnd: number,
    initialCarried: (string | null)[] = []
): { rows: (string | null)[][]; carried: (string | null)[] } {
    const carried: (string | null)[] = new Array(Math.max(0, fillEnd)).fill(null);
    initialCarried.slice(0, carried.length).forEach((value, index) => {
        carried[index] = value;
    });
    const filledRows = rows.map((row) => {
        const filled = row.slice();
        for (let index = 0; index < fillEnd; index += 1) {
            const cell = index < filled.length ? filled[index] : null;
            if (cell === null || cell === undefined || cell === '') {
                if (carried[index] !== null) {
                    filled[index] = carried[index];
                }
                continue;
            }
            carried[index] = cell;
            // Hierarchical merge: a fresh value at level `index` ends every run below it,
            // otherwise 「四、结转下年度继续办理」 would inherit 「（七）总计」 from the
            // previous row and both would tie on 「总计」.
            for (let deeper = index + 1; deeper < carried.length; deeper += 1) {
                carried[deeper] = null;
            }
        }
        return filled;
    });
    return { rows: filledRows, carried };
}

/**
 * The spec's `match` list mixes two conventions: aliases for one row
 * (「行政规范性文件」 / 「规范性文件」) and a conjunctive group+item signature
 * (「不予公开」 + 「国家秘密」). When one keyword contains another it is an alias set.
 */
function keywordSignature(keywords: string[]): { isAlias: boolean; normalized: string[] } {
    const normalized = keywords.map(normalizeForMatch).filter(Boolean);
    const isAlias = normalized.some((a) => normalized.some((b) => b !== a && b.includes(a)));
    return { isAlias, normalized };
}

function scoreSchemaRow(labelText: string, keywords: string[]): number {
    const { isAlias, normalized } = keywordSignature(keywords);
    if (normalized.length === 0) {
        return 0;
    }
    if (isAlias) {
        const hits = normalized.filter((keyword) => labelText.includes(keyword));
        if (hits.length === 0) {
            return 0;
        }
        return 1_000 + Math.max(...hits.map((keyword) => keyword.length));
    }
    if (!normalized.every((keyword) => labelText.includes(keyword))) {
        return 0;
    }
    return normalized.length * 1_000 + normalized.reduce((total, keyword) => total + keyword.length, 0);
}

function matchSchemaRow<T extends { key: string; label: string; match?: string[] }>(
    labelText: string,
    rows: T[]
): T | null {
    let best: T | null = null;
    let bestScore = 0;
    for (const row of rows) {
        const keywords = row.match && row.match.length ? row.match : [row.label];
        const score = scoreSchemaRow(labelText, keywords);
        if (score > bestScore) {
            best = row;
            bestScore = score;
        }
    }
    return best;
}

function classifyFragment(fragment: GridFragment): CanonicalTableId | null {
    const flat = normalizeForMatch(fragment.rows.map((row) => row.join(' ')).join(' '));
    // Classification only decides which table a fragment belongs to, so one keyword hit
    // is enough: a fragment continuing onto the next page usually repeats no group word.
    // Row assignment still requires the full signature.
    const hitsFor = (rows: { match?: string[] }[]) =>
        rows.filter((row) => {
            const keywords = (row.match || []).map(normalizeForMatch).filter(Boolean);
            return keywords.some((keyword) => flat.includes(keyword));
        }).length;

    const table3Hits = hitsFor(SCHEMA_TABLE3.rows);
    const table2Hits = hitsFor(SCHEMA_TABLE2.flatMap((table) => table.rows));
    const table4Hits =
        flat.includes(normalizeForMatch('行政复议')) && flat.includes(normalizeForMatch('行政诉讼')) ? 1 : 0;

    // Width is a structural fact of the national template: 表三 always carries 7
    // applicant columns plus at least one label column, and 表四 always 15. A narrow
    // prose fragment that happens to quote 「不予公开」 must not be treated as data.
    const wideEnough: Record<CanonicalTableId, boolean> = {
        table_2: fragment.colCount >= 2,
        table_3: fragment.colCount >= SCHEMA_TABLE3.columns.length + 1,
        table_4: fragment.colCount >= SCHEMA_TABLE4.columns.length,
    };

    // 表四's 15-column wide header row outranks a coincidental keyword collision.
    if (wideEnough.table_4 && table4Hits) {
        return 'table_4';
    }
    if (wideEnough.table_3 && table3Hits >= 2 && table3Hits >= table2Hits) {
        return 'table_3';
    }
    if (wideEnough.table_2 && table2Hits >= 1) {
        return 'table_2';
    }
    if (wideEnough.table_3 && table3Hits === 1) {
        return 'table_3';
    }
    if (table4Hits && wideEnough.table_4) {
        return 'table_4';
    }
    return null;
}

/**
 * 表三's applicant names are spread over up to 3 header rows with merges, so a name may
 * sit in any of them; exact normalized equality is required, otherwise 「其他」 would
 * also match 「法人或其他组织」.
 */
function resolveApplicantColumns(fragment: GridFragment): Record<string, number> | null {
    const columns: Record<string, number> = {};
    const headerRowLimit = Math.min(fragment.rows.length, 4);
    for (const column of SCHEMA_TABLE3.columns) {
        const name = normalizeForMatch(column.name);
        for (let rowIndex = 0; rowIndex < headerRowLimit; rowIndex += 1) {
            const row = fragment.rows[rowIndex];
            const hit = row.findIndex((cell) => normalizeForMatch(cell) === name);
            if (hit >= 0 && columns[column.key] === undefined) {
                columns[column.key] = hit;
            }
        }
    }
    return Object.keys(columns).length === SCHEMA_TABLE3.columns.length ? columns : null;
}

/**
 * Continuation pages repeat no header, so fall back to "the trailing 7 columns". Both
 * fixtures put 申请人 columns at the far right, which is what the GB template mandates.
 */
function positionalApplicantColumns(fragment: GridFragment): Record<string, number> {
    const columns: Record<string, number> = {};
    const start = Math.max(0, fragment.colCount - SCHEMA_TABLE3.columns.length);
    SCHEMA_TABLE3.columns.forEach((column, offset) => {
        columns[column.key] = start + offset;
    });
    return columns;
}

function firstColumnIndex(columns: Record<string, number>): number {
    return Math.min(...SCHEMA_TABLE3.columns.map((column) => columns[column.key]).filter((index) => Number.isFinite(index)));
}

interface CellValue {
    colKey: string;
    rowKey: string;
    semantic: TableCellSemantic;
    num: number | null;
}

function mapTable3(fragments: GridFragment[], warnings: MappingWarning[]): Record<string, any> {
    const cellValues: CellValue[] = [];
    const assigned = new Map<string, number>();
    let carried: (string | null)[] = [];

    for (const fragment of fragments) {
        const headerColumns = resolveApplicantColumns(fragment);
        const columns = headerColumns || positionalApplicantColumns(fragment);
        if (!headerColumns) {
            warnings.push({
                code: 'column_layout_fallback',
                table: 'table_3',
                page: fragment.page,
                message: 'no complete header row; used trailing 7 columns',
            });
        }
        const labelEnd = firstColumnIndex(columns);
        if (!Number.isFinite(labelEnd) || labelEnd <= 0) {
            warnings.push({
                code: 'table_shape_unsupported',
                table: 'table_3',
                page: fragment.page,
                message: 'applicant columns resolved to the label area; fragment skipped',
            });
            continue;
        }

        const filled = forwardFillLabelColumns(fragment.rows, labelEnd - 1, carried);
        const rows = filled.rows;
        carried = filled.carried;

        for (const row of rows) {
            const labelText = normalizeForMatch(
                row.slice(0, labelEnd).filter((cell) => cell !== null && cell !== '').join(' ')
            );
            if (!labelText) {
                continue;
            }
            const schemaRow = matchSchemaRow(labelText, SCHEMA_TABLE3.rows);
            if (!schemaRow) {
                continue;
            }
            const rowKey = TABLE3_ROW_KEY_BY_SCHEMA_KEY[schemaRow.key];
            if (!rowKey) {
                warnings.push({
                    code: 'row_unmatched',
                    table: 'table_3',
                    schemaKey: schemaRow.key,
                    page: fragment.page,
                    message: 'schema row has no cells-key bridge',
                });
                continue;
            }

            const populated = SCHEMA_TABLE3.columns.filter((column) => isDataCell(row[columns[column.key]]));
            if (populated.length === 0) {
                // Header and annotation rows can carry a label keyword without data.
                continue;
            }

            const previous = assigned.get(rowKey);
            if (previous !== undefined && previous >= populated.length) {
                warnings.push({
                    code: 'duplicate_row',
                    table: 'table_3',
                    schemaKey: schemaRow.key,
                    page: fragment.page,
                    message: 'row seen again; kept the fuller one',
                });
                continue;
            }
            assigned.set(rowKey, populated.length);

            SCHEMA_TABLE3.columns.forEach((column) => {
                const colKey = TABLE3_COL_KEY_BY_SCHEMA_KEY[column.key];
                if (!colKey) {
                    warnings.push({
                        code: 'row_unmatched',
                        table: 'table_3',
                        schemaKey: column.key,
                        message: 'schema column has no cells-key bridge',
                    });
                    return;
                }
                const raw = row[columns[column.key]];
                if (raw === undefined || raw === null) {
                    warnings.push({
                        code: 'merged_cell',
                        table: 'table_3',
                        schemaKey: schemaRow.key,
                        page: fragment.page,
                        message: `${column.name} cell was absorbed by a merge; recorded as EMPTY`,
                    });
                }
                const { semantic, num } = classifyCell(raw);
                cellValues.push({ colKey, rowKey, semantic, num });
            });
        }
    }

    return rebuildTableDataFromCells(cellValues);
}

/** 表二 is one grid holding up to four stacked sub-tables, each with its own header row. */
function resolveTable2Header(row: (string | null)[]): Record<string, number> | null {
    const columns: Record<string, number> = {};
    SCHEMA_TABLE2.flatMap((table) => table.columns).forEach((column) => {
        const name = stripParenthetical(normalizeForMatch(column.name));
        if (!name) {
            return;
        }
        // Column 0 is always the 信息内容 label column, so a header name there is noise.
        const hit = row.findIndex((cell, cellIndex) => {
            if (cellIndex === 0) {
                return false;
            }
            const cellName = stripParenthetical(normalizeForMatch(cell));
            return Boolean(cellName) && (cellName === name || cellName.includes(name) || name.includes(cellName));
        });
        if (hit >= 0) {
            columns[column.key] = hit;
        }
    });
    return Object.keys(columns).length > 0 ? columns : null;
}

function mapTable2(fragments: GridFragment[], warnings: MappingWarning[]): Record<string, Record<string, any>> {
    const data: Record<string, Record<string, any>> = {};
    const specRows = SCHEMA_TABLE2.flatMap((table) => table.rows.map((row) => ({ row, columns: table.columns })));
    const assigned = new Map<string, number>();

    for (const fragment of fragments) {
        let blockHeaderIndex = -1;
        let blockColumns: Record<string, number> | null = null;

        fragment.rows.forEach((row, rowIndex) => {
            const header = resolveTable2Header(row);
            if (header) {
                blockColumns = header;
                blockHeaderIndex = rowIndex;
                return;
            }
            if (!blockColumns) {
                return;
            }

            const labelEnd = Math.min(...Object.values(blockColumns));
            const labelText = normalizeForMatch(row.slice(0, labelEnd).filter((cell) => cell !== null && cell !== '').join(' '));
            if (!labelText) {
                return;
            }
            const spec = matchSchemaRow(
                labelText,
                specRows.map((entry) => entry.row)
            );
            if (!spec) {
                return;
            }
            const entry = specRows.find((candidate) => candidate.row.key === spec.key);
            const targetKey = TABLE2_KEY_BY_SCHEMA_ROW[spec.key];
            if (!entry || !targetKey) {
                warnings.push({
                    code: 'row_unmatched',
                    table: 'table_2',
                    schemaKey: spec.key,
                    page: fragment.page,
                    message: 'schema row has no payload key bridge',
                });
                return;
            }

            const start = blockColumns[entry.columns[0].key] ?? labelEnd;
            const populated = entry.columns.filter((_, offset) => isDataCell(row[start + offset])).length;
            if (populated === 0) {
                return;
            }
            const previous = assigned.get(spec.key);
            if (previous !== undefined && previous >= populated) {
                warnings.push({
                    code: 'duplicate_row',
                    table: 'table_2',
                    schemaKey: spec.key,
                    page: fragment.page,
                    message: 'row seen again; kept the fuller one',
                });
                return;
            }
            assigned.set(spec.key, populated);

            const bucket = data[targetKey] || (data[targetKey] = {});
            entry.columns.forEach((column, offset) => {
                const field = TABLE2_FIELD_BY_SCHEMA_COL[column.key];
                if (!field) {
                    warnings.push({
                        code: 'row_unmatched',
                        table: 'table_2',
                        schemaKey: spec.key,
                        message: `schema column ${column.key} has no field bridge`,
                    });
                    return;
                }
                const raw = row[start + offset];
                if (raw === undefined || raw === null) {
                    warnings.push({
                        code: 'short_row',
                        table: 'table_2',
                        schemaKey: spec.key,
                        page: fragment.page,
                        message: `row has no cell for ${column.name} (header row ${blockHeaderIndex})`,
                    });
                }
                bucket[field] = cellToPayloadValue(raw);
            });
        });
    }

    return data;
}

function mapTable4(fragments: GridFragment[], warnings: MappingWarning[]): Record<string, Record<string, any>> {
    const data: Record<string, Record<string, any>> = {};
    const columns = SCHEMA_TABLE4.columns;

    for (const fragment of fragments) {
        if (fragment.colCount < columns.length) {
            warnings.push({
                code: 'table_shape_unsupported',
                table: 'table_4',
                page: fragment.page,
                message: `表四 needs ${columns.length} columns, grid has ${fragment.colCount}`,
            });
            continue;
        }

        // The 15 data columns are fixed by the national template, so the data row maps
        // by position; header labels only choose which row is the data row.
        const dataRow = fragment.rows
            .map((row) => ({ row, filled: columns.filter((_, index) => isDataCell(row[index])).length }))
            .filter((candidate) => candidate.filled >= columns.length - 2)
            .sort((a, b) => b.filled - a.filled)[0];

        if (!dataRow) {
            warnings.push({
                code: 'table_missing',
                table: 'table_4',
                page: fragment.page,
                message: 'no 15-value data row in the 表四 fragment',
            });
            continue;
        }

        columns.forEach((column, index) => {
            const caseKey = TABLE4_CASE_BY_SCHEMA_COL[column.key];
            const fieldKey = TABLE4_FIELD_BY_SCHEMA_COL[column.key];
            if (!caseKey || !fieldKey) {
                return;
            }
            const bucket = data[caseKey] || (data[caseKey] = {});
            bucket[fieldKey] = cellToPayloadValue(dataRow.row[index]);
        });
    }

    return data;
}

export function mapGridToSkeleton(pages: LatticePage[]): CanonicalSkeleton {
    const fragments = collectFragments(pages || []);
    const grouped: Record<CanonicalTableId, GridFragment[]> = { table_2: [], table_3: [], table_4: [] };
    const warnings: MappingWarning[] = [];

    for (const fragment of fragments) {
        const id = classifyFragment(fragment);
        if (id) {
            grouped[id].push(fragment);
        }
    }

    const skeleton: CanonicalSkeleton = {
        activeDisclosureData: mapTable2(grouped.table_2, warnings),
        tableData: mapTable3(grouped.table_3, warnings),
        reviewLitigationData: mapTable4(grouped.table_4, warnings),
        matched: { table_2: [], table_3: [], table_4: [] },
        warnings,
        gridTableCount: fragments.length,
    };

    (Object.keys(grouped) as CanonicalTableId[]).forEach((id) => {
        if (grouped[id].length === 0) {
            warnings.push({ code: 'table_missing', table: id, message: `no grid fragment classified as ${id}` });
        }
    });

    skeleton.matched.table_2 = Object.keys(skeleton.activeDisclosureData);
    skeleton.matched.table_4 = Object.keys(skeleton.reviewLitigationData);
    skeleton.matched.table_3 = collectRowKeys(skeleton.tableData);

    return skeleton;
}

/** Flatten a tableData tree back into the DB row keys it filled — used only for reporting. */
function collectRowKeys(tableData: Record<string, any>): string[] {
    const used = new Set<string>();
    const walk = (node: any, rel: string[]) => {
        if (node === null || node === undefined || typeof node !== 'object') {
            if (rel.length === 0) {
                return;
            }
            const suffix = rel.join('.');
            // Entity prefixes vary (naturalPerson vs legalPerson.commercial), so a field
            // path is recognised as a suffix of the walked path.
            const fieldPath = Object.keys(TABLE3_CELL_ROW_KEYS).find(
                (candidate) => suffix === candidate || suffix.endsWith(`.${candidate}`)
            );
            if (fieldPath) {
                used.add(TABLE3_CELL_ROW_KEYS[fieldPath]);
            }
            return;
        }
        Object.entries(node).forEach(([key, value]) => walk(value, [...rel, key]));
    };
    Object.values(tableData).forEach((entityValue) => walk(entityValue, []));
    return Array.from(used);
}

export interface CandidateBuildOptions {
    year?: number | null;
    unitName?: string | null;
    regionId?: number | string | null;
    reportId?: number | null;
    versionId?: number | string | null;
    storagePath?: string | null;
    fileHash?: string | null;
    generatedAt?: string;
    engineVersion?: string | null;
}

/**
 * The candidate output: the same `sections[]` envelope the LLM path produces, so
 * hasParsedContent / MaterializeService / ConsistencyCheckService see nothing new.
 * A section is only emitted when its grid actually produced values.
 */
export function buildCandidateParsedJson(
    skeleton: CanonicalSkeleton,
    options: CandidateBuildOptions = {}
): Record<string, any> {
    const sections: Record<string, any>[] = [];

    if (Object.keys(skeleton.activeDisclosureData).length > 0) {
        sections.push({
            type: 'table_2',
            title: SCHEMA_TABLE2[0]?.section || '二、主动公开政府信息情况',
            activeDisclosureData: skeleton.activeDisclosureData,
        });
    }
    if (Object.keys(skeleton.tableData).length > 0) {
        sections.push({
            type: 'table_3',
            title: SCHEMA_TABLE3.section,
            tableData: skeleton.tableData,
        });
    }
    if (Object.keys(skeleton.reviewLitigationData).length > 0) {
        sections.push({
            type: 'table_4',
            title: SCHEMA_TABLE4.section,
            reviewLitigationData: skeleton.reviewLitigationData,
        });
    }

    return {
        schema_version: 'dual_channel_v1',
        year: options.year ?? null,
        unit_name: options.unitName ?? null,
        region_id: options.regionId ?? null,
        report_id: options.reportId ?? null,
        version_id: options.versionId ?? null,
        storage_path: options.storagePath ?? null,
        file_hash: options.fileHash ?? null,
        generated_at: options.generatedAt ?? new Date().toISOString(),
        sections,
        _ingestion: {
            mode: 'dual_channel_candidate',
            generator: 'pdfplumber_lattice',
            engine_version: options.engineVersion ?? null,
        },
    };
}
