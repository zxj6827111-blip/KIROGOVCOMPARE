import type { PDFOptions, PuppeteerLifeCycleEvent, Viewport } from 'puppeteer';

export interface PageStateSelector {
  selector: string;
  messagePrefix: string;
  fatal?: boolean;
}

export interface PageReadyPredicate {
  description: string;
  timeoutMs?: number;
  predicate: () => boolean;
}

export interface PrintPageAdapter {
  kind: string;
  diagnosticName: string;
  logLabel: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  serviceTokenQueryParam?: string;
  serviceTokenLocalStorageKey?: string;
  readySelector: string;
  readyPredicate?: PageReadyPredicate;
  fallbackSelector?: string;
  errorSelectors?: PageStateSelector[];
  loadingSelectors?: PageStateSelector[];
  viewport: Viewport;
  waitUntil?: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[];
  navigationTimeoutMs?: number;
  readyTimeoutMs?: number;
  hydrateWaitMs?: number;
  postReadyDelayMs?: number;
  emulateMediaType?: 'screen' | 'print';
  styleTags?: string[];
  pdfOptions: PDFOptions;
  debugHtmlProbe?: {
    requiredText: string;
    previewChars?: number;
  };
  waitForPath?: string;
}

export interface BuildPrintUrlOptions {
  includeSensitive?: boolean;
  serviceToken?: string;
}

export const COMPARISON_PRINT_READY_SELECTOR = '#comparison-content[data-print-ready="true"]';
export const GOVINSIGHT_PRINT_READY_SELECTOR = '#govinsight-report-print';

export const GOVINSIGHT_A4_PRINT_CSS = `
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
`;

export const GOVINSIGHT_A4_PDF_OPTIONS: PDFOptions = {
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
  preferCSSPageSize: false,
};

export const COMPARISON_LANDSCAPE_PRINT_CSS = `
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

export const COMPARISON_LANDSCAPE_PDF_OPTIONS: PDFOptions = {
  width: '297mm',
  height: '210mm',
  printBackground: true,
  margin: {
    top: '10mm',
    right: '10mm',
    bottom: '10mm',
    left: '10mm',
  },
  displayHeaderFooter: false,
  preferCSSPageSize: false,
};

export function normalizeFrontendUrl(frontendUrl: string): string {
  return frontendUrl.endsWith('/') ? frontendUrl : `${frontendUrl}/`;
}

export function buildPrintPageUrl(
  adapter: PrintPageAdapter,
  frontendUrl: string,
  options: BuildPrintUrlOptions = {}
): string {
  const url = new URL(adapter.path, normalizeFrontendUrl(frontendUrl));

  Object.entries(adapter.query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, String(value));
  });

  if (
    options.includeSensitive &&
    options.serviceToken &&
    adapter.serviceTokenQueryParam
  ) {
    url.searchParams.set(adapter.serviceTokenQueryParam, options.serviceToken);
  }

  return url.toString();
}

export interface ComparisonPrintPageAdapterOptions {
  comparisonId: number;
  highlightIdentical?: boolean;
  highlightDiff?: boolean;
  viewportDeviceScaleFactor?: number;
  hydrateWaitMs?: number;
  readyTimeoutMs?: number;
  emulateMediaType?: 'screen' | 'print';
  styleTags?: string[];
  pdfOptions?: PDFOptions;
  loadingSelectorFatal?: boolean;
}

export function createComparisonPrintPageAdapter(
  options: ComparisonPrintPageAdapterOptions
): PrintPageAdapter {
  const query: PrintPageAdapter['query'] = {};
  if (options.highlightIdentical !== undefined) {
    query.highlightIdentical = options.highlightIdentical;
  }
  if (options.highlightDiff !== undefined) {
    query.highlightDiff = options.highlightDiff;
  }

  return {
    kind: 'comparison',
    diagnosticName: `comparison-${options.comparisonId}`,
    logLabel: `comparison ${options.comparisonId}`,
    path: `/print/comparison/${options.comparisonId}`,
    query,
    serviceTokenQueryParam: 'service_token',
    readySelector: COMPARISON_PRINT_READY_SELECTOR,
    fallbackSelector: '#comparison-content',
    errorSelectors: [
      {
        selector: '.text-red-500',
        messagePrefix: 'Print page error',
        fatal: true,
      },
    ],
    loadingSelectors: [
      {
        selector: '.text-gray-500',
        messagePrefix: 'Page still loading',
        fatal: options.loadingSelectorFatal === true,
      },
    ],
    viewport: {
      width: 1600,
      height: 900,
      deviceScaleFactor: options.viewportDeviceScaleFactor || 1,
    },
    waitUntil: 'networkidle0',
    navigationTimeoutMs: 60000,
    readyTimeoutMs: options.readyTimeoutMs,
    hydrateWaitMs: options.hydrateWaitMs,
    postReadyDelayMs: 500,
    emulateMediaType: options.emulateMediaType,
    styleTags: options.styleTags || [],
    pdfOptions: options.pdfOptions || COMPARISON_LANDSCAPE_PDF_OPTIONS,
    debugHtmlProbe: {
      requiredText: 'comparison-content',
      previewChars: 2000,
    },
  };
}

export interface GovInsightPrintPageAdapterOptions {
  orgId: string;
  year: number;
  hydrateWaitMs?: number;
  readyTimeoutMs?: number;
  pdfOptions?: PDFOptions;
}

export function createGovInsightPrintPageAdapter(
  options: GovInsightPrintPageAdapterOptions
): PrintPageAdapter {
  const path = `/print/govinsight-report/${encodeURIComponent(options.orgId)}/${options.year}`;

  return {
    kind: 'govinsight',
    diagnosticName: `govinsight-${options.orgId}-${options.year}`,
    logLabel: `GovInsight report ${options.orgId}/${options.year}`,
    path,
    serviceTokenLocalStorageKey: 'admin_token',
    readySelector: GOVINSIGHT_PRINT_READY_SELECTOR,
    readyPredicate: {
      description: 'GovInsight PDF ready marker reported true',
      timeoutMs: 15000,
      predicate: () => {
        const win = globalThis as any;
        return win.document?.documentElement?.getAttribute('data-govinsight-pdf-ready') === 'true';
      },
    },
    fallbackSelector: GOVINSIGHT_PRINT_READY_SELECTOR,
    viewport: {
      width: 1440,
      height: 2200,
      deviceScaleFactor: 2,
    },
    waitUntil: 'networkidle0',
    navigationTimeoutMs: 60000,
    readyTimeoutMs: options.readyTimeoutMs || 30000,
    hydrateWaitMs: options.hydrateWaitMs,
    emulateMediaType: 'print',
    styleTags: [GOVINSIGHT_A4_PRINT_CSS],
    waitForPath: path,
    pdfOptions: options.pdfOptions || GOVINSIGHT_A4_PDF_OPTIONS,
    debugHtmlProbe: {
      requiredText: 'govinsight-report-print',
      previewChars: 2000,
    },
  };
}
