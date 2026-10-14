import path from 'node:path';

import pool from '../../config/database-llm';
import { ConsistencyCheckService } from '../ConsistencyCheckService';
import { hasParsedContent } from '../../utils/parsedContent';
import { sourceGateService, type SourceGateConfig } from '../SourceGateService';
import { buildChannelAReference } from './channelAReference';
import { extractLattice, type LatticeClientResult } from './LatticeSidecarClient';
import { buildCandidateParsedJson, mapGridToSkeleton } from './tableGridMapping';
import { compareChannelOutputs, summariseConsistency, type CellDiff, type DualChannelVerdict } from './channelCompare';
import { decideGate, type GateDecision } from './gate';
import {
    PDF_DUAL_CHANNEL_MODE,
    PDF_DUAL_CHANNEL_MIN_CONFIDENCE,
    PDF_DUAL_CHANNEL_VERSION,
    type DualChannelMode,
} from './config';
import type { LatticePage } from './types';

const PDF_EXTENSIONS = new Set(['.pdf']);

export interface DualChannelRecord {
    version: string;
    mode: DualChannelMode;
    verdict: DualChannelVerdict;
    source: 'dual_channel';
    confidence: number;
    conflicts: CellDiff[];
    counts: Record<string, number> | null;
    engine: string | null;
    engineVersion: string | null;
    sidecarMs: number | null;
    sidecarError: { code: string; message: string } | null;
    coverage: {
        gridTables: number;
        table3RowsFilled: number;
        table3RowsExpected: number;
        table2Categories: number;
        table4Groups: number;
        candidateSectionTypes: string[];
    } | null;
    consistency: ReturnType<typeof summariseConsistency> | null;
    /** Enforce only: the gate decision that let the candidate in, or blocked it. */
    gate: GateDecision | null;
    /** Why enforce took (or refused) this candidate, including refusals before the gate. */
    enforceReason: string | null;
    /** How complete Channel A's deterministic reading was, so an "agree" is never mistaken
     *  for a full cross-check when A only produced a handful of cells. */
    reference: { sections: string[]; gridBlocks: number; table2FromProse: boolean } | null;
    sourceGateStatus: string | null;
    recordedAt: string;
}

export interface DeterministicEvaluation {
    accepted: boolean;
    reason: string;
    record: DualChannelRecord;
    /** The output to persist when accepted; null otherwise. */
    candidate: Record<string, any> | null;
    sourceGateResult: Awaited<ReturnType<typeof sourceGateService.evaluate>> | null;
}

export interface ShadowContext {
    pdfPath: string;
    parseRunId: number;
    versionId: number;
    mode?: DualChannelMode;
    signal?: AbortSignal;
}

export interface ShadowHandle {
    ctx: ShadowContext;
    startedAt: number;
    extraction: Promise<LatticeClientResult>;
    /** Enforce outcome recorded so the Shadow write can report why it deferred to the LLM. */
    enforce?: {
        reason: string;
        decision: GateDecision | null;
        sourceGateStatus: string | null;
    };
    /** Set once enforce has written its own record; Shadow must not overwrite it. */
    completed?: boolean;
}

type LatticeSuccess = Extract<LatticeClientResult, { ok: true }>;

export interface DeterministicInput {
    /** Handle from beginShadow(): Channel B is already running for this attempt. */
    handle: ShadowHandle;
    /** Channel A's pdfjs markdown, used for the 表二 cross-read and the source gate. */
    sourceText: string;
    sourceGateConfig: SourceGateConfig;
    minConfidence?: number;
}

/** Cached so a missing audit column degrades to "not recorded" instead of an error. */
let dualChannelColumnExists: boolean | null = null;

async function hasColumn(table: string, column: string): Promise<boolean> {
    try {
        const result = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
            [table, column]
        );
        return result.rows.length > 0;
    } catch {
        return false;
    }
}

async function hasDualChannelColumn(): Promise<boolean> {
    if (dualChannelColumnExists === null) {
        dualChannelColumnExists = await hasColumn('parse_runs', 'dual_channel_json');
    }
    return dualChannelColumnExists;
}

/** Test seam: forget the cached column probe between suites. */
export function resetDualChannelColumnCache(): void {
    dualChannelColumnExists = null;
}

async function lookupReportYear(versionId: number): Promise<number | null> {
    try {
        const result = await pool.query(
            `SELECT r.year FROM report_versions rv
             JOIN reports r ON r.id = rv.report_id
             WHERE rv.id = $1`,
            [versionId]
        );
        const year = Number(result.rows[0]?.year);
        return Number.isFinite(year) ? year : null;
    } catch {
        return null;
    }
}

export class PdfDualChannelService {
    private consistencyService = new ConsistencyCheckService();

    /** True when Channel B should run for this source at all. */
    shouldRun(pdfPath: string, mode: DualChannelMode = PDF_DUAL_CHANNEL_MODE): boolean {
        if (mode === 'off') {
            return false;
        }
        return PDF_EXTENSIONS.has(path.extname(String(pdfPath || '')).toLowerCase());
    }

    /**
     * Kick the sidecar off without awaiting it. The LLM call dominates parse latency, so
     * starting Channel B before it means shadow mode adds almost no wall time; a PDF that
     * takes longer than the LLM answer is bounded by the sidecar's own timeout.
     */
    beginShadow(ctx: ShadowContext): ShadowHandle | null {
        const mode = ctx.mode || PDF_DUAL_CHANNEL_MODE;
        if (!this.shouldRun(ctx.pdfPath, mode)) {
            return null;
        }
        return {
            ctx: { ...ctx, mode },
            startedAt: Date.now(),
            extraction: extractLattice({ pdfPath: ctx.pdfPath, signal: ctx.signal }),
        };
    }

    /**
     * Compare and persist. Never throws and never returns anything the caller could use to
     * change the accepted output — Shadow is an audit trail only.
     */
    async completeShadow(handle: ShadowHandle | null, aiOutput: unknown): Promise<DualChannelRecord | null> {
        if (!handle || handle.completed) {
            return null;
        }
        try {
            const record = await this.buildRecord(handle, aiOutput);
            await this.persistRecord(handle.ctx.parseRunId, record);
            return record;
        } catch (error: any) {
            // Channel B must not be able to fail a parse job.
            console.error(
                `[dual-channel] shadow record failed for parse_run ${handle.ctx.parseRunId}: ${error?.message || error}`
            );
            return null;
        }
    }

    async buildRecord(handle: ShadowHandle, aiOutput: unknown): Promise<DualChannelRecord> {
        const record = this.newBaseRecord(handle.ctx.mode || PDF_DUAL_CHANNEL_MODE);
        const extraction = await handle.extraction;
        record.sidecarMs = Date.now() - handle.startedAt;

        if (!extraction.ok) {
            record.sidecarError = { code: extraction.code, message: extraction.message };
            return record;
        }

        record.engine = extraction.engine;
        record.engineVersion = extraction.version;

        const analysed = await this.analyseCandidate(extraction, handle.ctx.versionId);
        record.coverage = analysed.coverage;
        record.consistency = analysed.consistency;
        if (analysed.consistencyError) {
            record.sidecarError = { code: 'consistency_failed', message: analysed.consistencyError };
        }

        if (!hasParsedContent(analysed.candidate)) {
            record.verdict = 'no_candidate';
            return record;
        }

        if (!hasParsedContent(aiOutput)) {
            // A failed or gate-blocked attempt has no accepted output to compare against;
            // counting its cells as "B has extras" would inflate the agree ratio.
            record.verdict = 'a_unavailable';
            return record;
        }

        const compared = compareChannelOutputs(aiOutput, analysed.candidate);
        record.verdict = compared.verdict;
        record.confidence = Number(compared.confidence.toFixed(4));
        record.counts = compared.counts;
        record.conflicts = compared.conflicts;

        if (handle.enforce) {
            // Enforce already decided on this attempt; keep that decision visible in the
            // one record row this parse_run gets.
            record.gate = handle.enforce.decision;
            record.enforceReason = handle.enforce.reason;
            record.sourceGateStatus = handle.enforce.sourceGateStatus;
        }
        return record;
    }

    /**
     * Phase 2 enforce: read the PDF through Channel B, cross-check it against Channel A's
     * deterministic 表二 reader and the source gate, and say whether the candidate may be
     * accepted without calling the LLM. This method decides; it never writes to the
     * database, so the caller keeps full control of what gets persisted.
     */
    async evaluateDeterministic(input: DeterministicInput): Promise<DeterministicEvaluation> {
        const { handle } = input;
        const mode = handle.ctx.mode || PDF_DUAL_CHANNEL_MODE;
        const record = this.newBaseRecord(mode);

        const extraction = await handle.extraction;
        record.sidecarMs = Date.now() - handle.startedAt;

        if (!extraction.ok) {
            record.sidecarError = { code: extraction.code, message: extraction.message };
            return { accepted: false, reason: 'channel_error', record, candidate: null, sourceGateResult: null };
        }

        record.engine = extraction.engine;
        record.engineVersion = extraction.version;

        const analysed = await this.analyseCandidate(extraction, handle.ctx.versionId);
        record.coverage = analysed.coverage;
        record.consistency = analysed.consistency;
        if (analysed.consistencyError) {
            record.sidecarError = { code: 'consistency_failed', message: analysed.consistencyError };
        }

        if (!hasParsedContent(analysed.candidate)) {
            record.verdict = 'no_candidate';
            return { accepted: false, reason: 'no_candidate', record, candidate: null, sourceGateResult: null };
        }

        // Channel A is read deterministically from the pdfjs markdown: the same mapper both
        // sides use, so 表二 and 表三 are comparable cell by cell. Where A cannot resolve a
        // table it simply contributes no cells (they show up as b_only), which is why an
        // incomplete A reading must never be read as agreement.
        const reference = buildChannelAReference(input.sourceText || '');
        let compared: ReturnType<typeof compareChannelOutputs> | null = null;
        if (reference.parsedJson) {
            compared = compareChannelOutputs(reference.parsedJson, analysed.candidate);
            record.verdict = compared.verdict;
            record.confidence = Number(compared.confidence.toFixed(4));
            record.counts = compared.counts;
            record.conflicts = compared.conflicts;
            record.reference = {
                sections: reference.sections,
                gridBlocks: reference.gridBlocks,
                table2FromProse: reference.table2FromProse,
            };
        } else {
            record.verdict = 'no_reference';
        }

        const sourceGateResult = sourceGateService.evaluate(
            analysed.candidate,
            input.sourceText || '',
            input.sourceGateConfig
        );
        record.sourceGateStatus = sourceGateResult.status;

        const decision = decideGate({
            mode,
            verdict: record.verdict,
            confidence: record.confidence,
            counts: compared ? compared.counts : null,
            consistency: record.consistency,
            sourceGatePassed: sourceGateResult.passed,
            hasCandidateContent: true,
            minConfidence: input.minConfidence ?? PDF_DUAL_CHANNEL_MIN_CONFIDENCE,
        });
        record.gate = decision;
        record.enforceReason = decision.reason;
        // The Shadow write in the finally block carries this forward, so a run that
        // enforce declined still shows the rejection reason instead of being overwritten.
        handle.enforce = {
            reason: decision.reason,
            decision,
            sourceGateStatus: record.sourceGateStatus,
        };

        if (decision.action !== 'accept_candidate') {
            return { accepted: false, reason: decision.reason, record, candidate: null, sourceGateResult };
        }

        return {
            accepted: true,
            reason: decision.reason,
            record,
            candidate: {
                ...analysed.candidate,
                _ingestion: { ...(analysed.candidate._ingestion || {}), mode: 'dual_channel_enforce' },
            },
            sourceGateResult,
        };
    }

    private newBaseRecord(mode: DualChannelMode): DualChannelRecord {
        return {
            version: PDF_DUAL_CHANNEL_VERSION,
            mode,
            verdict: 'channel_error',
            source: 'dual_channel',
            confidence: 0,
            conflicts: [],
            counts: null,
            engine: null,
            engineVersion: null,
            sidecarMs: null,
            sidecarError: null,
            coverage: null,
            consistency: null,
            gate: null,
            enforceReason: null,
            reference: null,
            sourceGateStatus: null,
            recordedAt: new Date().toISOString(),
        };
    }

    private async analyseCandidate(extraction: LatticeSuccess, versionId: number) {
        const skeleton = mapGridToSkeleton(extraction.pages as LatticePage[]);
        const year = await lookupReportYear(versionId);
        const candidate = buildCandidateParsedJson(skeleton, { year, engineVersion: extraction.version });
        const coverage: NonNullable<DualChannelRecord['coverage']> = {
            gridTables: skeleton.gridTableCount,
            table3RowsFilled: skeleton.matched.table_3.length,
            table3RowsExpected: 25,
            table2Categories: Object.keys(skeleton.activeDisclosureData).length,
            table4Groups: Object.keys(skeleton.reviewLitigationData).length,
            candidateSectionTypes: candidate.sections.map((section: any) => section.type),
        };

        let consistency: DualChannelRecord['consistency'] = null;
        let consistencyError: string | null = null;
        try {
            consistency = summariseConsistency(this.consistencyService.runChecks(candidate, year));
        } catch (error: any) {
            consistencyError = String(error?.message || error);
        }

        return { skeleton, candidate, year, coverage, consistency, consistencyError };
    }

    /**
     * Shadow writes only the verdict. `parse_quality_level` belongs to the accept itself and
     * is set by ParseRunService.finalizeParseRun, so this method never touches it — one
     * column, one writer.
     */
    /**
     * Latest Channel B audit for a version, for downstream triggers (Phase 3 visual remedy).
     * Returns null whenever the feature is off, the column is missing, or the read fails:
     * no caller should ever become dependent on Channel B existing.
     */
    async loadLatestRecord(versionId: number): Promise<DualChannelRecord | null> {
        if (!(await hasDualChannelColumn())) {
            return null;
        }
        try {
            const result = await pool.query(
                `SELECT pr.dual_channel_json
                 FROM parse_runs pr
                 WHERE pr.report_version_id = $1
                   AND pr.is_current = TRUE
                   AND pr.dual_channel_json IS NOT NULL
                 ORDER BY pr.id DESC
                 LIMIT 1`,
                [versionId]
            );
            const raw = result.rows[0]?.dual_channel_json;
            if (!raw) {
                return null;
            }
            return (typeof raw === 'string' ? JSON.parse(raw) : raw) as DualChannelRecord;
        } catch {
            return null;
        }
    }

    async persistRecord(parseRunId: number, record: DualChannelRecord): Promise<void> {
        if (!(await hasDualChannelColumn())) {
            console.warn(
                `[dual-channel] parse_runs.dual_channel_json is missing; run npm run db:migrate to enable shadow records.`
            );
            return;
        }
        await pool.query(`UPDATE parse_runs SET dual_channel_json = $1 WHERE id = $2`, [
            JSON.stringify(record),
            parseRunId,
        ]);
    }
}

export const pdfDualChannelService = new PdfDualChannelService();
export default pdfDualChannelService;
