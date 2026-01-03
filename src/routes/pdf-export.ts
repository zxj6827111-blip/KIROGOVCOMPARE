import express, { Request, Response, Router } from 'express';
import puppeteer from 'puppeteer';
import http from 'http';
import path from 'path';
import fs from 'fs';

const router: Router = express.Router();

/**
 * Check if a URL is accessible
 */
async function isUrlAccessible(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: 'HEAD',
            timeout: 2000
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
 * Find available frontend URL (check multiple ports)
 */
async function findFrontendUrl(): Promise<string | null> {
    // Check if explicitly set in env
    if (process.env.FRONTEND_URL) {
        return process.env.FRONTEND_URL;
    }

    // Try common React dev server ports
    const portsToCheck = [3000, 3001, 3002, 3003];

    for (const port of portsToCheck) {
        const url = `http://localhost:${port}`;
        console.log(`[PDF Export] Checking frontend at ${url}...`);
        const accessible = await isUrlAccessible(url);
        if (accessible) {
            console.log(`[PDF Export] Found frontend at ${url}`);
            return url;
        }
    }

    return null;
}

/**
 * GET /api/comparisons/:id/pdf
 * 使用 Puppeteer 生成比对报告的 PDF
 */
router.get('/:id/pdf', async (req: Request, res: Response) => {
    const { id } = req.params;

    let browser = null;

    try {
        console.log(`[PDF Export] Starting PDF generation for comparison ${id}`);

        // Find available frontend
        const frontendUrl = await findFrontendUrl();

        if (!frontendUrl) {
            throw new Error('无法找到可用的前端服务。请确保前端开发服务器正在运行。');
        }

        // Forward highlight settings from query params to print page
        const highlightIdentical = req.query.highlightIdentical === 'true';
        const highlightDiff = req.query.highlightDiff === 'true';
        const printParams = new URLSearchParams({
            highlightIdentical: highlightIdentical.toString(),
            highlightDiff: highlightDiff.toString()
        });
        const printUrl = `${frontendUrl}/print/comparison/${id}?${printParams}`;
        console.log(`[PDF Export] Accessing print URL: ${printUrl}`);

        // 启动无头浏览器
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

        const page = await browser.newPage();

        // Enable console logging from page
        page.on('console', msg => console.log(`[PDF Page Console] ${msg.type()}: ${msg.text()}`));
        page.on('pageerror', (error) => console.error(`[PDF Page Error]`, String(error)));

        // 设置视口大小 (横向布局，更宽以适应表格)
        await page.setViewport({
            width: 1600,
            height: 900,
            deviceScaleFactor: 2
        });

        // 访问打印页面
        console.log(`[PDF Export] Navigating to print page...`);
        await page.goto(printUrl, {
            waitUntil: 'networkidle0',
            timeout: 60000
        });

        // Add extra wait for React to hydrate
        console.log(`[PDF Export] Waiting for React to render...`);
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Take a screenshot for debugging
        const screenshotPath = path.join(__dirname, '..', '..', 'logs', `pdf-debug-${id}-${Date.now()}.png`);
        try {
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`[PDF Export] Debug screenshot saved to: ${screenshotPath}`);
        } catch (e) {
            console.log(`[PDF Export] Could not save screenshot:`, e);
        }

        // Get page content for debugging
        const pageContent = await page.content();
        console.log(`[PDF Export] Page content length: ${pageContent.length}`);
        if (pageContent.includes('comparison-content')) {
            console.log(`[PDF Export] Found comparison-content in HTML`);
        } else {
            console.log(`[PDF Export] comparison-content NOT found in HTML`);
            console.log(`[PDF Export] First 2000 chars: ${pageContent.substring(0, 2000)}`);
        }

        // Try to wait for content, but with fallback
        let hasContent = false;
        try {
            await page.waitForSelector('#comparison-content', { timeout: 10000 });
            hasContent = true;
            console.log(`[PDF Export] Found #comparison-content element`);
        } catch (e) {
            console.log(`[PDF Export] #comparison-content not found, checking for error state...`);
            // Check if there's an error message
            const errorElement = await page.$('.text-red-500');
            if (errorElement) {
                const errorText = await page.evaluate(el => el?.textContent, errorElement);
                throw new Error(`Print page error: ${errorText}`);
            }
            // Check if still loading
            const loadingElement = await page.$('.text-gray-500');
            if (loadingElement) {
                const loadingText = await page.evaluate(el => el?.textContent, loadingElement);
                throw new Error(`Page still loading: ${loadingText}`);
            }
            throw new Error('Content failed to load - #comparison-content not found');
        }

        // 获取页面标题用于文件名
        const pageTitle = await page.title();

        console.log(`[PDF Export] Generating PDF...`);

        // 生成 PDF (横向A4布局，更适合表格展示)
        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: {
                top: '10mm',
                bottom: '10mm',
                left: '10mm',
                right: '10mm'
            },
            displayHeaderFooter: false,
            preferCSSPageSize: false
        });

        console.log(`[PDF Export] PDF generated successfully, size: ${pdfBuffer.length} bytes`);

        // 设置CORS响应头 (确保浏览器可以访问二进制响应)
        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        } else {
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Type');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // 设置响应头
        const filename = encodeURIComponent(pageTitle || `比对报告_${id}`) + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${filename}`);

        // Puppeteer returns Uint8Array - convert to Node.js Buffer for proper binary transmission
        const nodeBuffer = Buffer.from(pdfBuffer);
        res.setHeader('Content-Length', nodeBuffer.length);

        // 发送 PDF as raw binary using res.end() to avoid JSON serialization
        res.end(nodeBuffer);

    } catch (error: any) {
        console.error(`[PDF Export] Error generating PDF:`, error);
        res.status(500).json({
            error: 'PDF 生成失败',
            message: error.message || 'Unknown error'
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log(`[PDF Export] Browser closed`);
        }
    }
});

export default router;
