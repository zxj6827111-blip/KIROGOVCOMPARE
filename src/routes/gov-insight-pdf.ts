import express, { Response, Router } from 'express';
import puppeteer, { Browser, ConsoleMessage, type PDFOptions } from 'puppeteer';
import http from 'http';
import https from 'https';
import fs from 'fs';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router: Router = express.Router();
const PDF_EXPORT_DEBUG = process.env.PDF_EXPORT_DEBUG === '1';
const PDF_EXPORT_HYDRATE_WAIT_MS = Number(process.env.PDF_EXPORT_HYDRATE_WAIT_MS || 1500);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
};

type TocChapter = {
  id: string;
  title: string;
};

let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => mod.default || mod);
  }
  return pdfjsPromise;
}

const normalizeTocText = (value: string): string => String(value || '').replace(/\s+/g, '');

async function extractPdfTextPages(pdfBuffer: Uint8Array): Promise<string[]> {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdfDocument = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      const textContent = await pdfPage.getTextContent();
      pages.push(
        textContent.items
          .map((item: any) => String(item?.str || ''))
          .filter(Boolean)
          .join(' ')
      );
    }
  } finally {
    await pdfDocument.destroy?.();
  }

  return pages;
}

function resolveTocPagesFromPdfText(pages: string[], chapters: TocChapter[]): Record<string, number> {
  const normalizedPages = pages.map(normalizeTocText);
  const result: Record<string, number> = {};

  chapters.forEach((chapter) => {
    const token = normalizeTocText(chapter.title);
    if (!chapter.id || token.length < 2) return;

    for (let pageIndex = 3; pageIndex < normalizedPages.length; pageIndex += 1) {
      if (normalizedPages[pageIndex].includes(token)) {
        result[chapter.id] = pageIndex + 1;
        return;
      }
    }
  });

  return result;
}

const parseRegionId = (orgId: unknown): number | null => {
  if (typeof orgId === 'number' && Number.isFinite(orgId)) {
    return orgId;
  }

  if (typeof orgId === 'string') {
    const match = orgId.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }

  return null;
};

async function isUrlAccessible(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
      method: 'HEAD',
      timeout: 2000,
    };

    const req = client.request(options, (response) => {
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function findFrontendUrl(): Promise<string | null> {
  if (process.env.FRONTEND_URL) {
    const configuredUrl = process.env.FRONTEND_URL.trim();
    const isPlaceholder = configuredUrl.includes('your-domain.com');
    if (!isPlaceholder && (await isUrlAccessible(configuredUrl))) {
      return configuredUrl;
    }
  }

  const portsToCheck = [3000, 3001, 3002, 3003];
  const hostsToCheck = ['127.0.0.1', 'localhost'];

  for (const host of hostsToCheck) {
    for (const port of portsToCheck) {
      const url = `http://${host}:${port}`;
      const accessible = await isUrlAccessible(url);
      if (accessible) {
        return url;
      }
    }
  }

  return null;
}

function resolveBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

router.get('/report-pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orgId = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';
  const yearNum = Number(req.query.year);
  const regionId = parseRegionId(orgId);
  let browser: Browser | null = null;

  try {
    if (!req.user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    if (!orgId || !regionId || !Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return res.status(400).json({ error: 'invalid_org_or_year' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (
      allowedRegionIds &&
      (allowedRegionIds.length === 0 || !allowedRegionIds.includes(regionId))
    ) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const statsExists = await pool.query(
      `
      SELECT 1
      FROM gov_open_annual_stats
      WHERE split_part(org_id, '_', 2) = $1 AND year = $2
      LIMIT 1
      `,
      [String(regionId), yearNum]
    );

    if (statsExists.rows.length === 0) {
      return res.status(404).json({ error: 'report_data_not_found' });
    }

    const frontendUrl = await findFrontendUrl();
    if (!frontendUrl) {
      throw new Error('无法找到可用的前端服务，请先启动本地前端。');
    }

    const frontendEntryUrl = frontendUrl.endsWith('/') ? frontendUrl : `${frontendUrl}/`;
    const printPath = `/print/govinsight-report/${encodeURIComponent(orgId)}/${yearNum}`;
    console.log(`[GovInsight PDF] Rendering ${frontendEntryUrl} -> ${printPath}`);

    const executablePath = resolveBrowserExecutable();
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });

    const page = await browser.newPage();

    if (PDF_EXPORT_DEBUG) {
      page.on('console', (msg: ConsoleMessage) =>
        console.log(`[GovInsight PDF Page] ${msg.type()}: ${msg.text()}`)
      );
    }
    page.on('pageerror', (error: unknown) =>
      console.error('[GovInsight PDF Page Error]', String(error))
    );

    await page.setViewport({
      width: 1440,
      height: 2200,
      deviceScaleFactor: 2,
    });

    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : '';

    if (bearerToken) {
      await page.evaluateOnNewDocument((token: string) => {
        const win = globalThis as any;
        win.localStorage?.setItem('admin_token', token);
      }, bearerToken);
    }

    const printUrl = new URL(printPath, frontendEntryUrl).toString();
    await page.goto(printUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await page.waitForFunction(
      (path: string) => {
        const win = globalThis as any;
        return win.location.pathname === path;
      },
      { timeout: 15000 },
      printPath
    );

    try {
      await page.waitForSelector('#govinsight-report-print', { timeout: 30000 });
    } catch (waitError) {
      const pageState = await page.evaluate(() => {
        const win = globalThis as any;
        return {
          title: win.document.title,
          path: win.location.pathname,
          text: String(win.document.body?.innerText || '').slice(0, 800),
        };
      });
      console.error('[GovInsight PDF] Print page did not become ready:', pageState);
      throw waitError;
    }
    await page.evaluate('document.fonts ? document.fonts.ready : Promise.resolve()');
    await page.waitForFunction(
      () => {
        const win = globalThis as any;
        return win.document.documentElement.getAttribute('data-govinsight-pdf-ready') === 'true';
      },
      { timeout: 15000 }
    );

    if (PDF_EXPORT_HYDRATE_WAIT_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, PDF_EXPORT_HYDRATE_WAIT_MS));
    }

    await page.emulateMediaType('print');
    await page.addStyleTag({
      content: `
        @page {
          size: A4;
          margin: 20mm 0 17mm 0;
        }
        @media print {
          @page {
            size: A4;
            margin: 20mm 0 17mm 0;
          }
        }
      `,
    });
    await page.evaluate(() => {
      const win = globalThis as any;
      if (typeof win.__govinsightComputePdfToc === 'function') {
        win.__govinsightComputePdfToc();
      }
    });
    await page.evaluate(async () => {
      const win = globalThis as any;
      const doc = win.document as any;
      const stabilizeCharts = () => {
        Array.from(doc.querySelectorAll('.recharts-responsive-container')).forEach((container: any) => {
          const rect = container.getBoundingClientRect();
          const width = Math.max(1, Math.floor(rect.width));
          const height = Math.max(1, Math.floor(rect.height));
          const wrapper = container.querySelector('.recharts-wrapper');

          if (wrapper) {
            wrapper.style.setProperty('width', `${width}px`, 'important');
            wrapper.style.setProperty('min-width', `${width}px`, 'important');
            wrapper.style.setProperty('max-width', `${width}px`, 'important');
            wrapper.style.setProperty('height', `${height}px`, 'important');
            wrapper.style.setProperty('display', 'inline-block', 'important');
          }

          Array.from(container.querySelectorAll('svg.recharts-surface')).forEach((surface: any) => {
            if (surface.getAttribute('aria-label')) return;

            surface.style.setProperty('width', `${width}px`, 'important');
            surface.style.setProperty('min-width', `${width}px`, 'important');
            surface.style.setProperty('max-width', `${width}px`, 'important');
            surface.style.setProperty('height', `${height}px`, 'important');
            surface.setAttribute('width', `${width}`);
            surface.setAttribute('height', `${height}`);
          });
        });
      };

      stabilizeCharts();
      win.dispatchEvent(new win.Event('resize'));
      await new Promise((resolve) => win.setTimeout(resolve, 120));
      stabilizeCharts();
      await new Promise((resolve) => win.setTimeout(resolve, 120));
      stabilizeCharts();
    });
    await page.evaluate(() => {
      const win = globalThis as any;
      if (typeof win.__govinsightComputePdfToc === 'function') {
        win.__govinsightComputePdfToc();
      }
    });

    const pageTitle = (await page.title()) || `${orgId}_${yearNum}_智能辅策报告`;
    const escapedHeaderTitle = escapeHtml(pageTitle.replace(/_/g, ' '));
    const tocChapters = await page.evaluate(() => {
      const win = globalThis as any;
      const doc = win.document as any;
      return Array.from(doc.querySelectorAll('[data-chapter-id]'))
        .map((node: any) => ({
          id: String(node.getAttribute('data-chapter-id') || ''),
          title: String(node.querySelector('.pdf-chapter-heading h2')?.textContent || '')
            .replace(/\s+/g, ' ')
            .trim(),
        }))
        .filter((chapter: TocChapter) => chapter.id && chapter.title);
    });

    const headerTemplate = `
      <div style="width:100%; padding:0 17mm; box-sizing:border-box; font-family:'Microsoft YaHei','SimHei',sans-serif; color:#b6beca; font-size:7.2pt;">
        <div style="display:flex; justify-content:space-between; gap:8mm; padding-bottom:1.5mm; border-bottom:0.18pt solid #eef2f7;">
          <span>${escapedHeaderTitle}</span>
          <span>内部审阅材料</span>
        </div>
      </div>
    `;
    const footerTemplate = `
      <div style="width:100%; padding:0 17mm; box-sizing:border-box; font-family:'Microsoft YaHei','SimHei',sans-serif; color:#b6beca; font-size:7.2pt;">
        <div style="display:flex; justify-content:space-between; gap:8mm; padding-top:2.2mm; border-top:0.18pt solid #eef2f7;">
          <span>供内部研判参考，不作为正式考核结论</span>
          <span>第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span>
        </div>
      </div>
    `;

    const pdfOptions: PDFOptions = {
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: {
        top: '20mm',
        bottom: '17mm',
        left: '17mm',
        right: '17mm',
      },
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      preferCSSPageSize: false,
    };

    const draftPdfBuffer = await page.pdf(pdfOptions);
    const draftPages = await extractPdfTextPages(draftPdfBuffer);
    const resolvedTocPages = resolveTocPagesFromPdfText(draftPages, tocChapters);

    if (Object.keys(resolvedTocPages).length > 0) {
      await page.evaluate((tocPages: Record<string, number>) => {
        const win = globalThis as any;
        const doc = win.document as any;
        Object.entries(tocPages).forEach(([chapterId, pageNumber]) => {
          const pageNode = doc.querySelector(`[data-toc-page-for="${chapterId}"]`);
          if (pageNode) {
            pageNode.textContent = String(pageNumber);
          }
        });
      }, resolvedTocPages);
    }

    const pdfBuffer = await page.pdf(pdfOptions);

    const fileName = encodeURIComponent(pageTitle) + '.pdf';
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Disposition, Content-Length, Content-Type'
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`
    );

    const nodeBuffer = Buffer.from(pdfBuffer);
    res.setHeader('Content-Length', nodeBuffer.length);
    res.end(nodeBuffer);
  } catch (error: any) {
    console.error('[GovInsight PDF] Error generating PDF:', error);
    res.status(500).json({
      error: 'pdf_export_failed',
      message: error?.message || 'Unknown error',
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

export default router;
