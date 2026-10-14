/**
 * Phase 2 enforce — deterministic direct-accept.
 *
 * These run the real Channel A cross-read (TableSectionScoring), the real SourceGate and
 * the real 勾稽 checks against the captured grids and the real pdfjs markdown fixtures. The
 * only thing mocked is Postgres, so the accept/decline outcome is the production outcome.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: { query: jest.fn(), connect: jest.fn() },
}));

import pool from '../config/database-llm';
import { buildSourceGateConfig } from '../services/SourceGateService';
import { parseRunService, resetParseQualityColumnCache } from '../services/ParseRunService';
import { pdfDualChannelService, resetDualChannelColumnCache } from '../services/pdf-dual-channel/PdfDualChannelService';
import { decideGate } from '../services/pdf-dual-channel/gate';
import { compareChannelOutputs } from '../services/pdf-dual-channel/channelCompare';
import {
    buildChannelAReference,
    markdownToGridPages,
    normaliseBlockWidth,
} from '../services/pdf-dual-channel/channelAReference';
import { buildCandidateParsedJson, mapGridToSkeleton } from '../services/pdf-dual-channel/tableGridMapping';
import type { ShadowHandle } from '../services/pdf-dual-channel/PdfDualChannelService';
import type { DualChannelMode } from '../services/pdf-dual-channel/config';
import type { LatticePage } from '../services/pdf-dual-channel/types';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/pdf-lattice');
const ANNUAL_DIR = path.join(process.cwd(), 'tests/fixtures/annual-report');

interface Case {
    name: string;
    grid: string;
    markdown: string;
}

const KEWEI: Case = {
    name: 'kewei',
    grid: path.join(FIXTURE_DIR, 'kewei-2024-official-sample-grid.json'),
    markdown: path.join(ANNUAL_DIR, 'kewei-2024-source.md'),
};

const SHANGHAI: Case = {
    name: 'shanghai',
    grid: path.join(FIXTURE_DIR, 'shanghai-office-2025-official-sample-grid.json'),
    markdown: path.join(ANNUAL_DIR, 'shanghai-office-sample-source.md'),
};

function loadPages(file: string): LatticePage[] {
    return JSON.parse(fs.readFileSync(file, 'utf8')).pages;
}

function makeHandle(caseName: Case, mode: DualChannelMode = 'enforce', pages?: LatticePage[]): ShadowHandle {
    return {
        ctx: {
            pdfPath: '/nonexistent/injected.pdf',
            parseRunId: 4242,
            versionId: 77,
            mode,
        },
        startedAt: Date.now(),
        extraction: Promise.resolve({
            ok: true,
            pages: pages || loadPages(caseName.grid),
            engine: 'pdfplumber',
            version: '0.11.10',
            pageCount: 8,
            elapsedMs: 120,
        }),
    };
}

/** @param missingColumns column names the probe should report as absent */
function mockColumns(missingColumns: string[] = []) {
    const executed: Array<{ sql: string; params: any[] }> = [];
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
        executed.push({ sql: String(sql), params });
        if (String(sql).includes('information_schema')) {
            const column = params[1];
            return { rows: missingColumns.includes(column) ? [] : [{ column_name: column }] };
        }
        if (String(sql).includes('reports r')) {
            return { rows: [{ year: 2024 }] };
        }
        return { rows: [] };
    });
    return executed;
}

beforeEach(() => {
    (pool.query as jest.Mock).mockReset();
    (pool.connect as jest.Mock).mockReset();
    resetDualChannelColumnCache();
    resetParseQualityColumnCache();
});

describe('evaluateDeterministic — the real accept path', () => {
    it('accepts the shanghai candidate without an LLM call', async () => {
        mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI),
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });

        expect(evaluation.accepted).toBe(true);
        expect(evaluation.reason).toBe('all_checks_passed');
        expect(evaluation.record).toMatchObject({
            mode: 'enforce',
            // Channel A's markdown cannot read every 表三 row, so B legitimately carries more
            // figures than A: that is agree_b_superset, not agree.
            verdict: 'agree_b_superset',
            confidence: 1,
            sourceGateStatus: 'passed',
            enforceReason: 'all_checks_passed',
        });
        expect(evaluation.record.counts).toMatchObject({ conflict: 0, a_only: 0 });
        expect(evaluation.record.reference).toMatchObject({
            sections: ['table_2', 'table_3'],
            table2FromProse: true,
        });
        expect(evaluation.record.gate?.checks).toMatchObject({
            modeEnforce: true,
            verdictAcceptable: true,
            noConflict: true,
            noChannelAGap: true,
            consistencyNoFail: true,
            consistencyNoUncertain: true,
            sourceGatePassed: true,
            candidateHasContent: true,
            confidenceEnough: true,
        });
        // The accepted output must be the canonical envelope the downstream pipeline expects.
        expect(evaluation.candidate!.sections.map((section: any) => section.type)).toEqual([
            'table_2',
            'table_3',
            'table_4',
        ]);
        expect(evaluation.candidate!._ingestion.mode).toBe('dual_channel_enforce');
        expect(evaluation.record.coverage).toMatchObject({ table3RowsFilled: 25, table2Categories: 6 });
    });
});

describe('evaluateDeterministic — every decline reason that matters', () => {
    it('declines the kewei sample because its 表三 has holes (UNCERTAIN, not FAIL)', async () => {
        mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(KEWEI),
            sourceText: fs.readFileSync(KEWEI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });

        // pdfplumber loses 「（六）其他处理」 on this PDF, so 分项之和 cannot be computed for
        // ten checks. SourceGate still passes (every figure it can see is in the text), which
        // is exactly why enforce must also require zero UNCERTAIN.
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.reason).toBe('consistency_uncertain');
        expect(evaluation.record.verdict).toBe('agree_b_superset');
        expect(evaluation.record.counts).toMatchObject({ conflict: 0, a_only: 0 });
        expect(evaluation.record.sourceGateStatus).toBe('passed');
        expect(evaluation.record.consistency).toMatchObject({ fail: 0, uncertain: 10 });
        expect(evaluation.candidate).toBeNull();
    });

    it('declines when Channel B misreads a figure Channel A also read', async () => {
        mockColumns();
        const pages = loadPages(SHANGHAI.grid);
        // Corrupt 规范性文件 本年制发件数 in the grid: Channel A's markdown still says 34.
        for (const page of pages) {
            for (const table of page.tables) {
                for (const row of table.rows) {
                    if (row.some((cell) => cell && cell.includes('规范性文件'))) {
                        const index = row.findIndex((cell) => cell === '34');
                        if (index >= 0) {
                            row[index] = '94';
                        }
                    }
                }
            }
        }

        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI, 'enforce', pages),
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });

        expect(evaluation.accepted).toBe(false);
        // The verdict check runs first, so a disagreement is reported as the verdict itself;
        // `channels_conflict` stays as the defensive second line inside decideGate.
        expect(evaluation.reason).toBe('verdict_conflict');
        expect(evaluation.record.verdict).toBe('conflict');
        expect(evaluation.record.conflicts[0]).toMatchObject({
            ref: 'active_disclosure:normative_documents:made',
            a: 34,
            b: 94,
        });
    });

    it('declines when Channel A has no deterministic 表二 reading to check against', async () => {
        mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI),
            sourceText: '',
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.record.verdict).toBe('no_reference');
        expect(evaluation.reason).toBe('verdict_no_reference');
    });

    it('declines when the sidecar failed', async () => {
        mockColumns();
        const handle = makeHandle(SHANGHAI);
        handle.extraction = Promise.resolve({
            ok: false,
            code: 'timeout',
            message: 'sidecar exceeded 60000ms',
        } as any);

        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle,
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.reason).toBe('channel_error');
        expect(evaluation.record.sidecarError).toMatchObject({ code: 'timeout' });
    });

    it('declines when the confidence threshold is raised above the observed agreement', async () => {
        mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI),
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
            minConfidence: 1.01,
        });
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.reason).toBe('confidence_below_1.01');
    });

    it('shadow mode can never accept, whatever the evidence', async () => {
        mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI, 'shadow'),
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(false);
        expect(evaluation.reason).toBe('mode_shadow');
    });
});

describe('decideGate unit coverage of the remaining branches', () => {
    const clean = {
        mode: 'enforce' as DualChannelMode,
        verdict: 'agree' as const,
        confidence: 1,
        counts: { agree: 10, conflict: 0, a_only: 0, b_only: 0 },
        consistency: { pass: 42, fail: 0, uncertain: 0, notAssessable: 0, total: 42 },
        sourceGatePassed: true,
        hasCandidateContent: true,
        minConfidence: 0.99,
    };

    it('accepts when everything holds, and reports that a reference was used', () => {
        const decision = decideGate(clean);
        expect(decision).toMatchObject({ action: 'accept_candidate', reason: 'all_checks_passed', referenceUsed: true });
    });

    it('off is never enforce', () => {
        expect(decideGate({ ...clean, mode: 'off' })).toMatchObject({ action: 'use_llm', reason: 'mode_off' });
    });

    it('rejects a superset when the caller forbids it', () => {
        const decision = decideGate({ ...clean, verdict: 'agree_b_superset', allowSuperset: false });
        expect(decision.action).toBe('use_llm');
        expect(decision.reason).toBe('verdict_agree_b_superset');
    });

    it('accepts a superset by default', () => {
        expect(
            decideGate({ ...clean, verdict: 'agree_b_superset', counts: { ...clean.counts, b_only: 3 } }).action
        ).toBe('accept_candidate');
    });

    it('treats a null source gate as not passed', () => {
        expect(decideGate({ ...clean, sourceGatePassed: null }).reason).toBe('source_gate_not_passed');
    });

    it('fails when the checker reported a real imbalance', () => {
        expect(
            decideGate({ ...clean, consistency: { ...clean.consistency, fail: 2 } }).reason
        ).toBe('consistency_fail');
    });

    it('records that no Channel A reference was available', () => {
        const decision = decideGate({ ...clean, counts: null });
        expect(decision.referenceUsed).toBe(false);
        expect(decision.checks.noConflict).toBe(true);
    });
});

describe('Channel A deterministic reference (pdfjs markdown)', () => {
    it('splits markdown tables into grid blocks and ignores separator rows', () => {
        const pages = markdownToGridPages([
            '一、总体情况',
            '| 信息内容 | 本年制发件数 |',
            '|---|---|',
            '| 规章 | 3 |',
            '',
            '二、别的章节',
            '| 甲 | 1 |',
        ].join('\n'));
        expect(pages).toHaveLength(2);
        expect(pages[0].tables[0].rows).toEqual([['信息内容', '本年制发件数'], ['规章', '3']]);
        expect(pages[1].tables[0].rows).toEqual([['甲', '1']]);
    });

    it('collapses a row padded with a trailing empty cell to the block width', () => {
        // pdfjs writes the last row with an extra "|  |", which made the "trailing 7 columns"
        // rule shift every 表三 value one column left.
        const normalised = normaliseBlockWidth([
            ['一、本年新收', '32', '2', '0', '0', '0', '0', '34'],
            ['四、结转下年度继续办理', '1', '0', '0', '0', '0', '0', null],
        ]);
        expect(normalised[1]).toHaveLength(8);
        expect(normalised[1][7]).toBeNull();
    });

    it('reads 表二 from the real markdown with the figures CI pins as ground truth', () => {
        const kewei = buildChannelAReference(fs.readFileSync(KEWEI.markdown, 'utf8'));
        const table2 = kewei.parsedJson!.sections.find((section: any) => section.type === 'table_2');
        // Ground truth: src/__tests__/keweiPdfE2E.p0.test.ts:116-121
        expect(table2.activeDisclosureData).toEqual({
            regulations: { made: 0, repealed: 0, valid: 0 },
            normativeDocuments: { made: 13, repealed: 0, valid: 55 },
            licensing: { processed: 97 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
        });
    });

    it('produces no false conflict against Channel B on either fixture', () => {
        for (const fixture of [KEWEI, SHANGHAI]) {
            const a = buildChannelAReference(fs.readFileSync(fixture.markdown, 'utf8'));
            const b = buildCandidateParsedJson(mapGridToSkeleton(loadPages(fixture.grid)), {});
            const compared = compareChannelOutputs(a.parsedJson, b);
            // The shift bug produced 5 and 8 spurious conflicts before the width collapse.
            expect(compared.counts.conflict).toBe(0);
            expect(compared.counts.a_only).toBe(0);
            expect(compared.verdict).toBe('agree_b_superset');
            expect(compared.counts.agree).toBeGreaterThan(40);
        }
    });

    it('returns no reference when there is no markdown at all', () => {
        const empty = buildChannelAReference('');
        expect(empty.parsedJson).toBeNull();
        expect(empty.gridBlocks).toBe(0);
    });
});

describe('LlmJobRunner wiring (source structure, house pattern for this file)', () => {
    const runnerSource = fs.readFileSync(
        path.join(process.cwd(), 'src/services/LlmJobRunner.ts'),
        'utf8'
    );

    it('tries the deterministic accept before any provider.parse call', () => {
        const body = runnerSource.slice(runnerSource.indexOf('private async processParseJob'));
        const acceptAt = body.indexOf('this.tryDualChannelAccept(');
        const parseAt = body.indexOf('provider.parse({');
        expect(acceptAt).toBeGreaterThan(-1);
        expect(parseAt).toBeGreaterThan(-1);
        // Plan §Phase 2: "candidate_output 直接 accepted. 不调用 LLM."
        expect(acceptAt).toBeLessThan(parseAt);
        expect(body.slice(acceptAt, acceptAt + 1200)).toMatch(/if \(dualAccept\) \{[\s\S]*?return;\s*\}/);
    });

    it('only the enforce mode can reach the accept branch', () => {
        const helper = runnerSource.slice(runnerSource.indexOf('private async tryDualChannelAccept'));
        expect(helper.slice(0, 900)).toContain("handle.ctx.mode !== 'enforce'");
    });

    it('a declined trial returns null so the LLM path still runs', () => {
        const helper = runnerSource.slice(runnerSource.indexOf('private async tryDualChannelAccept'));
        expect(helper).toMatch(/if \(!evaluation\.accepted \|\| !evaluation\.candidate\) \{[\s\S]*?return null;/);
        // and an exception in the trial cannot fail the job
        expect(helper).toMatch(/catch \(error: any\) \{[\s\S]*?return null;\s*\}/);
    });

    it('shadow still writes its record from the finally block of processParseJob', () => {
        const body = runnerSource.slice(runnerSource.indexOf('private async processParseJob'));
        expect(body).toMatch(/finally \{[\s\S]*?completeShadow\(dualChannelShadow, draftOutput\)/);
    });
});

describe('parse_quality_level marker', () => {
    /** Drives finalizeParseRun far enough to see which statements it issues. */
    async function runFinalize(input: Record<string, any>, qualityColumnExists: boolean) {
        const executed: Array<{ sql: string; params: any[] }> = [];
        const client = {
            query: jest.fn(async (sql: string, params: any[] = []) => {
                const text = String(sql);
                executed.push({ sql: text, params });
                if (text.includes('SELECT pr.*')) {
                    return {
                        rows: [{
                            id: 12,
                            report_version_id: 9,
                            report_id: 4,
                            status: 'running',
                            provider: 'openai',
                            model: 'gpt-5.5',
                            prompt_version: 'p1',
                            schema_version: 's1',
                        }],
                        rowCount: 1,
                    };
                }
                if (text.includes('information_schema')) {
                    return { rows: qualityColumnExists ? [{ column_name: 'parse_quality_level' }] : [], rowCount: 0 };
                }
                return { rows: text.includes('RETURNING') ? [{ id: 777 }] : [], rowCount: 0 };
            }),
            release: jest.fn(),
        };
        (pool.connect as jest.Mock).mockResolvedValue(client);
        resetParseQualityColumnCache();

        await parseRunService.finalizeParseRun({
            parseRunId: 12,
            finalStatus: 'accepted',
            outputJson: { sections: [{ type: 'table_3', title: 't', tableData: { naturalPerson: { newReceived: 1 } } }] },
            enqueueFollowupJobs: false,
            ...input,
        });
        return executed;
    }

    it('records dual on a deterministic accept and ai on an LLM accept', async () => {
        const dual = await runFinalize({ parseQualityLevel: 'dual' }, true);
        const marker = dual.find((entry) => entry.sql.includes('parse_quality_level = $1'));
        expect(marker).toBeDefined();
        expect(marker!.params).toEqual(['dual', 12]);

        const ai = await runFinalize({ parseQualityLevel: 'ai' }, true);
        expect(ai.find((entry) => entry.sql.includes('parse_quality_level = $1'))!.params).toEqual(['ai', 12]);
    });

    it('writes nothing when the caller does not declare a quality level', async () => {
        const executed = await runFinalize({}, true);
        expect(executed.some((entry) => entry.sql.includes('parse_quality_level'))).toBe(false);
    });

    it('still accepts the run when migration 0006 has not been applied', async () => {
        const executed = await runFinalize({ parseQualityLevel: 'dual' }, false);
        // The probe runs, the marker does not, and the accept UPDATE is still issued.
        expect(executed.some((entry) => entry.sql.includes("SET status = 'accepted'"))).toBe(true);
        expect(executed.some((entry) => entry.sql.includes('parse_quality_level = $1'))).toBe(false);
    });
});

describe('persistRecord keeps one writer per column', () => {
    it('writes only dual_channel_json, never the quality marker', async () => {
        const executed = mockColumns();
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle: makeHandle(SHANGHAI),
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(true);

        await pdfDualChannelService.persistRecord(4242, evaluation.record);
        const update = executed.filter((entry) => entry.sql.trim().startsWith('UPDATE parse_runs')).pop()!;
        expect(update.sql).toContain('dual_channel_json = $1');
        expect(update.sql).not.toContain('parse_quality_level');
        expect(update.params).toHaveLength(2);
    });

    it('skips the write entirely when the audit column is missing', async () => {
        const executed = mockColumns(['dual_channel_json']);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await pdfDualChannelService.persistRecord(4242, { version: 'v1' } as any);
        expect(executed.some((entry) => entry.sql.trim().startsWith('UPDATE parse_runs'))).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('npm run db:migrate'));
        warn.mockRestore();
    });
});

describe('shadow pass after an enforce decision', () => {
    it('never re-writes an accepted enforce record from the shadow pass', async () => {
        mockColumns();
        const handle = makeHandle(SHANGHAI);
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle,
            sourceText: fs.readFileSync(SHANGHAI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(true);
        handle.completed = true;

        await expect(pdfDualChannelService.completeShadow(handle, { sections: [] })).resolves.toBeNull();
    });

    it('carries the enforce decline into the single shadow record', async () => {
        mockColumns();
        const handle = makeHandle(KEWEI);
        const evaluation = await pdfDualChannelService.evaluateDeterministic({
            handle,
            sourceText: fs.readFileSync(KEWEI.markdown, 'utf8'),
            sourceGateConfig: buildSourceGateConfig(),
        });
        expect(evaluation.accepted).toBe(false);

        const record = await pdfDualChannelService.completeShadow(handle, {
            sections: [{ type: 'table_3', title: 't', tableData: { naturalPerson: { newReceived: 32 } } }],
        });
        expect(record).toMatchObject({
            enforceReason: 'consistency_uncertain',
            mode: 'enforce',
        });
        expect(record!.gate!.reason).toBe('consistency_uncertain');
    });
});
