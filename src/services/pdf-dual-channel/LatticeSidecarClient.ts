import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

import type { LatticeExtraction, LatticePage, LatticeTable } from './types';

export type { LatticeExtraction, LatticePage, LatticeTable };

export interface LatticeClientOptions {
    pdfPath: string;
    strategy?: 'lattice' | 'text';
    maxPages?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
}

export type LatticeFailureCode =
    | 'python_unavailable'
    | 'script_missing'
    | 'bad_pdf_path'
    | 'engine_unsupported'
    | 'timeout'
    | 'aborted'
    | 'killed'
    | 'non_zero_exit'
    | 'invalid_json'
    | 'engine_reported_failure'
    | 'stdout_too_large';

export type LatticeClientResult =
    | { ok: true; pages: LatticePage[]; engine: string; version: string | null; pageCount: number; elapsedMs: number }
    | { ok: false; code: LatticeFailureCode; message: string };

type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

const DEFAULT_TIMEOUT_MS = 60_000;
const SIGTERM_GRACE_MS = 5_000;
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENCY = 2;

export function envInt(name: string, fallback: number): number {
    const raw = Number(process.env[name]);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : fallback;
}

export function resolvePythonPath(): string {
    return (process.env.PDF_LATTICE_PYTHON_PATH || '').trim() || 'python3';
}

export function resolveScriptPath(): string {
    const fromEnv = (process.env.PDF_LATTICE_SCRIPT_PATH || '').trim();
    if (fromEnv) {
        return fromEnv;
    }
    // __dirname is src/services/pdf-dual-channel under ts-node and dist/services/...
    // after build; the sidecar sits at the repo root either way.
    return path.resolve(__dirname, '..', '..', '..', 'scripts', 'pdf_lattice_extract.py');
}

/**
 * PDF_LATTICE_ENGINE selects the extraction engine. Only pdfplumber is implemented today,
 * and a request for anything else is refused here rather than passed to Python, so a typo
 * in production env shows up as an explicit `engine_unsupported` verdict instead of a
 * silently ignored variable.
 */
export const SUPPORTED_LATTICE_ENGINES = ['pdfplumber'];

export function resolveEngine(): string {
    return (process.env.PDF_LATTICE_ENGINE || 'pdfplumber').trim().toLowerCase() || 'pdfplumber';
}

/**
 * One module-wide budget: a shadow run over a PDF batch must not fork an unbounded
 * number of interpreters. Handing a freed slot to a waiter leaves inFlight unchanged.
 */
let inFlight = 0;
interface QueueEntry {
    resolve: () => void;
    reject: (error: Error) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
}
const waiters: QueueEntry[] = [];

function acquireSlot(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(new Error('aborted'));
    }
    const limit = envInt('PDF_LATTICE_MAX_CONCURRENCY', DEFAULT_MAX_CONCURRENCY);
    if (inFlight < limit) {
        inFlight += 1;
        return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
        const entry: QueueEntry = { resolve, reject, signal };
        entry.onAbort = () => {
            const index = waiters.indexOf(entry);
            if (index >= 0) {
                waiters.splice(index, 1);
            }
            reject(new Error('aborted'));
        };
        signal?.addEventListener('abort', entry.onAbort, { once: true });
        waiters.push(entry);
    });
}

function releaseSlot(): void {
    inFlight -= 1;
    const next = waiters.shift();
    if (!next) {
        return;
    }
    if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
    }
    next.resolve();
}

export function sidecarQueueDepth(): number {
    return waiters.length;
}

export function sidecarInFlight(): number {
    return inFlight;
}

function terminate(child: SidecarChild, graceMs = SIGTERM_GRACE_MS): void {
    if (child.exitCode !== null || child.signalCode !== null) {
        return;
    }
    child.kill('SIGTERM');
    const killer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
    }, graceMs);
    killer.unref();
}

/**
 * Runs the pdfplumber sidecar for one PDF. Never throws: every failure mode comes back
 * as ok:false, so a broken Channel B degrades the dual channel instead of disturbing
 * the existing pdfjs -> LLM flow.
 */
export async function extractLattice(options: LatticeClientOptions): Promise<LatticeClientResult> {
    const pdfPath = (options.pdfPath || '').trim();
    if (!pdfPath || !path.isAbsolute(pdfPath)) {
        return { ok: false, code: 'bad_pdf_path', message: 'pdf path must be absolute' };
    }
    if (!fs.existsSync(pdfPath)) {
        return { ok: false, code: 'bad_pdf_path', message: `pdf not found: ${pdfPath}` };
    }

    const scriptPath = resolveScriptPath();
    if (!fs.existsSync(scriptPath)) {
        return { ok: false, code: 'script_missing', message: `sidecar script missing: ${scriptPath}` };
    }

    const pythonPath = resolvePythonPath();
    const engine = resolveEngine();
    if (!SUPPORTED_LATTICE_ENGINES.includes(engine)) {
        return {
            ok: false,
            code: 'engine_unsupported',
            message: `PDF_LATTICE_ENGINE=${engine} is not implemented (supported: ${SUPPORTED_LATTICE_ENGINES.join(', ')})`,
        };
    }

    const timeoutMs = options.timeoutMs ?? envInt('PDF_LATTICE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    const args = [
        scriptPath,
        pdfPath,
        '--engine',
        engine,
        '--strategy',
        options.strategy === 'text' ? 'text' : 'lattice',
        '--max-pages',
        String(options.maxPages ?? 0),
    ];

    let acquired = false;
    try {
        await acquireSlot(options.signal);
        acquired = true;
    } catch {
        return { ok: false, code: 'aborted', message: 'aborted before sidecar start' };
    }

    try {
        // A signal that fired while this call was queued will never deliver another
        // 'abort' event to a listener registered now, so check the flag before spawning.
        if (options.signal?.aborted) {
            return { ok: false, code: 'aborted', message: 'aborted before sidecar start' };
        }
        return await runChild(pythonPath, args, timeoutMs, options.signal);
    } finally {
        if (acquired) {
            releaseSlot();
        }
    }
}

function runChild(
    pythonPath: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal
): Promise<LatticeClientResult> {
    return new Promise<LatticeClientResult>((resolve) => {
        let child: SidecarChild;
        try {
            child = spawn(pythonPath, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            });
        } catch (error: any) {
            resolve({ ok: false, code: 'python_unavailable', message: error?.message || 'spawn failed' });
            return;
        }

        let stdout = '';
        let stdoutBytes = 0;
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let aborted = false;

        const timer = setTimeout(() => {
            timedOut = true;
            terminate(child);
        }, timeoutMs);

        const onAbort = () => {
            aborted = true;
            terminate(child, 1_000);
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        };

        const finish = (result: LatticeClientResult) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(result);
        };

        child.stdout.on('data', (chunk: Buffer) => {
            if (settled) {
                return;
            }
            stdoutBytes += chunk.length;
            if (stdoutBytes > MAX_STDOUT_BYTES) {
                terminate(child, 500);
                finish({ ok: false, code: 'stdout_too_large', message: `stdout exceeded ${MAX_STDOUT_BYTES} bytes` });
                return;
            }
            stdout += chunk.toString('utf8');
        });

        // stderr is a log stream, not a contract — keep only the tail for diagnostics.
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf8');
            if (stderr.length > 8_000) {
                stderr = stderr.slice(-8_000);
            }
        });

        child.on('error', (error: any) => {
            const code = error?.code === 'ENOENT' ? 'python_unavailable' : 'engine_reported_failure';
            finish({ ok: false, code, message: error?.message || 'sidecar spawn error' });
        });

        child.on('close', (code, signalName) => {
            if (settled) {
                return;
            }

            if (aborted) {
                finish({ ok: false, code: 'aborted', message: 'sidecar aborted' });
                return;
            }
            if (timedOut) {
                finish({ ok: false, code: 'timeout', message: `sidecar exceeded ${timeoutMs}ms` });
                return;
            }
            if (signalName) {
                finish({ ok: false, code: 'killed', message: `sidecar killed by ${signalName}` });
                return;
            }

            let parsed: LatticeExtraction | null = null;
            try {
                parsed = JSON.parse(stdout) as LatticeExtraction;
            } catch {
                finish({
                    ok: false,
                    code: 'invalid_json',
                    message: `sidecar stdout is not JSON (exit ${code}); stderr: ${stderr.slice(0, 300)}`,
                });
                return;
            }

            if (!parsed || parsed.ok !== true) {
                finish({
                    ok: false,
                    code: 'engine_reported_failure',
                    message: (parsed && parsed.message) || `sidecar reported failure (exit ${code})`,
                });
                return;
            }
            if (!Array.isArray(parsed.pages)) {
                finish({ ok: false, code: 'invalid_json', message: 'sidecar payload has no pages array' });
                return;
            }

            finish({
                ok: true,
                pages: parsed.pages,
                engine: parsed.engine,
                version: parsed.version ?? null,
                pageCount: parsed.page_count ?? parsed.pages.length,
                elapsedMs: parsed.elapsed_ms ?? 0,
            });
        });
    });
}
