import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import puppeteer, {
  Browser,
  ConsoleMessage,
  type LaunchOptions,
  type PDFOptions,
  type Page,
} from 'puppeteer';
import {
  buildPrintPageUrl,
  normalizeFrontendUrl,
  type PrintPageAdapter,
} from './PrintPageAdapter';

const PDF_EXPORT_DEBUG = process.env.PDF_EXPORT_DEBUG === '1';
const DEFAULT_HYDRATE_WAIT_MS = Number(process.env.PDF_EXPORT_HYDRATE_WAIT_MS || 1500);
const DEFAULT_READY_TIMEOUT_MS = Number(process.env.PDF_EXPORT_PRINT_READY_TIMEOUT_MS || 45000);
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;
const FRONTEND_PLACEHOLDER_HOSTS = new Set([
  'your-domain.com',
  'www.your-domain.com',
  'example.com',
  'www.example.com',
]);

export interface FrontendDiscoveryOptions {
  logPrefix: string;
  pathToCheck?: string;
  envUrl?: string;
  ports?: number[];
  hosts?: string[];
  requireReactRoot?: boolean;
  warnOnRejectedCandidate?: boolean;
  ignorePlaceholder?: boolean;
  method?: 'GET' | 'HEAD';
}

export interface RenderPrintPageOptions {
  adapter: PrintPageAdapter;
  frontendUrl: string;
  serviceToken?: string;
  bearerToken?: string;
  logPrefix: string;
  executablePath?: string;
  launchOptions?: LaunchOptions;
  hooks?: {
    onBrowserStarted?: () => Promise<void> | void;
    onBeforeNavigate?: () => Promise<void> | void;
    onAfterNavigate?: () => Promise<void> | void;
    onReady?: () => Promise<void> | void;
  };
}

export interface RenderedPrintPage {
  browser: Browser;
  page: Page;
  title: string;
  url: string;
  redactedUrl: string;
  pdf: (options?: PDFOptions) => Promise<Uint8Array>;
  close: () => Promise<void>;
}

export interface RenderPdfBufferOptions extends RenderPrintPageOptions {
  pdfOptions?: PDFOptions;
}

export interface RenderPdfBufferResult {
  buffer: Buffer;
  title: string;
  url: string;
  redactedUrl: string;
}

export function isPlaceholderFrontendUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return FRONTEND_PLACEHOLDER_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return true;
  }
}

export function resolveBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getClient(urlObj: URL): typeof http | typeof https {
  return urlObj.protocol === 'https:' ? https : http;
}

async function fetchFrontendCandidate(
  url: string,
  pathToCheck: string,
  options: Pick<FrontendDiscoveryOptions, 'method' | 'requireReactRoot'>
): Promise<boolean> {
  return new Promise((resolve) => {
    let urlObj: URL;
    try {
      urlObj = new URL(pathToCheck || '/', normalizeFrontendUrl(url));
    } catch {
      resolve(false);
      return;
    }

    const client = getClient(urlObj);
    const request = client.request(
      {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: `${urlObj.pathname || '/'}${urlObj.search || ''}`,
        method: options.method || (options.requireReactRoot ? 'GET' : 'HEAD'),
        timeout: 3000,
      },
      (response) => {
        if (response.statusCode === undefined || response.statusCode >= 500) {
          response.resume();
          resolve(false);
          return;
        }

        if (!options.requireReactRoot) {
          response.resume();
          resolve(true);
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 20000) {
            request.destroy();
          }
        });
        response.on('end', () => {
          const looksLikeReactFrontend =
            body.includes('<div id="root"></div>') &&
            (body.includes('/static/js/') || body.includes('static/js/'));
          resolve(looksLikeReactFrontend);
        });
      }
    );

    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });

    request.end();
  });
}

export async function findFrontendUrl(
  options: FrontendDiscoveryOptions
): Promise<string | null> {
  const candidateUrls: string[] = [];

  const addCandidate = (url: string | undefined | null) => {
    const trimmed = url?.trim();
    if (!trimmed) return;
    const normalized = trimmed.replace(/\/+$/, '');
    if (!candidateUrls.includes(normalized)) {
      candidateUrls.push(normalized);
    }
  };

  const configuredUrl = options.envUrl === undefined ? process.env.FRONTEND_URL : options.envUrl;
  if (configuredUrl) {
    if (options.ignorePlaceholder !== false && isPlaceholderFrontendUrl(configuredUrl)) {
      console.warn(`[${options.logPrefix}] Ignoring placeholder FRONTEND_URL: ${configuredUrl}`);
    } else {
      addCandidate(configuredUrl);
    }
  }

  const ports = options.ports || [3001, 3000, 3002, 3003];
  const hosts = options.hosts || ['localhost'];
  hosts.forEach((host) => {
    ports.forEach((port) => addCandidate(`http://${host}:${port}`));
  });

  for (const url of candidateUrls) {
    const isAccessible = await fetchFrontendCandidate(url, options.pathToCheck || '/', options);
    if (isAccessible) {
      console.log(`[${options.logPrefix}] Found frontend at ${url}`);
      return url;
    }
    if (options.warnOnRejectedCandidate) {
      console.warn(`[${options.logPrefix}] Candidate is not the print frontend: ${url}`);
    } else if (PDF_EXPORT_DEBUG) {
      console.log(`[${options.logPrefix}] Frontend candidate unavailable: ${url}`);
    }
  }

  return null;
}

function getLaunchOptions(executablePath?: string, overrides?: LaunchOptions): LaunchOptions {
  return {
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=none',
    ],
    ...overrides,
  };
}

async function maybeDumpDiagnostics(
  page: Page,
  adapter: PrintPageAdapter,
  logPrefix: string
): Promise<void> {
  if (!PDF_EXPORT_DEBUG) return;

  const logsDir = path.join(__dirname, '..', '..', '..', 'logs');
  const fileSafeName = adapter.diagnosticName.replace(/[^a-z0-9_.-]+/gi, '_');
  const timestamp = Date.now();

  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  } catch (error) {
    console.warn(`[${logPrefix}] Could not create diagnostics directory:`, error);
    return;
  }

  const screenshotPath = path.join(logsDir, `pdf-debug-${fileSafeName}-${timestamp}.png`);
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`[${logPrefix}] Debug screenshot saved to: ${screenshotPath}`);
  } catch (error) {
    console.warn(`[${logPrefix}] Could not save debug screenshot:`, error);
  }

  try {
    const pageContent = await page.content();
    const htmlPath = path.join(logsDir, `pdf-debug-${fileSafeName}-${timestamp}.html`);
    fs.writeFileSync(htmlPath, pageContent, 'utf8');
    console.log(`[${logPrefix}] Debug HTML saved to: ${htmlPath}`);

    const probe = adapter.debugHtmlProbe;
    if (probe) {
      if (pageContent.includes(probe.requiredText)) {
        console.log(`[${logPrefix}] Found ${probe.requiredText} in HTML`);
      } else {
        console.log(`[${logPrefix}] ${probe.requiredText} NOT found in HTML`);
        console.log(
          `[${logPrefix}] First ${probe.previewChars || 2000} chars: ${pageContent.substring(
            0,
            probe.previewChars || 2000
          )}`
        );
      }
    }
  } catch (error) {
    console.warn(`[${logPrefix}] Could not save debug HTML:`, error);
  }
}

async function readSelectorText(page: Page, selector: string): Promise<string | null> {
  const element = await page.$(selector);
  if (!element) return null;
  return page.evaluate((node) => node?.textContent || '', element);
}

async function getPageState(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const win = globalThis as any;
    return {
      title: String(win.document?.title || ''),
      path: String(win.location?.pathname || ''),
      text: String(win.document?.body?.innerText || '').slice(0, 800),
    };
  });
}

async function waitForAdapterReady(
  page: Page,
  adapter: PrintPageAdapter,
  logPrefix: string
): Promise<void> {
  let readyOrFallbackAvailable = false;

  try {
    await page.waitForSelector(adapter.readySelector, {
      timeout: adapter.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS,
    });
    readyOrFallbackAvailable = true;
    console.log(`[${logPrefix}] Print page reported ready`);
  } catch (error) {
    console.warn(`[${logPrefix}] Print-ready marker not found, checking page state...`);

    for (const selectorConfig of adapter.errorSelectors || []) {
      const text = await readSelectorText(page, selectorConfig.selector);
      if (text && selectorConfig.fatal !== false) {
        throw new Error(`${selectorConfig.messagePrefix}: ${text}`);
      }
    }

    for (const selectorConfig of adapter.loadingSelectors || []) {
      const text = await readSelectorText(page, selectorConfig.selector);
      if (text && selectorConfig.fatal === true) {
        throw new Error(`${selectorConfig.messagePrefix}: ${text}`);
      }
      if (text) {
        console.warn(`[${logPrefix}] ${selectorConfig.messagePrefix}: ${text}`);
      }
    }

    if (adapter.fallbackSelector) {
      try {
        await page.waitForSelector(adapter.fallbackSelector, { timeout: 5000 });
        readyOrFallbackAvailable = true;
        console.warn(`[${logPrefix}] Print page did not become ready in time, proceeding with rendered content`);
      } catch {
        const state = await getPageState(page);
        console.error(`[${logPrefix}] Print page did not become ready:`, state);
        throw new Error(`Content failed to load - ${adapter.fallbackSelector} not found`);
      }
    }

    if (!readyOrFallbackAvailable) {
      const state = await getPageState(page);
      console.error(`[${logPrefix}] Print page did not become ready:`, state);
      throw error;
    }
  }

  if (adapter.readyPredicate) {
    await page.waitForFunction(adapter.readyPredicate.predicate, {
      timeout: adapter.readyPredicate.timeoutMs || adapter.readyTimeoutMs || DEFAULT_READY_TIMEOUT_MS,
    });
    console.log(`[${logPrefix}] ${adapter.readyPredicate.description}`);
  }
}

export async function renderPrintPage(
  options: RenderPrintPageOptions
): Promise<RenderedPrintPage> {
  const { adapter, frontendUrl, serviceToken, bearerToken, logPrefix } = options;
  const url = buildPrintPageUrl(adapter, frontendUrl, {
    includeSensitive: true,
    serviceToken,
  });
  const redactedUrl = buildPrintPageUrl(adapter, frontendUrl, {
    includeSensitive: false,
  });

  console.log(`[${logPrefix}] Navigating to ${redactedUrl} (service token redacted)`);

  const browser = await puppeteer.launch(
    getLaunchOptions(options.executablePath, options.launchOptions)
  );

  try {
    await options.hooks?.onBrowserStarted?.();
    const page = await browser.newPage();

    if (PDF_EXPORT_DEBUG) {
      page.on('console', (msg: ConsoleMessage) =>
        console.log(`[${logPrefix} Page] ${msg.type()}: ${msg.text()}`)
      );
    }
    page.on('pageerror', (error: unknown) =>
      console.error(`[${logPrefix} Page Error]`, String(error))
    );

    if (bearerToken && adapter.serviceTokenLocalStorageKey) {
      await page.evaluateOnNewDocument(
        (storageKey: string, token: string) => {
          const win = globalThis as any;
          win.localStorage?.setItem(storageKey, token);
        },
        adapter.serviceTokenLocalStorageKey,
        bearerToken
      );
    }

    await page.setViewport(adapter.viewport);
    await options.hooks?.onBeforeNavigate?.();
    await page.goto(url, {
      waitUntil: adapter.waitUntil || 'networkidle0',
      timeout: adapter.navigationTimeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS,
    });
    await options.hooks?.onAfterNavigate?.();

    if (adapter.waitForPath) {
      await page.waitForFunction(
        (expectedPath: string) => {
          const win = globalThis as any;
          return win.location.pathname === expectedPath;
        },
        { timeout: 15000 },
        adapter.waitForPath
      );
    }

    const hydrateWaitMs =
      adapter.hydrateWaitMs === undefined ? DEFAULT_HYDRATE_WAIT_MS : adapter.hydrateWaitMs;
    if (hydrateWaitMs > 0) {
      await sleep(hydrateWaitMs);
    }

    await maybeDumpDiagnostics(page, adapter, logPrefix);
    await waitForAdapterReady(page, adapter, logPrefix);

    await page.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()');
    console.log(`[${logPrefix}] Fonts reported ready`);

    if (adapter.emulateMediaType) {
      await page.emulateMediaType(adapter.emulateMediaType);
    }

    for (const content of adapter.styleTags || []) {
      await page.addStyleTag({ content });
    }

    if (adapter.postReadyDelayMs && adapter.postReadyDelayMs > 0) {
      await sleep(adapter.postReadyDelayMs);
    }
    await options.hooks?.onReady?.();

    const title = await page.title();
    let closed = false;

    return {
      browser,
      page,
      title,
      url,
      redactedUrl,
      pdf: (pdfOptions?: PDFOptions) => page.pdf(pdfOptions || adapter.pdfOptions),
      close: async () => {
        if (closed) return;
        closed = true;
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function renderPdfBuffer(
  options: RenderPdfBufferOptions
): Promise<RenderPdfBufferResult> {
  const rendered = await renderPrintPage(options);
  try {
    const pdfBuffer = await rendered.pdf(options.pdfOptions || options.adapter.pdfOptions);
    return {
      buffer: Buffer.from(pdfBuffer),
      title: rendered.title,
      url: rendered.url,
      redactedUrl: rendered.redactedUrl,
    };
  } finally {
    await rendered.close();
    console.log(`[${options.logPrefix}] Browser closed`);
  }
}
