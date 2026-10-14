/**
 * Phase 3 — suspect table signals.
 *
 * The visual remedy used to fire only when a table was missing or a 勾稽 check failed. The
 * plan adds two more signals: `visual_border_missing` from the pdfjs border audit, and a
 * dual-channel disagreement (Channel B read a different figure than Channel A for the same
 * canonical cell). Both are collected here as pure data, so the decision stays testable and
 * VisionReviewService keeps ownership of its existing consistency predicate.
 */

export type SuspectTableId = 'table_2' | 'table_3' | 'table_4';

export type SuspectReason = 'table_missing' | 'visual_border_missing' | 'dual_channel_conflict' | 'consistency_failure';

/** cell_ref prefixes emitted by MaterializeService, mapped to the canonical table they belong to. */
const TABLE_BY_CELL_PREFIX: Record<string, SuspectTableId> = {
    active_disclosure: 'table_2',
    application: 'table_3',
    legal_proceeding: 'table_4',
};

const CHECK_KEY_PREFIX: Record<string, SuspectTableId> = {
    t2_: 'table_2',
    t3_: 'table_3',
    t4_: 'table_4',
};

export function tableIdForCellRef(ref: string): SuspectTableId | null {
    const prefix = String(ref || '').split(':')[0];
    return TABLE_BY_CELL_PREFIX[prefix] || null;
}

export function tableIdForCheckKey(checkKey: string): SuspectTableId | null {
    const key = String(checkKey || '');
    for (const [prefix, tableId] of Object.entries(CHECK_KEY_PREFIX)) {
        if (key.startsWith(prefix)) {
            return tableId;
        }
    }
    return null;
}

export interface DualChannelSignals {
    verdict?: string | null;
    conflicts?: Array<{ ref?: string; status?: string }> | null;
    coverage?: {
        candidateSectionTypes?: string[];
        table3RowsFilled?: number;
        table3RowsExpected?: number;
    } | null;
}

export interface ConsistencySignals {
    groupKey?: string;
    checkKey?: string;
    autoStatus?: string;
}

export interface SuspectInput {
    /** Table ids the existing consistency predicate already flagged. */
    consistencyFailureTableIds?: SuspectTableId[];
    visualBorderMissing?: boolean;
    dualChannel?: DualChannelSignals | null;
}

export type SuspectMap = Record<SuspectTableId, SuspectReason[]>;

function emptyMap(): SuspectMap {
    return { table_2: [], table_3: [], table_4: [] };
}

function add(map: SuspectMap, tableId: SuspectTableId | null, reason: SuspectReason): void {
    if (!tableId) {
        return;
    }
    if (!map[tableId].includes(reason)) {
        map[tableId].push(reason);
    }
}

/**
 * A table the candidate never produced is suspect even with no numeric disagreement: an
 * absent table produces no 勾稽 item at all (it is NOT_ASSESSABLE), which is precisely the
 * case the old trigger missed.
 */
function missingSections(dualChannel: DualChannelSignals | null | undefined): SuspectTableId[] {
    const produced = new Set(dualChannel?.coverage?.candidateSectionTypes || []);
    if (produced.size === 0) {
        return [];
    }
    return (['table_2', 'table_3', 'table_4'] as SuspectTableId[]).filter((id) => !produced.has(id));
}

export function collectSuspectTables(input: SuspectInput): SuspectMap {
    const map = emptyMap();

    for (const tableId of input.consistencyFailureTableIds || []) {
        add(map, tableId, 'consistency_failure');
    }

    if (input.visualBorderMissing) {
        // The border audit is document-wide; without ruled lines every table may be mis-gridded.
        add(map, 'table_2', 'visual_border_missing');
        add(map, 'table_3', 'visual_border_missing');
        add(map, 'table_4', 'visual_border_missing');
    }

    for (const tableId of missingSections(input.dualChannel)) {
        add(map, tableId, 'table_missing');
    }

    const conflicts = input.dualChannel?.conflicts || [];
    for (const conflict of conflicts) {
        if (conflict?.status !== 'conflict') {
            continue;
        }
        add(map, tableIdForCellRef(conflict.ref || ''), 'dual_channel_conflict');
    }

    return map;
}

export function suspectTableIds(map: SuspectMap): SuspectTableId[] {
    return (Object.keys(map) as SuspectTableId[]).filter((tableId) => map[tableId].length > 0);
}

export interface ImprovementInput {
    /** FAIL check keys before and after the repair. */
    beforeFailKeys: string[];
    afterFailKeys: string[];
    beforeUncertainCount?: number;
    afterUncertainCount?: number;
}

export interface ImprovementDecision {
    adopt: boolean;
    reason:
        | 'improved'
        | 'no_change'
        | 'worse'
        | 'new_failure_introduced'
        | 'still_failing';
    beforeFailCount: number;
    afterFailCount: number;
    newFailKeys: string[];
}

/**
 * The plan's adoption rule: only a repair that lowers the FAIL count is taken, and only when
 * it introduces no new failure. A repair that trades one wrong figure for another one (the
 * same count, different keys) is rejected — otherwise the swap would look like progress.
 */
export function evaluateRepairImprovement(input: ImprovementInput): ImprovementDecision {
    const before = Array.from(new Set(input.beforeFailKeys || []));
    const after = Array.from(new Set(input.afterFailKeys || []));
    const newFailKeys = after.filter((key) => !before.includes(key));

    const base = {
        beforeFailCount: before.length,
        afterFailCount: after.length,
        newFailKeys,
    };

    if (after.length > before.length) {
        return { ...base, reason: 'worse', adopt: false };
    }
    if (newFailKeys.length > 0) {
        return { ...base, reason: 'new_failure_introduced', adopt: false };
    }
    if (after.length === before.length) {
        return { ...base, reason: 'no_change', adopt: false };
    }
    if (after.length > 0) {
        // Fewer failures but still failing: the figure is still wrong, so it must not be
        // written over the human review queue as if it were fixed.
        return { ...base, reason: 'still_failing', adopt: false };
    }
    return { ...base, reason: 'improved', adopt: true };
}
