import puppeteer from 'puppeteer';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { ensureSqliteMigrations, querySqlite, executeSqlite, sqlValue, DATA_DIR } from '../config/sqlite';
import { generateExpiringToken } from '../middleware/auth';

// PDF 导出文件存储目录
const PDF_EXPORTS_DIR = path.join(DATA_DIR, 'exports', 'pdf');

// 文件过期时间（7天，单位：毫秒）
const FILE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_TOKEN_TTL_MS = 5 * 60 * 1000;
const SERVICE_TOKEN_USER_ID = Number(process.env.PDF_EXPORT_SERVICE_USER_ID || 1);
const SERVICE_TOKEN_USERNAME = process.env.PDF_EXPORT_SERVICE_USERNAME || 'pdf-export-worker';

// Worker 轮询间隔（5秒）
const POLL_INTERVAL_MS = 5000;

// 是否正在处理任务
let isProcessing = false;

// Worker 是否启动
let isRunning = false;

/**
 * 确保导出目录存在
 */
function ensureExportsDir(): void {
    if (!fs.existsSync(PDF_EXPORTS_DIR)) {
        fs.mkdirSync(PDF_EXPORTS_DIR, { recursive: true });
    }
}

/**
 * 检查 URL 是否可访问
 */
function isUrlAccessible(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: '/',
            method: 'HEAD',
            timeout: 3000
        };

        const req = http.request(options, (res) => {
            resolve(res.statusCode !== undefined && res.statusCode < 500);
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
 * 查找可用的前端 URL
 */
async function findFrontendUrl(): Promise<string | null> {
    // 优先使用环境变量
    if (process.env.FRONTEND_URL) {
        const isAccessible = await isUrlAccessible(process.env.FRONTEND_URL);
        if (isAccessible) {
            return process.env.FRONTEND_URL;
        }
    }

    // 检查常用端口
    const portsToCheck = [3001, 3002, 3000, 3003];
    for (const port of portsToCheck) {
        const url = `http://localhost:${port}`;
        const isAccessible = await isUrlAccessible(url);
        if (isAccessible) {
            console.log(`[PdfExportWorker] Found frontend at ${url}`);
            return url;
        }
    }

    return null;
}

/**
 * 处理单个 PDF 导出任务
 */
async function processJob(job: {
    id: number;
    comparison_id: number;
    export_title: string;
    file_name: string;
}): Promise<void> {
    console.log(`[PdfExportWorker] Processing job ${job.id} for comparison ${job.comparison_id}`);

    let browser = null;

    try {
        // 更新状态为 running
        executeSqlite(`
      UPDATE jobs SET 
        status = 'running',
        step_code = 'RENDERING',
        step_name = '正在渲染 PDF',
        progress = 10,
        started_at = datetime('now')
      WHERE id = ${sqlValue(job.id)};
    `);

        // 查找前端 URL
        const frontendUrl = await findFrontendUrl();
        if (!frontendUrl) {
            throw new Error('无法找到可用的前端服务');
        }

        // 启动 Puppeteer
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

        executeSqlite(`
      UPDATE jobs SET progress = 20, step_name = '浏览器已启动'
      WHERE id = ${sqlValue(job.id)};
    `);

        const page = await browser.newPage();

        // 设置视口
        await page.setViewport({
            width: 1600,
            height: 900,
            deviceScaleFactor: 1
        });

        // 导航到打印页面
        const serviceToken = generateExpiringToken(
            Number.isFinite(SERVICE_TOKEN_USER_ID) && SERVICE_TOKEN_USER_ID > 0 ? SERVICE_TOKEN_USER_ID : 1,
            SERVICE_TOKEN_USERNAME,
            SERVICE_TOKEN_TTL_MS
        );
        const printParams = new URLSearchParams({ service_token: serviceToken });
        const printUrl = `${frontendUrl}/print/comparison/${job.comparison_id}?${printParams}`;
        const logUrl = `${frontendUrl}/print/comparison/${job.comparison_id}`;
        console.log(`[PdfExportWorker] Navigating to ${logUrl} (service token redacted)`);

        executeSqlite(`
      UPDATE jobs SET progress = 30, step_name = '正在加载页面'
      WHERE id = ${sqlValue(job.id)};
    `);

        await page.goto(printUrl, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // 等待内容加载
        executeSqlite(`
      UPDATE jobs SET progress = 50, step_name = '等待内容渲染'
      WHERE id = ${sqlValue(job.id)};
    `);

        try {
            await page.waitForSelector('#comparison-content', { timeout: 30000 });
        } catch (e) {
            console.warn('[PdfExportWorker] Timeout waiting for #comparison-content, proceeding anyway');
        }

        // 额外等待确保样式加载
        await new Promise(resolve => setTimeout(resolve, 2000));

        executeSqlite(`
      UPDATE jobs SET progress = 70, step_name = '正在生成 PDF'
      WHERE id = ${sqlValue(job.id)};
    `);

        // 生成 PDF
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: {
                top: '10mm',
                right: '10mm',
                bottom: '10mm',
                left: '10mm'
            }
        });

        // 保存文件
        ensureExportsDir();
        const filePath = path.join(PDF_EXPORTS_DIR, job.file_name);
        fs.writeFileSync(filePath, pdfBuffer);
        const fileSize = pdfBuffer.length;

        console.log(`[PdfExportWorker] PDF saved to ${filePath} (${fileSize} bytes)`);

        // 更新任务状态为完成
        executeSqlite(`
      UPDATE jobs SET 
        status = 'done',
        step_code = 'DONE',
        step_name = '已完成',
        progress = 100,
        file_path = ${sqlValue(filePath)},
        file_size = ${sqlValue(fileSize)},
        finished_at = datetime('now')
      WHERE id = ${sqlValue(job.id)};
    `);

        console.log(`[PdfExportWorker] Job ${job.id} completed successfully`);

    } catch (error: any) {
        console.error(`[PdfExportWorker] Job ${job.id} failed:`, error);

        // 更新任务状态为失败
        executeSqlite(`
      UPDATE jobs SET 
        status = 'failed',
        step_code = 'ERROR',
        step_name = '生成失败',
        progress = 0,
        error_message = ${sqlValue(error.message || 'Unknown error')},
        finished_at = datetime('now')
      WHERE id = ${sqlValue(job.id)};
    `);

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

/**
 * 清理过期文件
 */
function cleanupExpiredFiles(): void {
    try {
        ensureSqliteMigrations();

        const now = Date.now();

        // 获取已完成且文件存在的任务
        const jobs = querySqlite(`
      SELECT id, file_path, finished_at FROM jobs 
      WHERE kind = 'pdf_export' AND status = 'done' AND file_path IS NOT NULL;
    `) as Array<{ id: number; file_path: string; finished_at: string }>;

        for (const job of jobs) {
            if (!job.finished_at) continue;

            const finishedTime = new Date(job.finished_at).getTime();
            const age = now - finishedTime;

            if (age > FILE_EXPIRY_MS) {
                // 文件已过期
                if (fs.existsSync(job.file_path)) {
                    try {
                        fs.unlinkSync(job.file_path);
                        console.log(`[PdfExportWorker] Cleaned up expired file: ${job.file_path}`);
                    } catch (e) {
                        console.warn(`[PdfExportWorker] Failed to delete expired file: ${job.file_path}`);
                    }
                }

                // 清除文件路径（保留任务记录）
                executeSqlite(`
          UPDATE jobs SET file_path = NULL, file_size = NULL 
          WHERE id = ${sqlValue(job.id)};
        `);
            }
        }
    } catch (error) {
        console.error('[PdfExportWorker] Cleanup error:', error);
    }
}

/**
 * 轮询并处理队列中的任务
 */
async function pollAndProcess(): Promise<void> {
    if (isProcessing) {
        return; // 已有任务在处理中
    }

    try {
        ensureSqliteMigrations();

        // 获取下一个待处理任务
        const rows = querySqlite(`
      SELECT id, comparison_id, export_title, file_name 
      FROM jobs 
      WHERE kind = 'pdf_export' AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 1;
    `) as Array<{
            id: number;
            comparison_id: number;
            export_title: string;
            file_name: string;
        }>;

        if (rows.length === 0) {
            return; // 没有待处理任务
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
 * 启动 PDF 导出 Worker
 */
export function startPdfExportWorker(): void {
    if (isRunning) {
        console.log('[PdfExportWorker] Already running');
        return;
    }

    isRunning = true;
    console.log('[PdfExportWorker] Starting...');

    // 确保目录存在
    ensureExportsDir();

    // 启动轮询
    const pollInterval = setInterval(() => {
        if (isRunning) {
            pollAndProcess();
        }
    }, POLL_INTERVAL_MS);

    // 每小时清理一次过期文件
    const cleanupInterval = setInterval(() => {
        if (isRunning) {
            cleanupExpiredFiles();
        }
    }, 60 * 60 * 1000);

    // 启动时先清理一次
    cleanupExpiredFiles();

    console.log('[PdfExportWorker] Started. Polling every 5 seconds.');
}

/**
 * 停止 PDF 导出 Worker
 */
export function stopPdfExportWorker(): void {
    isRunning = false;
    console.log('[PdfExportWorker] Stopped');
}

export default {
    startPdfExportWorker,
    stopPdfExportWorker
};
