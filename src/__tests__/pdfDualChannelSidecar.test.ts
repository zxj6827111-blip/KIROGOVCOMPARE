/**
 * Phase 0.2/0.3 — LatticeSidecarClient contract: the Node side must survive every Python
 * failure mode without throwing, because Channel B is not allowed to disturb the
 * existing pdfjs -> LLM flow.
 */
import fs from 'fs';
import path from 'path';

import {
    extractLattice,
    resolveScriptPath,
    sidecarInFlight,
    sidecarQueueDepth,
} from '../services/pdf-dual-channel/LatticeSidecarClient';

const REPO_ROOT = process.cwd();
const SHIM = path.join(REPO_ROOT, 'tests/fixtures/pdf-lattice/latticeShim.js');
const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts/pdf_lattice_extract.py');
const SMALL_PDF = path.join(REPO_ROOT, 'tests/fixtures/structured-import/valid-source.pdf');

const savedEnv: NodeJS.ProcessEnv = { ...process.env };

function useShim(mode: string): void {
    process.env.PDF_LATTICE_PYTHON_PATH = process.execPath;
    process.env.PDF_LATTICE_SCRIPT_PATH = SHIM;
    process.env.LATTICE_SHIM_MODE = mode;
}

beforeEach(() => {
    process.env = { ...savedEnv };
    delete process.env.PDF_LATTICE_PYTHON_PATH;
    delete process.env.PDF_LATTICE_SCRIPT_PATH;
    delete process.env.PDF_LATTICE_TIMEOUT_MS;
    delete process.env.PDF_LATTICE_MAX_CONCURRENCY;
});

afterAll(() => {
    process.env = { ...savedEnv };
});

describe('LatticeSidecarClient', () => {
    it('resolves the sidecar script at the repo root', () => {
        expect(fs.existsSync(REAL_SCRIPT)).toBe(true);
        process.env.PDF_LATTICE_SCRIPT_PATH = '';
        expect(resolveScriptPath()).toBe(REAL_SCRIPT);
    });

    it('rejects a relative or missing PDF before spawning anything', async () => {
        useShim('ok');
        await expect(extractLattice({ pdfPath: 'data/relative.pdf' })).resolves.toMatchObject({
            ok: false,
            code: 'bad_pdf_path',
        });
        await expect(
            extractLattice({ pdfPath: path.join(REPO_ROOT, 'tests/fixtures/nope.pdf') })
        ).resolves.toMatchObject({ ok: false, code: 'bad_pdf_path' });
    });

    it('reports a missing sidecar script instead of throwing', async () => {
        process.env.PDF_LATTICE_PYTHON_PATH = process.execPath;
        process.env.PDF_LATTICE_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/not_there.py');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({ ok: false, code: 'script_missing' });
    });

    it('refuses an unsupported PDF_LATTICE_ENGINE before spawning anything', async () => {
        useShim('ok');
        process.env.PDF_LATTICE_ENGINE = 'tabula';
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('engine_unsupported');
            expect(result.message).toContain('tabula');
        }
    });

    it('accepts the engine name in any case, since env values are hand-typed', async () => {
        useShim('ok');
        process.env.PDF_LATTICE_ENGINE = 'PdfPlumber';
        await expect(extractLattice({ pdfPath: SMALL_PDF })).resolves.toMatchObject({ ok: true });
    });

    it('reports python_unavailable when the interpreter is missing', async () => {
        useShim('ok');
        process.env.PDF_LATTICE_PYTHON_PATH = 'definitely-not-a-real-python-binary';
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.code).toBe('python_unavailable');
        }
    });

    it('returns the parsed payload when the sidecar succeeds', async () => {
        useShim('ok');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({ ok: true, engine: 'pdfplumber', pageCount: 1 });
        if (result.ok) {
            expect(result.pages[0].tables[0].rows).toEqual([['规章', '1']]);
        }
    });

    it('surfaces an engine-reported failure as ok:false with the engine message', async () => {
        useShim('fail');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({
            ok: false,
            code: 'engine_reported_failure',
            message: 'pdfplumber not installed',
        });
    });

    it('treats non-JSON stdout as invalid_json', async () => {
        useShim('garbage');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({ ok: false, code: 'invalid_json' });
    });

    it('treats empty stdout as invalid_json', async () => {
        useShim('silent');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({ ok: false, code: 'invalid_json' });
    });

    it('rejects a success envelope without a pages array', async () => {
        useShim('wrongshape');
        const result = await extractLattice({ pdfPath: SMALL_PDF });
        expect(result).toMatchObject({ ok: false, code: 'invalid_json' });
    });

    it('kills the child on timeout', async () => {
        useShim('slow');
        const started = Date.now();
        const result = await extractLattice({ pdfPath: SMALL_PDF, timeoutMs: 300 });
        expect(result).toMatchObject({ ok: false, code: 'timeout' });
        expect(Date.now() - started).toBeLessThan(4_000);
    });

    it('honours AbortSignal', async () => {
        useShim('slow');
        const controller = new AbortController();
        const pending = extractLattice({ pdfPath: SMALL_PDF, timeoutMs: 30_000, signal: controller.signal });
        setTimeout(() => controller.abort(), 50);
        await expect(pending).resolves.toMatchObject({ ok: false, code: 'aborted' });
    });

    it('caps concurrent sidecars and queues the rest', async () => {
        useShim('slow');
        process.env.PDF_LATTICE_MAX_CONCURRENCY = '1';
        const controller = new AbortController();
        const runs = [
            extractLattice({ pdfPath: SMALL_PDF, timeoutMs: 30_000, signal: controller.signal }),
            extractLattice({ pdfPath: SMALL_PDF, timeoutMs: 30_000, signal: controller.signal }),
            extractLattice({ pdfPath: SMALL_PDF, timeoutMs: 30_000, signal: controller.signal }),
        ];
        // The fast path increments synchronously, so the queue is observable here.
        expect(sidecarInFlight()).toBe(1);
        expect(sidecarQueueDepth()).toBe(2);

        controller.abort();
        const settled = await Promise.all(runs);
        settled.forEach((result) => {
            expect(result).toMatchObject({ ok: false, code: 'aborted' });
        });
        expect(sidecarInFlight()).toBe(0);
        expect(sidecarQueueDepth()).toBe(0);
    });

    it('runs the real Python sidecar when pdfplumber is installed', async () => {
        delete process.env.PDF_LATTICE_PYTHON_PATH;
        delete process.env.PDF_LATTICE_SCRIPT_PATH;
        const probe = await extractLattice({
            pdfPath: path.join(REPO_ROOT, 'tests/fixtures/annual-report/kewei-2024-official-sample.pdf'),
            timeoutMs: 60_000,
        });
        if (!probe.ok) {
            // CI images have no Python/pdfplumber yet; the shim cases above cover the
            // protocol, and this case proves the real engine on a developer machine.
            // eslint-disable-next-line no-console
            console.warn(`[dual-channel] real sidecar unavailable in this environment: ${probe.code} ${probe.message}`);
            expect(['python_unavailable', 'engine_reported_failure', 'invalid_json']).toContain(probe.code);
            return;
        }
        expect(probe.engine).toBe('pdfplumber');
        expect(probe.pages.length).toBeGreaterThan(0);
        const tables = probe.pages.flatMap((page) => page.tables);
        expect(tables.length).toBeGreaterThan(0);
        expect(tables.some((table) => table.col_count >= 9)).toBe(true);
    }, 90_000);
});
