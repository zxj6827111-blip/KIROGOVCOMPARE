import express, { Response, Router } from 'express';
import type { Page, PDFOptions } from 'puppeteer';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
  findFrontendUrl as discoverFrontendUrl,
  renderPrintPage,
} from '../services/report-export/BrowserRenderer';
import {
  GOVINSIGHT_A4_PDF_OPTIONS,
  createGovInsightPrintPageAdapter,
} from '../services/report-export/PrintPageAdapter';

const router: Router = express.Router();
const PDF_EXPORT_HYDRATE_WAIT_MS = Number(process.env.PDF_EXPORT_HYDRATE_WAIT_MS || 1500);
const PDF_EXPORT_PRINT_READY_TIMEOUT_MS = Number(
  process.env.PDF_EXPORT_PRINT_READY_TIMEOUT_MS || 45000
);

function toReadablePdfExportError(error: any): string {
  const message = String(error?.message || error || 'Unknown error');
  if (/frontend service|ECONNREFUSED|ERR_CONNECTION_REFUSED|net::ERR/i.test(message)) {
    return 'PDF 生成失败：前端打印服务不可用，请确认前端服务已启动后重试';
  }
  if (/browser|puppeteer|chrome|chromium|executable|spawn/i.test(message)) {
    return 'PDF 生成失败：浏览器渲染组件不可用，请检查 Chrome/Puppeteer 环境';
  }
  return message;
}

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

function buildGovInsightPdfOptions(pageTitle: string): PDFOptions {
  const escapedHeaderTitle = escapeHtml(pageTitle.replace(/_/g, ' '));

  return {
    ...GOVINSIGHT_A4_PDF_OPTIONS,
    headerTemplate: `
      <div style="width:100%; padding:0 17mm; box-sizing:border-box; font-family:'Microsoft YaHei','SimHei',sans-serif; color:#b6beca; font-size:7.2pt;">
        <div style="display:flex; justify-content:space-between; gap:8mm; padding-bottom:1.5mm; border-bottom:0.18pt solid #eef2f7;">
          <span>${escapedHeaderTitle}</span>
          <span>内部审阅材料</span>
        </div>
      </div>
    `,
    footerTemplate: `
      <div style="width:100%; padding:0 17mm; box-sizing:border-box; font-family:'Microsoft YaHei','SimHei',sans-serif; color:#b6beca; font-size:7.2pt;">
        <div style="display:flex; justify-content:space-between; gap:8mm; padding-top:2.2mm; border-top:0.18pt solid #eef2f7;">
          <span>供内部研判参考，不作为正式考核结论</span>
          <span>第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span>
        </div>
      </div>
    `,
  };
}

async function findFrontendUrl(orgId: string, year: number): Promise<string | null> {
  return discoverFrontendUrl({
    logPrefix: 'GovInsight PDF',
    pathToCheck: `/print/govinsight-report/${encodeURIComponent(orgId)}/${year}`,
    ports: [3001, 3000, 3002, 3003],
    hosts: ['localhost', '127.0.0.1'],
    method: 'GET',
    requireReactRoot: true,
    warnOnRejectedCandidate: true,
  });
}

async function stabilizeGovInsightCharts(page: Page): Promise<void> {
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
}

async function computeGovInsightDomToc(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = globalThis as any;
    if (typeof win.__govinsightComputePdfToc === 'function') {
      win.__govinsightComputePdfToc();
    }
  });
}

async function readGovInsightTocChapters(page: Page): Promise<TocChapter[]> {
  return page.evaluate(() => {
    const doc = (globalThis as any).document as any;
    return Array.from(doc.querySelectorAll('[data-chapter-id]'))
      .map((node: any) => ({
        id: String(node.getAttribute('data-chapter-id') || ''),
        title: String(node.querySelector('.pdf-chapter-heading h2')?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim(),
      }))
      .filter((chapter: TocChapter) => chapter.id && chapter.title);
  });
}

async function applyResolvedGovInsightTocPages(
  page: Page,
  resolvedTocPages: Record<string, number>
): Promise<void> {
  if (Object.keys(resolvedTocPages).length === 0) return;

  await page.evaluate((tocPages: Record<string, number>) => {
    const doc = (globalThis as any).document as any;
    Object.entries(tocPages).forEach(([chapterId, pageNumber]) => {
      const pageNode = doc.querySelector(`[data-toc-page-for="${chapterId}"]`);
      if (pageNode) {
        pageNode.textContent = String(pageNumber);
      }
    });
  }, resolvedTocPages);
}

router.get('/report-pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
  const orgId = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';
  const yearNum = Number(req.query.year);
  const regionId = parseRegionId(orgId);

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

    const frontendUrl = await findFrontendUrl(orgId, yearNum);
    if (!frontendUrl) {
      throw new Error('Unable to find an available frontend service. Please start the local frontend first.');
    }

    const adapter = createGovInsightPrintPageAdapter({
      orgId,
      year: yearNum,
      hydrateWaitMs: PDF_EXPORT_HYDRATE_WAIT_MS,
      readyTimeoutMs: PDF_EXPORT_PRINT_READY_TIMEOUT_MS,
    });
    const bearerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.substring(7)
      : '';

    console.log(`[GovInsight PDF] Rendering ${frontendUrl} -> ${adapter.path}`);

    const rendered = await renderPrintPage({
      adapter,
      frontendUrl,
      bearerToken,
      logPrefix: 'GovInsight PDF',
    });

    try {
      const pageTitle = rendered.title || `${orgId}_${yearNum}_GovInsight_Report`;
      const pdfOptions = buildGovInsightPdfOptions(pageTitle);

      await computeGovInsightDomToc(rendered.page);
      await stabilizeGovInsightCharts(rendered.page);
      await computeGovInsightDomToc(rendered.page);

      const tocChapters = await readGovInsightTocChapters(rendered.page);
      const draftPdfBuffer = await rendered.pdf(pdfOptions);
      const draftPages = await extractPdfTextPages(draftPdfBuffer);
      const resolvedTocPages = resolveTocPagesFromPdfText(draftPages, tocChapters);
      await applyResolvedGovInsightTocPages(rendered.page, resolvedTocPages);

      const pdfBuffer = await rendered.pdf(pdfOptions);
      const nodeBuffer = Buffer.from(pdfBuffer);
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
      res.setHeader('Content-Length', nodeBuffer.length);
      res.end(nodeBuffer);
      console.log(`[GovInsight PDF] PDF generated successfully, size: ${nodeBuffer.length} bytes`);
    } finally {
      await rendered.close();
      console.log('[GovInsight PDF] Browser closed');
    }
  } catch (error: any) {
    console.error('[GovInsight PDF] Error generating PDF:', error);
    res.status(500).json({
      error: 'pdf_export_failed',
      message: toReadablePdfExportError(error),
    });
  }
});

export default router;
