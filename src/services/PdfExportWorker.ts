import fs from 'fs';
import path from 'path';
import pool from '../config/database-llm';
import { generateExpiringToken } from '../middleware/auth';
import { findFrontendUrl as discoverFrontendUrl, renderPdfBuffer } from './report-export/BrowserRenderer';
import {
    COMPARISON_LANDSCAPE_PRINT_CSS,
    createComparisonPrintPageAdapter,
} from './report-export/PrintPageAdapter';
import {
    buildPdfExportPath,
    ensurePdfExportsDir,
    resolvePdfExportFilePath,
} from '../utils/pdfExportPath';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const PDF_EXPORTS_DIR = path.join(DATA_DIR, 'exports', 'pdf');
const FILE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_TOKEN_TTL_MS = 5 * 60 * 1000;
const SERVICE_TOKEN_USER_ID = Number(process.env.PDF_EXPORT_SERVICE_USER_ID || 1);
const SERVICE_TOKEN_USERNAME = process.env.PDF_EXPORT_SERVICE_USERNAME || 'pdf-export-worker';
const PRINT_READY_TIMEOUT_MS = Number(process.env.PDF_EXPORT_PRINT_READY_TIMEOUT_MS || 45000);
const POLL_INTERVAL_MS = 5000;

let isProcessing = false;
let isRunning = false;
let pollIntervalRef: NodeJS.Timeout | null = null;
let cleanupIntervalRef: NodeJS.Timeout | null = null;

function ensureExportsDir(): void {
    ensurePdfExportsDir(PDF_EXPORTS_DIR);
}

function buildPrintPath(comparisonId: number): string {
    return `/print/comparison/${comparisonId}`;
}

function toReadablePdfExportError(error: any): string {
    const message = String(error?.message || error || 'Unknown error');
    if (/frontend service|ECONNREFUSED|ERR_CONNECTION_REFUSED|net::ERR/i.test(message)) {
        return 'PDF 生成失败：前端打印服务不可用，请确认前端服务已启动后重试';
    }
    if (/browser|puppeteer|chrome|chromium|executable|spawn/i.test(message)) {
        return 'PDF 生成失败：浏览器渲染组件不可用，请检查 Chrome/Puppeteer 环境';
    }
    if (/permission|EACCES|EPERM|EROFS/i.test(message)) {
        return 'PDF 生成失败：导出目录不可写，请检查 data/exports/pdf 权限';
    }
    if (/invalid_pdf_export_file_path/i.test(message)) {
        return 'PDF 生成失败：导出文件名异常，请重新提交导出任务';
    }
    return message;
}

async function findFrontendUrl(comparisonId: number): Promise<string | null> {
    return discoverFrontendUrl({
        logPrefix: 'PdfExportWorker',
        pathToCheck: buildPrintPath(comparisonId),
        ports: [3001, 3000, 3002, 3003, 80, 8080],
        hosts: ['localhost', '127.0.0.1'],
        method: 'GET',
        requireReactRoot: true,
        warnOnRejectedCandidate: true,
    });
}

async function processJob(job: {
    id: number;
    comparison_id: number;
    export_title: string;
    file_name: string;
}): Promise<void> {
    console.log(`[PdfExportWorker] Processing job ${job.id} for comparison ${job.comparison_id}`);
    console.log('[PdfExportWorker] Using recommended /api/pdf-jobs comparison PDF export pipeline');

    try {
        await pool.query(`
      UPDATE jobs SET 
        status = 'running',
        step_code = 'RENDERING',
        step_name = 'Rendering PDF',
        progress = 10,
        started_at = NOW()
      WHERE id = $1
    `, [job.id]);

        const frontendUrl = await findFrontendUrl(job.comparison_id);
        if (!frontendUrl) {
            throw new Error('Unable to find an available frontend service');
        }

        const serviceToken = generateExpiringToken(
            Number.isFinite(SERVICE_TOKEN_USER_ID) && SERVICE_TOKEN_USER_ID > 0 ? SERVICE_TOKEN_USER_ID : 1,
            SERVICE_TOKEN_USERNAME,
            SERVICE_TOKEN_TTL_MS
        );
        const adapter = createComparisonPrintPageAdapter({
            comparisonId: job.comparison_id,
            hydrateWaitMs: 0,
            readyTimeoutMs: PRINT_READY_TIMEOUT_MS,
            emulateMediaType: 'print',
            styleTags: [COMPARISON_LANDSCAPE_PRINT_CSS],
        });

        const { buffer: pdfBuffer } = await renderPdfBuffer({
            adapter,
            frontendUrl,
            serviceToken,
            logPrefix: 'PdfExportWorker',
            hooks: {
                onBrowserStarted: async () => {
                    await pool.query(`
      UPDATE jobs SET progress = 20, step_name = 'Browser started'
      WHERE id = $1
    `, [job.id]);
                },
                onBeforeNavigate: async () => {
                    await pool.query(`
      UPDATE jobs SET progress = 30, step_name = 'Loading print page'
      WHERE id = $1
    `, [job.id]);
                },
                onAfterNavigate: async () => {
                    await pool.query(`
      UPDATE jobs SET progress = 50, step_name = 'Rendering content'
      WHERE id = $1
    `, [job.id]);
                },
                onReady: async () => {
                    await pool.query(`
      UPDATE jobs SET progress = 70, step_name = 'Generating PDF'
      WHERE id = $1
    `, [job.id]);
                },
            },
        });

        ensureExportsDir();
        const filePath = buildPdfExportPath(job.file_name, PDF_EXPORTS_DIR);
        fs.writeFileSync(filePath, pdfBuffer);
        const fileSize = pdfBuffer.length;

        console.log(`[PdfExportWorker] PDF saved to ${filePath} (${fileSize} bytes)`);

        await pool.query(`
      UPDATE jobs SET 
        status = 'done',
        step_code = 'DONE',
        step_name = 'Completed',
        progress = 100,
        file_path = $1,
        file_size = $2,
        finished_at = NOW()
      WHERE id = $3
    `, [filePath, fileSize, job.id]);

        console.log(`[PdfExportWorker] Job ${job.id} completed successfully`);
    } catch (error: any) {
        console.error(`[PdfExportWorker] Job ${job.id} failed:`, error);
        const readableError = toReadablePdfExportError(error);

        await pool.query(`
      UPDATE jobs SET 
        status = 'failed',
        step_code = 'ERROR',
        step_name = 'Generation failed',
        progress = 0,
        error_message = $1,
        finished_at = NOW()
      WHERE id = $2
    `, [readableError, job.id]);
    }
}

async function cleanupExpiredFiles(): Promise<void> {
    try {
        const now = Date.now();
        const res = await pool.query(`
      SELECT id, file_path, finished_at FROM jobs 
      WHERE kind = 'pdf_export' AND status = 'done' AND file_path IS NOT NULL
    `);
        const jobs = res.rows as Array<{ id: number; file_path: string; finished_at: string }>;

        for (const job of jobs) {
            if (!job.finished_at) continue;

            const finishedTime = new Date(job.finished_at).getTime();
            const age = now - finishedTime;

            if (age > FILE_EXPIRY_MS) {
                const safeFilePath = resolvePdfExportFilePath(job.file_path);
                if (safeFilePath && fs.existsSync(safeFilePath)) {
                    try {
                        fs.unlinkSync(safeFilePath);
                        console.log(`[PdfExportWorker] Cleaned up expired file: ${safeFilePath}`);
                    } catch {
                        console.warn(`[PdfExportWorker] Failed to delete expired file: ${safeFilePath}`);
                    }
                }

                await pool.query(`
          UPDATE jobs SET file_path = NULL, file_size = NULL 
          WHERE id = $1
        `, [job.id]);
            }
        }
    } catch (error) {
        console.error('[PdfExportWorker] Cleanup error:', error);
    }
}

async function pollAndProcess(): Promise<void> {
    if (isProcessing) {
        return;
    }

    try {
        const res = await pool.query(`
      SELECT id, comparison_id, export_title, file_name 
      FROM jobs 
      WHERE kind = 'pdf_export' AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1
    `);
        const rows = res.rows as Array<{
            id: number;
            comparison_id: number;
            export_title: string;
            file_name: string;
        }>;

        if (rows.length === 0) {
            return;
        }

        isProcessing = true;
        await processJob(rows[0]);
    } catch (error) {
        console.error('[PdfExportWorker] Poll error:', error);
    } finally {
        isProcessing = false;
    }
}

async function recoverRunningPdfExportJobs(): Promise<void> {
    await pool.query(`
      UPDATE jobs
      SET status = 'queued',
          step_code = 'QUEUED',
          step_name = 'Queued',
          progress = 0,
          started_at = NULL,
          error_code = NULL,
          error_message = NULL
      WHERE kind = 'pdf_export' AND status = 'running'
    `);
}

export function startPdfExportWorker(): void {
    if (isRunning) {
        console.log('[PdfExportWorker] Already running');
        return;
    }

    isRunning = true;
    console.log('[PdfExportWorker] Starting...');

    ensureExportsDir();

    recoverRunningPdfExportJobs().catch((error) => {
        console.error('[PdfExportWorker] Failed to recover running PDF export jobs:', error);
    });

    pollIntervalRef = setInterval(() => {
        if (isRunning) {
            void pollAndProcess();
        }
    }, POLL_INTERVAL_MS);

    cleanupIntervalRef = setInterval(() => {
        if (isRunning) {
            void cleanupExpiredFiles();
        }
    }, 60 * 60 * 1000);

    void cleanupExpiredFiles();

    console.log('[PdfExportWorker] Started. Polling every 5 seconds.');
}

export function stopPdfExportWorker(): void {
    isRunning = false;
    if (pollIntervalRef) {
        clearInterval(pollIntervalRef);
        pollIntervalRef = null;
    }
    if (cleanupIntervalRef) {
        clearInterval(cleanupIntervalRef);
        cleanupIntervalRef = null;
    }
    console.log('[PdfExportWorker] Stopped');
}

export default {
    startPdfExportWorker,
    stopPdfExportWorker,
};
