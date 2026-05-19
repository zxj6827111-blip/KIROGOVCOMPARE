import puppeteer from 'puppeteer';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import pool from '../config/database-llm';
import { generateExpiringToken } from '../middleware/auth';

const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');

// PDF 瀵煎嚭鏂囦欢瀛樺偍鐩綍
const PDF_EXPORTS_DIR = path.join(DATA_DIR, 'exports', 'pdf');

// 鏂囦欢杩囨湡鏃堕棿锛?澶╋紝鍗曚綅锛氭绉掞級
const FILE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_TOKEN_TTL_MS = 5 * 60 * 1000;
const SERVICE_TOKEN_USER_ID = Number(process.env.PDF_EXPORT_SERVICE_USER_ID || 1);
const SERVICE_TOKEN_USERNAME = process.env.PDF_EXPORT_SERVICE_USERNAME || 'pdf-export-worker';
const PRINT_READY_TIMEOUT_MS = Number(process.env.PDF_EXPORT_PRINT_READY_TIMEOUT_MS || 45000);

// Worker 杞闂撮殧锛?绉掞級
const POLL_INTERVAL_MS = 5000;
// Recommended comparison PDF path: /api/pdf-jobs -> PdfExportWorker -> React print page.
const PRINT_READY_SELECTOR = '#comparison-content[data-print-ready="true"]';
const LANDSCAPE_PRINT_CSS = `
@page {
  size: 297mm 210mm !important;
  margin: 10mm !important;
}
@page comparison-landscape {
  size: 297mm 210mm !important;
  margin: 10mm !important;
}
html,
body {
  width: 297mm !important;
  min-height: 210mm !important;
}
.comparison-print-page {
  page: comparison-landscape !important;
}
`;
const FRONTEND_PLACEHOLDER_HOSTS = new Set([
    'your-domain.com',
    'www.your-domain.com',
    'example.com',
    'www.example.com'
]);

// 鏄惁姝ｅ湪澶勭悊浠诲姟
let isProcessing = false;

// Worker 鏄惁鍚姩
let isRunning = false;
let pollIntervalRef: NodeJS.Timeout | null = null;
let cleanupIntervalRef: NodeJS.Timeout | null = null;

/**
 * 纭繚瀵煎嚭鐩綍瀛樺湪
 */
function ensureExportsDir(): void {
    if (!fs.existsSync(PDF_EXPORTS_DIR)) {
        fs.mkdirSync(PDF_EXPORTS_DIR, { recursive: true });
    }
}

/**
 * 妫€鏌?URL 鏄惁鍙闂?
 */
function isPlaceholderFrontendUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return FRONTEND_PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
        return true;
    }
}

function buildPrintPath(comparisonId: number): string {
    return `/print/comparison/${comparisonId}`;
}

/**
 * 妫€鏌?URL 鏄惁鍙闂? */
function isFrontendUrlAccessible(url: string, pathToCheck = '/'): Promise<boolean> {
    return new Promise((resolve) => {
        let urlObj: URL;
        try {
            urlObj = new URL(pathToCheck, url);
        } catch {
            resolve(false);
            return;
        }
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
            method: 'GET',
            timeout: 3000
        };

        const req = client.request(options, (res) => {
            if (res.statusCode === undefined || res.statusCode >= 500) {
                res.resume();
                resolve(false);
                return;
            }

            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
                if (body.length > 20000) {
                    req.destroy();
                }
            });
            res.on('end', () => {
                const looksLikeReactFrontend =
                    body.includes('<div id="root"></div>') &&
                    (body.includes('/static/js/') || body.includes('static/js/'));
                resolve(looksLikeReactFrontend);
            });
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.end();
    });
}

/**
 * 鏌ユ壘鍙敤鐨勫墠绔?URL
 */
async function findFrontendUrl(comparisonId: number): Promise<string | null> {
    const printPath = buildPrintPath(comparisonId);
    const candidateUrls: string[] = [];

    const addCandidate = (url: string | undefined | null) => {
        const trimmed = url?.trim();
        if (!trimmed) return;
        const normalized = trimmed.replace(/\/+$/, '');
        if (!candidateUrls.includes(normalized)) {
            candidateUrls.push(normalized);
        }
    };

    if (process.env.FRONTEND_URL) {
        if (isPlaceholderFrontendUrl(process.env.FRONTEND_URL)) {
            console.warn(`[PdfExportWorker] Ignoring placeholder FRONTEND_URL: ${process.env.FRONTEND_URL}`);
        } else {
            addCandidate(process.env.FRONTEND_URL);
        }
    }

    [3001, 3000, 3002, 3003, 80, 8080].forEach((port) => {
        addCandidate(`http://localhost:${port}`);
        addCandidate(`http://127.0.0.1:${port}`);
    });

    for (const url of candidateUrls) {
        const isAccessible = await isFrontendUrlAccessible(url, printPath);
        if (isAccessible) {
            console.log(`[PdfExportWorker] Found frontend at ${url}`);
            return url;
        } else {
            console.warn(`[PdfExportWorker] Candidate is not the print frontend: ${url}`);
        }
    }

    return null;
}

/**
 * 澶勭悊鍗曚釜 PDF 瀵煎嚭浠诲姟
 */
async function processJob(job: {
    id: number;
    comparison_id: number;
    export_title: string;
    file_name: string;
}): Promise<void> {
    console.log(`[PdfExportWorker] Processing job ${job.id} for comparison ${job.comparison_id}`);
    console.log(`[PdfExportWorker] Using recommended /api/pdf-jobs comparison PDF export pipeline`);

    let browser = null;

    try {
        // 鏇存柊鐘舵€佷负 running
        await pool.query(`
      UPDATE jobs SET 
        status = 'running',
        step_code = 'RENDERING',
        step_name = 'Rendering PDF',
        progress = 10,
        started_at = NOW()
      WHERE id = $1
    `, [job.id]);

        // 鏌ユ壘鍓嶇 URL
        const frontendUrl = await findFrontendUrl(job.comparison_id);
        if (!frontendUrl) {
            throw new Error('Unable to find an available frontend service');
        }

        // 鍚姩 Puppeteer
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--font-render-hinting=none'
            ]
        });

        await pool.query(`
      UPDATE jobs SET progress = 20, step_name = 'Browser started'
      WHERE id = $1
    `, [job.id]);

        const page = await browser.newPage();

        // 璁剧疆瑙嗗彛
        await page.setViewport({
            width: 1600,
            height: 900,
            deviceScaleFactor: 1
        });

        // 瀵艰埅鍒版墦鍗伴〉闈?
        const serviceToken = generateExpiringToken(
            Number.isFinite(SERVICE_TOKEN_USER_ID) && SERVICE_TOKEN_USER_ID > 0 ? SERVICE_TOKEN_USER_ID : 1,
            SERVICE_TOKEN_USERNAME,
            SERVICE_TOKEN_TTL_MS
        );
        const printParams = new URLSearchParams({ service_token: serviceToken });
        const printUrl = `${frontendUrl}/print/comparison/${job.comparison_id}?${printParams}`;
        const logUrl = `${frontendUrl}/print/comparison/${job.comparison_id}`;
        console.log(`[PdfExportWorker] Navigating to ${logUrl} (service token redacted)`);

        await pool.query(`
      UPDATE jobs SET progress = 30, step_name = 'Loading print page'
      WHERE id = $1
    `, [job.id]);

        await page.goto(printUrl, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // 绛夊緟鍐呭鍔犺浇
        await pool.query(`
      UPDATE jobs SET progress = 50, step_name = 'Rendering content'
      WHERE id = $1
    `, [job.id]);

        try {
            await page.waitForSelector(PRINT_READY_SELECTOR, { timeout: PRINT_READY_TIMEOUT_MS });
        } catch (e) {
            console.warn('[PdfExportWorker] Timeout waiting for print-ready marker, checking page state');
            const errorElement = await page.$('.text-red-500');
            if (errorElement) {
                const errorText = await page.evaluate(el => el?.textContent, errorElement);
                throw new Error(`Print page error: ${errorText}`);
            }
            await page.waitForSelector('#comparison-content', { timeout: 5000 });
        }

        await page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()');
        console.log('[PdfExportWorker] Fonts reported ready');

        await page.emulateMediaType('print');
        await page.addStyleTag({ content: LANDSCAPE_PRINT_CSS });

        // 棰濆绛夊緟纭繚鏍峰紡鍜屽紓姝ユ枃鏈樊寮傛覆鏌撳畬鎴?        await new Promise(resolve => setTimeout(resolve, 500));

        await pool.query(`
      UPDATE jobs SET progress = 70, step_name = 'Generating PDF'
      WHERE id = $1
    `, [job.id]);

        // 鐢熸垚 PDF
        const pdfBuffer = await page.pdf({
            width: '297mm',
            height: '210mm',
            printBackground: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            },
            preferCSSPageSize: false
        });

        // 淇濆瓨鏂囦欢
        ensureExportsDir();
        const filePath = path.join(PDF_EXPORTS_DIR, job.file_name);
        fs.writeFileSync(filePath, pdfBuffer);
        const fileSize = pdfBuffer.length;

        console.log(`[PdfExportWorker] PDF saved to ${filePath} (${fileSize} bytes)`);

        // 鏇存柊浠诲姟鐘舵€佷负瀹屾垚
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

        // 鏇存柊浠诲姟鐘舵€佷负澶辫触
        await pool.query(`
      UPDATE jobs SET 
        status = 'failed',
        step_code = 'ERROR',
        step_name = 'Generation failed',
        progress = 0,
        error_message = $1,
        finished_at = NOW()
      WHERE id = $2
    `, [error.message || 'Unknown error', job.id]);

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * 娓呯悊杩囨湡鏂囦欢
 */
async function cleanupExpiredFiles(): Promise<void> {
    try {
        const now = Date.now();

        // 鑾峰彇宸插畬鎴愪笖鏂囦欢瀛樺湪鐨勪换鍔?
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
                // 鏂囦欢宸茶繃鏈?
                if (fs.existsSync(job.file_path)) {
                    try {
                        fs.unlinkSync(job.file_path);
                        console.log(`[PdfExportWorker] Cleaned up expired file: ${job.file_path}`);
                    } catch (e) {
                        console.warn(`[PdfExportWorker] Failed to delete expired file: ${job.file_path}`);
                    }
                }

                // 娓呴櫎鏂囦欢璺緞锛堜繚鐣欎换鍔¤褰曪級
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

/**
 * 杞骞跺鐞嗛槦鍒椾腑鐨勪换鍔?
 */
async function pollAndProcess(): Promise<void> {
    if (isProcessing) {
        return; // 宸叉湁浠诲姟鍦ㄥ鐞嗕腑
    }

    try {
        // 鑾峰彇涓嬩竴涓緟澶勭悊浠诲姟
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
            return; // 娌℃湁寰呭鐞嗕换鍔?
        }

        isProcessing = true;
        await processJob(rows[0]);

    } catch (error) {
        console.error('[PdfExportWorker] Poll error:', error);
    } finally {
        isProcessing = false;
    }
}

/**
 * 鍚姩 PDF 瀵煎嚭 Worker
 */
export function startPdfExportWorker(): void {
    if (isRunning) {
        console.log('[PdfExportWorker] Already running');
        return;
    }

    isRunning = true;
    console.log('[PdfExportWorker] Starting...');

    // 纭繚鐩綍瀛樺湪
    ensureExportsDir();

    // 鍚姩杞
    pollIntervalRef = setInterval(() => {
        if (isRunning) {
            pollAndProcess();
        }
    }, POLL_INTERVAL_MS);

    // 姣忓皬鏃舵竻鐞嗕竴娆¤繃鏈熸枃浠?
    cleanupIntervalRef = setInterval(() => {
        if (isRunning) {
            void cleanupExpiredFiles();
        }
    }, 60 * 60 * 1000);

    // 鍚姩鏃跺厛娓呯悊涓€娆?
    void cleanupExpiredFiles();

    console.log('[PdfExportWorker] Started. Polling every 5 seconds.');
}

/**
 * 鍋滄 PDF 瀵煎嚭 Worker
 */
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
    stopPdfExportWorker
};
