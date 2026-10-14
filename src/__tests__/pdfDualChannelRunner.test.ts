/**
 * Phase 1 Shadow runner contract: Channel B must produce a record and must not be able to
 * change the accepted parse output — including when it fails.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: { query: jest.fn(), connect: jest.fn() },
}));

jest.mock('../services/pdf-dual-channel/LatticeSidecarClient', () => ({
    __esModule: true,
    extractLattice: jest.fn(),
}));

import pool from '../config/database-llm';
import { extractLattice } from '../services/pdf-dual-channel/LatticeSidecarClient';
import {
    pdfDualChannelService,
    resetDualChannelColumnCache,
    type ShadowContext,
} from '../services/pdf-dual-channel/PdfDualChannelService';
import { buildCandidateParsedJson, mapGridToSkeleton } from '../services/pdf-dual-channel/tableGridMapping';
import type { LatticePage } from '../services/pdf-dual-channel/types';

const GRID_FIXTURE = path.join(process.cwd(), 'tests/fixtures/pdf-lattice/kewei-2024-official-sample-grid.json');
const PDF_PATH = path.join(process.cwd(), 'tests/fixtures/annual-report/kewei-2024-official-sample.pdf');

function gridPages(): LatticePage[] {
    return JSON.parse(fs.readFileSync(GRID_FIXTURE, 'utf8')).pages;
}

function okExtraction(overrides: Record<string, any> = {}) {
    return {
        ok: true,
        pages: gridPages(),
        engine: 'pdfplumber',
        version: '0.11.10',
        pageCount: 8,
        elapsedMs: 140,
        ...overrides,
    } as any;
}

function ctx(overrides: Partial<ShadowContext> = {}): ShadowContext {
    return {
        pdfPath: PDF_PATH,
        parseRunId: 4242,
        versionId: 77,
        mode: 'shadow',
        ...overrides,
    };
}

/** Every SQL statement the shadow path issues, so we can prove nothing else is written. */
function captureQueries(columnExists = true) {
    const executed: Array<{ sql: string; params: any[] }> = [];
    (pool.query as jest.Mock).mockImplementation(async (sql: string, params: any[] = []) => {
        executed.push({ sql: String(sql), params });
        if (String(sql).includes('information_schema')) {
            return { rows: columnExists ? [{ column_name: 'dual_channel_json' }] : [] };
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
    (extractLattice as jest.Mock).mockReset();
    resetDualChannelColumnCache();
});

describe('pdfDualChannelService — mode gate (the rollback lever)', () => {
    it('off never starts the sidecar', () => {
        const handle = pdfDualChannelService.beginShadow(ctx({ mode: 'off' }));
        expect(handle).toBeNull();
        expect(extractLattice).not.toHaveBeenCalled();
    });

    it('ignores anything that is not a PDF', () => {
        expect(pdfDualChannelService.shouldRun('/tmp/report.html', 'shadow')).toBe(false);
        expect(pdfDualChannelService.shouldRun('/tmp/REPORT.PDF', 'shadow')).toBe(true);
        expect(pdfDualChannelService.shouldRun('', 'shadow')).toBe(false);
    });

    it('shadow starts the sidecar without awaiting it', () => {
        (extractLattice as jest.Mock).mockReturnValue(new Promise(() => {}));
        const handle = pdfDualChannelService.beginShadow(ctx());
        expect(handle).not.toBeNull();
        expect(extractLattice).toHaveBeenCalledWith(
            expect.objectContaining({ pdfPath: PDF_PATH, signal: undefined })
        );
    });

    it('a null handle completes to null without touching the database', async () => {
        const executed = captureQueries();
        await expect(pdfDualChannelService.completeShadow(null, {})).resolves.toBeNull();
        expect(executed).toHaveLength(0);
    });
});

describe('pdfDualChannelService — shadow record', () => {
    it('records agree and writes only parse_runs.dual_channel_json', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        const executed = captureQueries();
        const skeleton = mapGridToSkeleton(gridPages());
        const aiOutput = buildCandidateParsedJson(skeleton, { year: 2024 });

        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, aiOutput);

        expect(record).toMatchObject({
            version: 'v1',
            mode: 'shadow',
            source: 'dual_channel',
            verdict: 'agree',
            confidence: 1,
            engine: 'pdfplumber',
            engineVersion: '0.11.10',
        });
        expect(record!.coverage).toMatchObject({ table3RowsExpected: 25, table3RowsFilled: 22, gridTables: 5 });

        const writes = executed.filter((entry) => /^\s*(UPDATE|INSERT|DELETE)/i.test(entry.sql));
        expect(writes).toHaveLength(1);
        expect(writes[0].sql).toContain('dual_channel_json');
        expect(writes[0].sql).toContain('WHERE id = $2');
        expect(String(writes[0].params[0])).toContain('"verdict":"agree"');
        // The accepted output lives in parse_runs.output_json / report_versions.parsed_json.
        // Shadow must never write either one.
        expect(executed.some((entry) => /output_json|parsed_json|draft_output/.test(entry.sql))).toBe(false);
    });

    it('reports the candidate as it really is when Channel B disagrees with Channel A', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        captureQueries();
        const skeleton = mapGridToSkeleton(gridPages());
        const aiOutput = buildCandidateParsedJson(skeleton, { year: 2024 });
        // Break one figure in Channel A's copy.
        aiOutput.sections[0].activeDisclosureData.regulations.made = 999;

        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, aiOutput);
        expect(record!.verdict).toBe('conflict');
        expect(record!.conflicts[0].ref).toBe('active_disclosure:regulations:made');
    });

    it('marks a failed Channel A as a_unavailable instead of counting B as an extra', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        captureQueries();
        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, null);
        expect(record!.verdict).toBe('a_unavailable');
        expect(record!.counts).toBeNull();
        // Channel B's own 勾稽 result is still recorded, which is the shadow statistic that matters.
        expect(record!.consistency).toMatchObject({ fail: 0 });
        expect(record!.consistency!.uncertain).toBeGreaterThan(0);
    });

    it('degrades to channel_error when the sidecar fails', async () => {
        (extractLattice as jest.Mock).mockResolvedValue({ ok: false, code: 'python_unavailable', message: 'no python' });
        const executed = captureQueries();
        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, { sections: [] });
        expect(record).toMatchObject({
            verdict: 'channel_error',
            sidecarError: { code: 'python_unavailable', message: 'no python' },
        });
        expect(record!.coverage).toBeNull();
        expect(executed.some((entry) => entry.sql.includes('dual_channel_json') && entry.sql.includes('UPDATE'))).toBe(true);
    });

    it('says no_candidate when the grid yields nothing usable', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction({ pages: [] }));
        captureQueries();
        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, {
            sections: [{ type: 'table_3', title: 'x', tableData: { naturalPerson: { newReceived: 1 } } }],
        });
        expect(record!.verdict).toBe('no_candidate');
    });

    it('skips the write and warns when the migration has not run yet', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        const executed = captureQueries(false);
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const record = await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, {
            sections: [{ type: 'table_3', title: 'x', tableData: { naturalPerson: { newReceived: 1 } } }],
        });

        expect(record).not.toBeNull();
        expect(executed.some((entry) => entry.sql.trim().startsWith('UPDATE parse_runs'))).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('npm run db:migrate'));
        warn.mockRestore();
    });

    it('cannot break the parse job when the database call fails', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        (pool.query as jest.Mock).mockRejectedValue(new Error('connection lost'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const handle = pdfDualChannelService.beginShadow(ctx())!;
        // The column probe swallows the connection error, so the shadow write is skipped
        // and the job's own outcome is untouched — that is the rollback property that matters.
        await expect(pdfDualChannelService.completeShadow(handle, {})).resolves.toMatchObject({
            verdict: 'a_unavailable',
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('npm run db:migrate'));
        warn.mockRestore();
    });

    it('returns null instead of rejecting when the sidecar promise itself blows up', async () => {
        (extractLattice as jest.Mock).mockRejectedValue(new Error('spawn exploded'));
        captureQueries();
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});

        const handle = pdfDualChannelService.beginShadow(ctx())!;
        await expect(pdfDualChannelService.completeShadow(handle, {})).resolves.toBeNull();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('shadow record failed'));
        error.mockRestore();
    });

    it('reads the report year so the 勾稽 checks run with the real period', async () => {
        (extractLattice as jest.Mock).mockResolvedValue(okExtraction());
        const executed = captureQueries();
        await pdfDualChannelService.completeShadow(pdfDualChannelService.beginShadow(ctx())!, {});
        expect(executed.some((entry) => entry.sql.includes('report_versions rv') && entry.params[0] === 77)).toBe(true);
    });
});
