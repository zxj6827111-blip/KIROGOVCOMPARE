import { tryParseTable2FromSourceText } from '../TableSectionScoring';
import { buildCandidateParsedJson, mapGridToSkeleton } from './tableGridMapping';
import type { LatticePage } from './types';

/**
 * Channel A's deterministic reading: the pdfjs markdown turned into the same canonical
 * skeleton Channel B produces, so the two can be compared cell by cell without an LLM in
 * the loop.
 *
 * The markdown table rows are parsed into a grid and handed to the ONE mapper in this
 * feature, rather than written a second time, so both channels share identical row/column
 * resolution and value semantics.
 */

const ROW_PREFIX = '|';

function isSeparatorRow(line: string): boolean {
    return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function parseCells(line: string): (string | null)[] {
    const inner = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
    return inner.split('|').map((cell) => {
        const text = cell.trim();
        return text ? text : null;
    });
}

/** Group runs of `| a | b |` lines into tables; every prose line closes the current block. */
export function markdownToGridPages(markdown: string): LatticePage[] {
    const pages: LatticePage[] = [];
    let block: (string | null)[][] = [];

    const flush = () => {
        if (block.length === 0) {
            return;
        }
        const rows = normaliseBlockWidth(block);
        block = [];
        pages.push({
            // pdfjs markdown carries no page boundaries here, so the block ordinal stands in
            // for page_number; it is only used for warning attribution.
            page_number: pages.length + 1,
            width: 0,
            height: 0,
            tables: [
                {
                    table_index: 0,
                    row_count: rows.length,
                    col_count: Math.max(...rows.map((row) => row.length)),
                    rows,
                    bbox: null,
                },
            ],
        });
    };

    for (const rawLine of String(markdown || '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.startsWith(ROW_PREFIX) && line.endsWith(ROW_PREFIX) && line.length > 1 && !isSeparatorRow(line)) {
            block.push(parseCells(line));
            continue;
        }
        if (!isSeparatorRow(line)) {
            flush();
        }
    }
    flush();
    return pages;
}

/**
 * A markdown table declares one width, but pdfjs pads rows inconsistently: a trailing empty
 * cell makes the row one column wider, and the "last 7 columns" rule then shifts every value
 * left by one (measured on the kewei sample: 本年新收 read as 2 instead of 32). Collapsing
 * each block to its modal row width removes that artifact without guessing at content.
 */
export function normaliseBlockWidth(rows: (string | null)[][]): (string | null)[][] {
    const counts = new Map<number, number>();
    for (const row of rows) {
        const trimmed = trimTrailingBlanks(row).length;
        if (trimmed >= 2) {
            counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
        }
    }
    if (counts.size === 0) {
        return rows;
    }
    let width = 0;
    let best = -1;
    for (const [candidate, occurrences] of counts) {
        // Prefer the widest row among equally frequent ones, so data is never truncated.
        if (occurrences > best || (occurrences === best && candidate > width)) {
            width = candidate;
            best = occurrences;
        }
    }
    return rows.map((row) => {
        const trimmed = trimTrailingBlanks(row);
        if (trimmed.length === width) {
            return trimmed;
        }
        if (trimmed.length > width) {
            return trimmed.slice(0, width);
        }
        return [...trimmed, ...new Array(width - trimmed.length).fill(null)];
    });
}

function trimTrailingBlanks(row: (string | null)[]): (string | null)[] {
    const copy = row.slice();
    while (copy.length > 0 && (copy[copy.length - 1] === null || copy[copy.length - 1] === '')) {
        copy.pop();
    }
    return copy;
}

function cloneSection(candidate: Record<string, any>, type: string): Record<string, any> | null {
    const section = (candidate.sections || []).find((entry: any) => entry?.type === type);
    return section || null;
}

/**
 * 表二 has a second deterministic reader in this repo: TableSectionScoring finds its figures
 * in prose, which matters because pdfjs frequently renders 第二十条第（五）/（六）/（八）项 as
 * plain text ("行政许可 97") instead of table rows. Gaps left by the markdown grid are filled
 * from it, so Channel A is as complete as it can honestly be — and only gaps are filled, so a
 * value the grid already read is never overwritten by a looser prose guess.
 */
function fillTable2Gaps(activeDisclosureData: Record<string, any>, sourceText: string): Record<string, any> {
    const fromProse = tryParseTable2FromSourceText(sourceText);
    if (!fromProse) {
        return activeDisclosureData;
    }
    const merged: Record<string, any> = { ...activeDisclosureData };
    for (const [category, values] of Object.entries(fromProse)) {
        if (!values || typeof values !== 'object') {
            continue;
        }
        const target = merged[category] || (merged[category] = {});
        for (const [field, value] of Object.entries(values as Record<string, any>)) {
            if (target[field] === undefined || target[field] === null) {
                if (value !== undefined && value !== null) {
                    target[field] = value;
                }
            }
        }
    }
    return merged;
}

export interface ChannelAReference {
    /** Canonical candidate-shaped payload, or null when Channel A read nothing. */
    parsedJson: Record<string, any> | null;
    sections: string[];
    gridBlocks: number;
    table2FromProse: boolean;
}

export function buildChannelAReference(sourceText: string): ChannelAReference {
    const pages = markdownToGridPages(sourceText);
    const skeleton = mapGridToSkeleton(pages);
    const candidate = buildCandidateParsedJson(skeleton, {});

    const table2 = cloneSection(candidate, 'table_2');
    const filled = fillTable2Gaps(table2?.activeDisclosureData || {}, sourceText);
    const table2FromProse = Object.keys(filled).length > Object.keys(table2?.activeDisclosureData || {}).length;

    const sections: Record<string, any>[] = [];
    if (Object.keys(filled).length > 0) {
        sections.push({ type: 'table_2', title: '二、主动公开政府信息情况', activeDisclosureData: filled });
    }
    for (const section of candidate.sections || []) {
        if (section.type === 'table_2') {
            continue;
        }
        sections.push(section);
    }

    const parsedJson = sections.length > 0 ? { ...candidate, sections } : null;
    return {
        parsedJson,
        sections: sections.map((section) => section.type),
        gridBlocks: pages.length,
        table2FromProse,
    };
}
