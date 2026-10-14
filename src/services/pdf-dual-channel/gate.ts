import type { CellCompareStatus, DualChannelVerdict } from './channelCompare';
import type { DualChannelMode } from './config';

/**
 * Phase 2 enforce decision.
 *
 * Pure and fail-closed: anything that is not provably clean falls back to the LLM path,
 * which is the behaviour that has been running in production all along.
 */

export interface ConsistencySummaryLike {
    pass: number;
    fail: number;
    uncertain: number;
    notAssessable: number;
    total: number;
}

export interface GateInput {
    mode: DualChannelMode;
    verdict: DualChannelVerdict | string;
    confidence: number;
    /**
     * null when Channel A has no deterministic counterpart for what B produced. In this
     * repo the pdfjs path can only be parsed without an LLM for 表二, so 表三/表四 are
     * verified through SourceGate (every figure must exist in the pdfjs text layer) and the
     * 勾稽 checks instead of a cell-by-cell A/B compare.
     */
    counts: Record<CellCompareStatus, number> | null;
    consistency: ConsistencySummaryLike | null;
    /** null means the source gate did not run for this candidate. */
    sourceGatePassed: boolean | null;
    hasCandidateContent: boolean;
    minConfidence: number;
    /** Phase 2 only ever accepts these verdicts; everything else defers to the LLM. */
    allowSuperset?: boolean;
}

export interface GateChecks {
    modeEnforce: boolean;
    verdictAcceptable: boolean;
    noConflict: boolean;
    noChannelAGap: boolean;
    consistencyNoFail: boolean;
    consistencyNoUncertain: boolean;
    sourceGatePassed: boolean;
    candidateHasContent: boolean;
    confidenceEnough: boolean;
}

export interface GateDecision {
    action: 'accept_candidate' | 'use_llm';
    reason: string;
    checks: GateChecks;
}

export interface GateDecision {
    action: 'accept_candidate' | 'use_llm';
    reason: string;
    checks: GateChecks;
    /** False when no Channel A reference existed, i.e. the A/B cell compare was skipped. */
    referenceUsed: boolean;
}

const ACCEPTABLE_VERDICTS: DualChannelVerdict[] = ['agree', 'agree_b_superset'];

export function decideGate(input: GateInput): GateDecision {
    const allowSuperset = input.allowSuperset !== false;
    const counts = input.counts;
    const consistency = input.consistency;

    const checks: GateChecks = {
        modeEnforce: input.mode === 'enforce',
        verdictAcceptable:
            ACCEPTABLE_VERDICTS.includes(input.verdict as DualChannelVerdict) &&
            (allowSuperset || input.verdict !== 'agree_b_superset'),
        // With no Channel A reference there is nothing to conflict against; SourceGate and
        // the 勾稽 checks carry the verification in that case.
        noConflict: counts ? counts.conflict === 0 : true,
        noChannelAGap: counts ? counts.a_only === 0 : true,
        consistencyNoFail: Boolean(consistency && consistency.fail === 0),
        // An absent component cell is reported UNCERTAIN, not FAIL. A candidate with holes
        // in it therefore has to be disqualified here, or "FAIL = 0" would let it through.
        consistencyNoUncertain: Boolean(consistency && consistency.uncertain === 0),
        sourceGatePassed: input.sourceGatePassed === true,
        candidateHasContent: input.hasCandidateContent,
        confidenceEnough: input.confidence >= input.minConfidence,
    };

    const failed = Object.entries(checks).find(([, passed]) => !passed);
    if (!failed) {
        return {
            action: 'accept_candidate',
            reason: 'all_checks_passed',
            checks,
            referenceUsed: Boolean(counts),
        };
    }

    const reasons: Record<keyof GateChecks, string> = {
        modeEnforce: input.mode === 'off' ? 'mode_off' : 'mode_shadow',
        verdictAcceptable: `verdict_${input.verdict}`,
        noConflict: 'channels_conflict',
        noChannelAGap: 'channel_a_has_more',
        consistencyNoFail: 'consistency_fail',
        consistencyNoUncertain: 'consistency_uncertain',
        sourceGatePassed: 'source_gate_not_passed',
        candidateHasContent: 'no_candidate_content',
        confidenceEnough: `confidence_below_${input.minConfidence}`,
    };

    return {
        action: 'use_llm',
        reason: reasons[failed[0] as keyof GateChecks],
        checks,
        referenceUsed: Boolean(counts),
    };
}
