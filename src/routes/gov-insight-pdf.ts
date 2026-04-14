import express, { Response, Router } from 'express';
import puppeteer, { Browser, ConsoleMessage } from 'puppeteer';
import http from 'http';
import https from 'https';
import fs from 'fs';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router: Router = express.Router();
const PDF_EXPORT_DEBUG = process.env.PDF_EXPORT_DEBUG === '1';
const PDF_EXPORT_HYDRATE_WAIT_MS = Number(process.env.PDF_EXPORT_HYDRATE_WAIT_MS || 1500);

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

  if (process.env.FRONTEND_URL) {
    const configuredUrl = process.env.FRONTEND_URL.trim();
    const isPlaceholder = configuredUrl.includes('your-domain.com');
    if (!isPlaceholder && (await isUrlAccessible(configuredUrl))) {
      return configuredUrl;
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

    await page.goto(frontendEntryUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    });

    await page.evaluate((path: string) => {
      const win = globalThis as any;
      if (win.location.pathname === path) return;
      win.history.pushState({}, '', path);
      win.dispatchEvent(new win.PopStateEvent('popstate'));
    }, printPath);

    await page.waitForFunction(
      (path: string) => {
        const win = globalThis as any;
        return win.location.pathname === path;
      },
      { timeout: 15000 },
      printPath
    );

    await page.waitForSelector('#govinsight-report-print', { timeout: 15000 });
    await page.evaluate('document.fonts ? document.fonts.ready : Promise.resolve()');

    if (PDF_EXPORT_HYDRATE_WAIT_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, PDF_EXPORT_HYDRATE_WAIT_MS));
    }

    await page.emulateMediaType('print');
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

    const pageTitle = (await page.title()) || `${orgId}_${yearNum}_智能辅策报告`;

    const pdfBuffer = await page.pdf({
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: {
        top: '10mm',
        bottom: '12mm',
        left: '8mm',
        right: '8mm',
      },
      displayHeaderFooter: false,
      preferCSSPageSize: true,
    });

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
