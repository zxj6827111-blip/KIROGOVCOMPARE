import { buildParsedCells, type CellRecord } from '../MaterializeService';

/**
 * Channel A vs Channel B comparison.
 *
 * Both sides are normalised through MaterializeService's own cell builders, so the
 * comparison runs on the immutable canonical key space (`table:row:col`) and inherits the
 * NA / EMPTY / ZERO semantics of the table that stores them. Nothing here invents a second
 * set of value rules.
 */

export type DualChannelVerdict =
    /** every comparable cell agrees, both channels complete */
    | 'agree'
    /** no disagreement, but B has numeric cells A left blank */
    | 'agree_b_superset'
    /** no disagreement, but A has numeric cells B could not read */
    | 'a_gap'
    /** at least one cell where both have a number and the numbers differ */
    | 'conflict'
    /** Channel B produced no usable candidate */
    | 'no_candidate'
    /** Channel A produced nothing (failed/gate-blocked run), so there is nothing to compare */
    | 'a_unavailable'
    /** enforce mode: Channel A has no deterministic reading of this document at all */
    | 'no_reference'
    /** sidecar itself failed */
    | 'channel_error';

export type CellCompareStatus = 'agree' | 'conflict' | 'a_only' | 'b_only';

export interface CellDiff {
    ref: string;
    status: CellCompareStatus;
    a: number | null;
    b: number | null;
    semanticA: string;
    semanticB: string;
}

export interface CompareResult {
    verdict: DualChannelVerdict;
    /** share of comparable cells the two channels agree on, 0 when there is nothing to compare. */
    confidence: number;
    counts: Record<CellCompareStatus, number>;
    /** capped list; the full set is summarised by counts. */
    conflicts: CellDiff[];
}

const MAX_REPORTED_DIFFS = 40;

function hasNumber(cell: CellRecord | undefined): boolean {
    return Boolean(cell && typeof cell.value_num === 'number' && Number.isFinite(cell.value_num));
}

/** A cell that holds words instead of a figure, e.g. 本年收费金额 = "见附件". */
function textOf(cell: CellRecord | undefined): string | null {
    return cell && cell.value_semantic === 'TEXT' ? String(cell.normalized_value ?? '').trim() || null : null;
}

function indexCells(cells: CellRecord[]): Map<string, CellRecord> {
    const byRef = new Map<string, CellRecord>();
    for (const cell of cells) {
        // A duplicated ref would silently overwrite the first one; keep the first so the
        // comparison cannot hide a structural problem in either channel.
        if (!byRef.has(cell.cell_ref)) {
            byRef.set(cell.cell_ref, cell);
        }
    }
    return byRef;
}

export function compareChannelOutputs(
    aiParsed: unknown,
    candidateParsed: unknown
): CompareResult {
    const cellsA = indexCells(buildParsedCells((aiParsed ?? {}) as Record<string, any>));
    const cellsB = indexCells(buildParsedCells((candidateParsed ?? {}) as Record<string, any>));

    const refs = new Set<string>([...cellsA.keys(), ...cellsB.keys()]);
    const counts: Record<CellCompareStatus, number> = { agree: 0, conflict: 0, a_only: 0, b_only: 0 };
    const conflicts: CellDiff[] = [];

    for (const ref of refs) {
        const a = cellsA.get(ref);
        const b = cellsB.get(ref);
        const aHas = hasNumber(a);
        const bHas = hasNumber(b);

        let status: CellCompareStatus;
        if (aHas && bHas) {
            status = a!.value_num === b!.value_num ? 'agree' : 'conflict';
        } else if (aHas && !bHas) {
            status = 'a_only';
        } else if (!aHas && bHas) {
            status = 'b_only';
        } else {
            const textA = textOf(a);
            const textB = textOf(b);
            // NA vs EMPTY is a wording difference about "no figure", so it agrees; two
            // different free-text answers do not.
            status = textA !== null && textB !== null && textA !== textB ? 'conflict' : 'agree';
        }

        counts[status] += 1;
        if (status !== 'agree' && conflicts.length < MAX_REPORTED_DIFFS) {
            conflicts.push({
                ref,
                status,
                a: aHas ? a!.value_num : null,
                b: bHas ? b!.value_num : null,
                semanticA: a ? a.value_semantic : 'ABSENT',
                semanticB: b ? b.value_semantic : 'ABSENT',
            });
        }
    }

    const total = refs.size;
    let verdict: DualChannelVerdict;
    if (total === 0) {
        verdict = 'no_candidate';
    } else if (counts.conflict > 0) {
        verdict = 'conflict';
    } else if (counts.a_only > 0) {
        verdict = 'a_gap';
    } else if (counts.b_only > 0) {
        verdict = 'agree_b_superset';
    } else {
        verdict = 'agree';
    }

    return {
        verdict,
        // Confidence measures disagreement, not coverage: cells where only B has a figure
        // are the agree_b_superset case and must not drag the score below the gate's
        // threshold, or the channel that read *more* would look worse than one that read less.
        confidence: total === 0 ? 0 : 1 - (counts.conflict + counts.a_only) / total,
        counts,
        conflicts,
    };
}

/**
 * Whether Channel B's own candidate is internally consistent. An UNCERTAIN item means a
 * component cell is missing, which runChecks reports instead of FAIL — enforce must treat
 * it as disqualifying, otherwise a candidate with holes in it would look clean.
 */
export function summariseConsistency(items: Array<{ autoStatus: string }>): {
    pass: number;
    fail: number;
    uncertain: number;
    notAssessable: number;
    total: number;
} {
    const summary = { pass: 0, fail: 0, uncertain: 0, notAssessable: 0, total: items.length };
    for (const item of items) {
        if (item.autoStatus === 'PASS') summary.pass += 1;
        else if (item.autoStatus === 'FAIL') summary.fail += 1;
        else if (item.autoStatus === 'UNCERTAIN') summary.uncertain += 1;
        else if (item.autoStatus === 'NOT_ASSESSABLE') summary.notAssessable += 1;
    }
    return summary;
}
