#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_COMPARISON_IDS = [4670, 1143];
const DEFAULT_GOVINSIGHT = { orgId: 'city_721', year: 2025 };
const DEFAULT_TIMEOUT_MS = 120000;

const COMPARISON_SAMPLES = new Map([
  [
    4670,
    {
      kind: 'comparison-standard',
      label: 'ordinary comparison PDF',
      requiredText: [
        '淮安市',
        '2024',
        '2025',
        '政府信息公开',
        '总体情况',
        '主动公开政府信息情况',
        '收到和处理政府信息公开申请情况',
      ],
      minPages: 1,
    },
  ],
  [
    1143,
    {
      kind: 'comparison-long-table',
      label: 'long-table comparison PDF',
      requiredText: [
        '清江浦区',
        '2024',
        '2025',
        '政府信息公开',
        '收到和处理政府信息公开申请情况',
        '数据勾稽问题清单',
      ],
      minPages: 10,
      longTable: true,
    },
  ],
]);

const GOVINSIGHT_REQUIRED_TEXT = [
  '政务公开智能辅策报告',
  '目录',
  '总体判断',
  '重点风险事项',
  '确认事实',
  '审慎分析',
  '整改任务清单',
  '指标审计与勾稽校验',
  '建议补充数据',
];

const GOVINSIGHT_TOC_TITLES = [
  '总体判断',
  '重点风险事项',
  '确认事实',
  '审慎分析',
  '待补充问题',
  '整改任务清单',
  '结语',
  '指标审计与勾稽校验',
  '使用边界与口径说明',
  '建议补充数据',
];

function parseArgs(argv) {
  const args = {
    comparisonIds: DEFAULT_COMPARISON_IDS,
    files: new Map(),
    govInsight: { ...DEFAULT_GOVINSIGHT },
    govInsightFile: process.env.PDF_SMOKE_GOVINSIGHT_FILE || '',
    apiBase: process.env.PDF_SMOKE_API_BASE_URL || process.env.API_BASE_URL || '',
    frontendUrl: process.env.PDF_SMOKE_FRONTEND_URL || process.env.FRONTEND_URL || '',
    token: process.env.PDF_SMOKE_TOKEN || '',
    timeoutMs: Number(process.env.PDF_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    strictLive: process.env.PDF_SMOKE_STRICT_LIVE === '1',
    skipLive: process.env.PDF_SMOKE_SKIP_LIVE === '1',
    skipGovInsight: process.env.PDF_SMOKE_SKIP_GOVINSIGHT === '1',
    jsonOut: '',
  };

  argv.forEach((arg) => {
    if (arg.startsWith('--comparison-ids=')) {
      args.comparisonIds = arg
        .slice('--comparison-ids='.length)
        .split(',')
        .map((item) => Number(item.trim()))
        .filter(Number.isFinite);
    } else if (arg.startsWith('--file=')) {
      const pair = arg.slice('--file='.length);
      const [idText, ...fileParts] = pair.split('=');
      const id = Number(idText);
      const filePath = fileParts.join('=');
      if (Number.isFinite(id) && filePath) {
        args.files.set(id, filePath);
      }
    } else if (arg.startsWith('--govinsight-file=')) {
      args.govInsightFile = arg.slice('--govinsight-file='.length);
    } else if (arg.startsWith('--govinsight=')) {
      const [orgId, yearText] = arg.slice('--govinsight='.length).split('/');
      if (orgId) args.govInsight.orgId = orgId;
      if (Number.isFinite(Number(yearText))) args.govInsight.year = Number(yearText);
    } else if (arg.startsWith('--api-base=')) {
      args.apiBase = arg.slice('--api-base='.length);
    } else if (arg.startsWith('--frontend-url=')) {
      args.frontendUrl = arg.slice('--frontend-url='.length);
    } else if (arg.startsWith('--token=')) {
      args.token = arg.slice('--token='.length);
    } else if (arg.startsWith('--timeout-ms=')) {
      const timeoutMs = Number(arg.slice('--timeout-ms='.length));
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) args.timeoutMs = timeoutMs;
    } else if (arg === '--strict-live') {
      args.strictLive = true;
    } else if (arg === '--skip-live') {
      args.skipLive = true;
    } else if (arg === '--skip-govinsight') {
      args.skipGovInsight = true;
    } else if (arg.startsWith('--json-out=')) {
      args.jsonOut = arg.slice('--json-out='.length);
    }
  });

  return args;
}

async function loadPdfjs() {
  const mod = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return mod.default || mod;
}

let poolPromise = null;
async function loadPool() {
  if (!poolPromise) {
    try {
      require('dotenv').config();
    } catch {
      // dotenv is optional for direct file checks.
    }
    poolPromise = Promise.resolve(require('../dist/config/database-llm').default);
  }
  return poolPromise;
}

function normalizePath(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function relativeOrAbsolute(value) {
  if (!value) return '';
  const absolute = normalizePath(value);
  const relative = path.relative(process.cwd(), absolute);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return absolute;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function makeCheck(name, ok, details = '', extra = {}) {
  return {
    name,
    ok: Boolean(ok),
    details,
    ...extra,
  };
}

function makeSkipped(name, reason, extra = {}) {
  return {
    name,
    ok: true,
    status: 'skipped',
    reason,
    ...extra,
  };
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = spawnSync(probe, args, { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function detectToolAvailability() {
  return {
    pdfjs: true,
    pdfinfo: commandExists('pdfinfo'),
    pdftoppm: commandExists('pdftoppm'),
    imagemagick: commandExists('magick'),
    ghostscript: commandExists('gswin64c') || commandExists('gswin32c') || commandExists('gs'),
  };
}

function buildCapabilityNotes(tools) {
  const notes = [
    'pdfjs-dist text/page inspection is available and required.',
  ];
  if (!tools.pdfinfo || !tools.pdftoppm || !tools.imagemagick || !tools.ghostscript) {
    notes.push(
      'Pixel-level rendering/diff checks are downgraded because pdfinfo/pdftoppm/ImageMagick/Ghostscript are not all available.'
    );
  }
  return notes;
}

async function resolvePdfFile(comparisonId, explicitFile) {
  if (explicitFile) return normalizePath(explicitFile);

  const pool = await loadPool();
  const result = await pool.query(
    `
      SELECT file_path
      FROM jobs
      WHERE kind = 'pdf_export'
        AND comparison_id = $1
        AND status = 'done'
        AND file_path IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 30
    `,
    [comparisonId]
  );
  const candidates = result.rows
    .map((row) => normalizePath(row.file_path || ''))
    .filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || '';
}

async function readPdfPages(pdfjs, input) {
  const data = Buffer.isBuffer(input)
    ? new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength))
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(fs.readFileSync(input));
  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const items = (textContent.items || [])
        .map((item) => ({
          str: String(item?.str || ''),
          x: Number(item?.transform?.[4] || 0),
          y: Number(item?.transform?.[5] || 0),
          width: Number(item?.width || 0),
          height: Number(item?.height || 0),
        }))
        .filter((item) => item.str.trim());
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        text: items.map((item) => item.str).join(' '),
        items,
      });
    }
  } finally {
    await pdf.destroy?.();
  }

  return pages;
}

async function inspectPdf(pdfjs, input) {
  const pages = await readPdfPages(pdfjs, input);
  const fullText = pages.map((page) => page.text).join('\n');
  return {
    pageCount: pages.length,
    blankPages: pages.filter((page) => page.text.trim().length === 0).length,
    hasReplacementChar: fullText.includes('�'),
    fullText,
    normalizedText: normalizeText(fullText),
    pages,
  };
}

function checkRequiredText(inspection, requiredText) {
  const missing = requiredText.filter(
    (token) => !inspection.normalizedText.includes(normalizeText(token))
  );
  return {
    ok: missing.length === 0,
    missing,
  };
}

function checkComparisonPrintReady(inspection) {
  const markers = [
    '政府信息公开',
    '政务公开年报',
    '年度报告',
    '年报',
  ];
  return markers.some((marker) => inspection.normalizedText.includes(normalizeText(marker)));
}

function checkLongTableNotTruncated(inspection) {
  const tailText = normalizeText(
    inspection.pages
      .slice(Math.max(0, inspection.pages.length - 3))
      .map((page) => page.text)
      .join('\n')
  );
  const lastPageTextLength = inspection.pages[inspection.pages.length - 1]?.text.trim().length || 0;
  const hasExpectedTail = tailText.includes(normalizeText('数据勾稽问题清单'));
  return {
    ok: inspection.pageCount >= 10 && hasExpectedTail && lastPageTextLength >= 80,
    details: `pages=${inspection.pageCount}, tailHasChecklist=${hasExpectedTail}, lastPageTextLength=${lastPageTextLength}`,
  };
}

async function runComparisonSample(pdfjs, comparisonId, explicitFile) {
  const sample = COMPARISON_SAMPLES.get(comparisonId) || {
    kind: 'comparison-custom',
    label: `comparison ${comparisonId}`,
    requiredText: ['政府信息公开', '年度报告'],
    minPages: 1,
  };

  const filePath = await resolvePdfFile(comparisonId, explicitFile);
  const result = {
    type: 'comparison',
    status: 'failed',
    ok: false,
    comparisonId,
    label: sample.label,
    kind: sample.kind,
    filePath: relativeOrAbsolute(filePath),
    exists: Boolean(filePath && fs.existsSync(filePath)),
    pageCount: 0,
    blankPages: 0,
    hasReplacementChar: false,
    printReadyMarkerOk: false,
    checks: [],
    error: '',
  };

  result.checks.push(makeCheck('file_exists', result.exists, result.filePath || 'no file path'));
  if (!result.exists) {
    result.error = 'PDF file does not exist. Generate the PDF first or pass --file=<comparison_id>=<pdf_path>.';
    return result;
  }

  try {
    const inspection = await inspectPdf(pdfjs, filePath);
    const required = checkRequiredText(inspection, sample.requiredText);
    const longTable = sample.longTable ? checkLongTableNotTruncated(inspection) : null;
    result.pageCount = inspection.pageCount;
    result.blankPages = inspection.blankPages;
    result.hasReplacementChar = inspection.hasReplacementChar;
    result.printReadyMarkerOk = checkComparisonPrintReady(inspection);
    result.checks.push(
      makeCheck('page_count_positive', inspection.pageCount > 0, `pages=${inspection.pageCount}`),
      makeCheck('minimum_page_count', inspection.pageCount >= sample.minPages, `expected>=${sample.minPages}`),
      makeCheck('blank_pages_zero', inspection.blankPages === 0, `blankPages=${inspection.blankPages}`),
      makeCheck('no_replacement_char', !inspection.hasReplacementChar),
      makeCheck('print_ready_marker', result.printReadyMarkerOk),
      makeCheck(
        'required_titles_and_sections',
        required.ok,
        required.ok ? 'all expected text tokens found' : `missing=${required.missing.join(', ')}`
      )
    );
    if (longTable) {
      result.checks.push(makeCheck('long_table_not_obviously_truncated', longTable.ok, longTable.details));
    }
    result.ok = result.checks.every((check) => check.ok);
    result.status = result.ok ? 'passed' : 'failed';
  } catch (error) {
    result.error = error?.message || String(error);
  }

  return result;
}

function firstExistingGovInsightFixture(orgId, year) {
  const safeOrg = orgId.replace(/[^a-z0-9_-]+/gi, '_');
  const directCandidates = [
    `output/pdf/govinsight_${safeOrg}_${year}_after_adapter.pdf`,
    `output/pdf/govinsight_${safeOrg}_${year}_baseline_before_adapter.pdf`,
    `.codex-temp/p2-2-health-artifacts/govinsight-${safeOrg}-${year}.pdf`,
  ];

  for (const candidate of directCandidates) {
    const absolute = normalizePath(candidate);
    if (fs.existsSync(absolute)) return absolute;
  }

  const outputDir = normalizePath('output/pdf');
  if (!fs.existsSync(outputDir)) return '';
  const pattern = new RegExp(`govinsight.*${safeOrg}.*${year}.*\\.pdf$`, 'i');
  const matches = fs.readdirSync(outputDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(outputDir, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return matches[0] || '';
}

function checkGovInsightPrintReady(inspection) {
  return inspection.normalizedText.includes(normalizeText('政务公开智能辅策报告'));
}

function findTocPage(inspection) {
  return inspection.pages.find((page) => normalizeText(page.text).includes(normalizeText('目录'))) || null;
}

function findItemByText(page, token) {
  const normalizedToken = normalizeText(token);
  return page.items.find((item) => normalizeText(item.str).includes(normalizedToken));
}

function findNumberNearTitle(page, titleItem) {
  const candidates = page.items
    .filter((item) => /^[0-9]+$/.test(item.str.trim()))
    .filter((item) => Math.abs(item.y - titleItem.y) <= 3 && item.x > titleItem.x)
    .sort((left, right) => right.x - left.x);
  return candidates.length ? Number(candidates[0].str.trim()) : null;
}

function checkGovInsightToc(inspection) {
  const tocPage = findTocPage(inspection);
  if (!tocPage) {
    return {
      ok: false,
      details: 'TOC page not found',
      entries: [],
    };
  }

  const entries = [];
  let previousPage = tocPage.pageNumber;
  for (const title of GOVINSIGHT_TOC_TITLES) {
    const titleItem = findItemByText(tocPage, title);
    if (!titleItem) {
      entries.push({ title, ok: false, reason: 'title missing from TOC' });
      continue;
    }
    const pageNumber = findNumberNearTitle(tocPage, titleItem);
    const targetPage = pageNumber ? inspection.pages[pageNumber - 1] : null;
    const targetHasTitle = Boolean(
      targetPage && normalizeText(targetPage.text).includes(normalizeText(title))
    );
    const pageNumberTrusted =
      Number.isInteger(pageNumber) &&
      pageNumber > tocPage.pageNumber &&
      pageNumber <= inspection.pageCount &&
      pageNumber >= previousPage &&
      targetHasTitle;
    entries.push({
      title,
      pageNumber,
      targetHasTitle,
      ok: pageNumberTrusted,
    });
    if (Number.isInteger(pageNumber)) {
      previousPage = pageNumber;
    }
  }

  return {
    ok: entries.every((entry) => entry.ok),
    details: `tocPage=${tocPage.pageNumber}, entries=${entries.length}`,
    entries,
  };
}

function isHeaderItem(page, item) {
  return item.y > page.height - 35;
}

function isFooterItem(item) {
  return item.y < 35;
}

function checkGovInsightHeaderFooter(inspection) {
  const pageResults = inspection.pages.map((page) => {
    const headerItems = page.items.filter((item) => isHeaderItem(page, item));
    const footerItems = page.items.filter(isFooterItem);
    const bodyItems = page.items.filter((item) => !isHeaderItem(page, item) && !isFooterItem(item));
    const headerText = headerItems.map((item) => item.str).join(' ');
    const footerText = footerItems.map((item) => item.str).join(' ');
    const bodyTop = Math.max(...bodyItems.map((item) => item.y), 0);
    const bodyBottom = Math.min(...bodyItems.map((item) => item.y), page.height);
    const headerBottom = Math.min(...headerItems.map((item) => item.y), page.height);
    const footerTop = Math.max(...footerItems.map((item) => item.y), 0);
    const headerGap = headerItems.length ? headerBottom - bodyTop : 0;
    const footerGap = bodyBottom - footerTop;
    const hasHeader = normalizeText(headerText).includes(normalizeText('政务公开智能辅策报告'));
    const hasFooter = /第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页/.test(footerText);

    return {
      pageNumber: page.pageNumber,
      hasHeader,
      hasFooter,
      headerGap: Number(headerGap.toFixed(1)),
      footerGap: Number(footerGap.toFixed(1)),
      ok: hasHeader && hasFooter && headerGap >= 10 && footerGap >= 10,
    };
  });

  return {
    ok: pageResults.every((page) => page.ok),
    details: `checkedPages=${pageResults.length}`,
    pages: pageResults,
  };
}

async function inspectGovInsightPdf(pdfjs, input, sample, sourceLabel) {
  const inspection = await inspectPdf(pdfjs, input);
  const required = checkRequiredText(inspection, GOVINSIGHT_REQUIRED_TEXT);
  const toc = checkGovInsightToc(inspection);
  const headerFooter = checkGovInsightHeaderFooter(inspection);
  const printReadyMarkerOk = checkGovInsightPrintReady(inspection);

  const checks = [
    makeCheck('page_count_positive', inspection.pageCount > 0, `pages=${inspection.pageCount}`),
    makeCheck('blank_pages_zero', inspection.blankPages === 0, `blankPages=${inspection.blankPages}`),
    makeCheck('no_replacement_char', !inspection.hasReplacementChar),
    makeCheck('print_ready_marker', printReadyMarkerOk),
    makeCheck(
      'required_titles_and_sections',
      required.ok,
      required.ok ? 'all expected text tokens found' : `missing=${required.missing.join(', ')}`
    ),
    makeCheck('toc_page_numbers_trusted', toc.ok, toc.details, { tocEntries: toc.entries }),
    makeCheck('header_footer_not_overlapping', headerFooter.ok, headerFooter.details, {
      headerFooterPages: headerFooter.pages,
    }),
  ];

  return {
    type: 'govinsight',
    status: checks.every((check) => check.ok) ? 'passed' : 'failed',
    ok: checks.every((check) => check.ok),
    orgId: sample.orgId,
    year: sample.year,
    source: sourceLabel,
    pageCount: inspection.pageCount,
    blankPages: inspection.blankPages,
    hasReplacementChar: inspection.hasReplacementChar,
    printReadyMarkerOk,
    checks,
  };
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

function getHttpClient(url) {
  return url.protocol === 'https:' ? https : http;
}

function requestBuffer(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = getHttpClient(urlObj);
    const request = client.request(
      {
        method: options.method || 'GET',
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: `${urlObj.pathname}${urlObj.search}`,
        headers: options.headers || {},
        timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error(`Request timed out: ${url}`));
    });

    if (options.body) request.write(options.body);
    request.end();
  });
}

async function isApiHealthy(baseUrl) {
  try {
    const response = await requestBuffer(`${normalizeBaseUrl(baseUrl)}/api/health`, {
      timeoutMs: 3000,
    });
    return response.statusCode >= 200 && response.statusCode < 500;
  } catch {
    return false;
  }
}

async function discoverApiBase(configuredBase) {
  const configured = normalizeBaseUrl(configuredBase);
  if (configured && await isApiHealthy(configured)) return configured;

  const candidates = [
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    'http://127.0.0.1:3000',
    'http://localhost:3000',
  ];
  for (const candidate of candidates) {
    if (await isApiHealthy(candidate)) return candidate;
  }
  return configured || '';
}

function buildDevToken() {
  try {
    require('dotenv').config();
  } catch {
    // dotenv is optional here.
  }
  const secret = process.env.JWT_SECRET || 'dev-only-insecure-key-min-32-chars!!';
  const payload = {
    id: Number(process.env.PDF_EXPORT_SERVICE_USER_ID || 1),
    username: process.env.PDF_EXPORT_SERVICE_USERNAME || 'pdf-smoke',
    exp: Date.now() + 30 * 60 * 1000,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payloadStr)
    .digest('base64url');
  return `${payloadStr}.${signature}`;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson(url, options = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await requestBuffer(url, {
    method: options.method || 'GET',
    timeoutMs: options.timeoutMs,
    body,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = response.body.toString('utf8');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ...response, text, json };
}

async function findLatestJobIdForComparison(comparisonId) {
  const pool = await loadPool();
  const result = await pool.query(
    `
      SELECT id, file_path
      FROM jobs
      WHERE kind = 'pdf_export'
        AND comparison_id = $1
        AND status = 'done'
        AND file_path IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 30
    `,
    [comparisonId]
  );
  const row = result.rows.find((item) => item.file_path && fs.existsSync(item.file_path));
  return row?.id ? Number(row.id) : null;
}

async function findFailedPdfJob() {
  const pool = await loadPool();
  const result = await pool.query(
    `
      SELECT id, comparison_id, status, error_message
      FROM jobs
      WHERE kind = 'pdf_export'
        AND status = 'failed'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 1
    `
  );
  return result.rows[0] || null;
}

async function findExpiredPdfJob() {
  const pool = await loadPool();
  const result = await pool.query(
    `
      SELECT id, comparison_id, status, file_path
      FROM jobs
      WHERE kind = 'pdf_export'
        AND status = 'done'
        AND file_path IS NOT NULL
      ORDER BY finished_at DESC NULLS LAST, created_at DESC
      LIMIT 30
    `
  );
  return result.rows.find((row) => row.file_path && !fs.existsSync(row.file_path)) || null;
}

async function pollPdfJob(apiBase, token, jobId, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await requestJson(`${apiBase}/api/pdf-jobs?limit=50`, {
      headers: authHeaders(token),
      timeoutMs: 10000,
    });
    const job = response.json?.jobs?.find((item) => Number(item.job_id) === Number(jobId));
    if (job && ['done', 'failed'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  return null;
}

async function createTemporaryPdfJob(comparisonId, overrides) {
  const pool = await loadPool();
  const comparison = await pool.query(
    `
      SELECT left_report_id
      FROM comparisons
      WHERE id = $1
      LIMIT 1
    `,
    [comparisonId]
  );
  const reportId = comparison.rows[0]?.left_report_id;
  if (!reportId) {
    throw new Error(`Cannot create temporary pdf job: comparison ${comparisonId} not found`);
  }

  const result = await pool.query(
    `
      INSERT INTO jobs (
        report_id,
        kind,
        status,
        progress,
        step_code,
        step_name,
        comparison_id,
        export_title,
        file_name,
        file_path,
        file_size,
        error_message,
        finished_at
      ) VALUES (
        $1,
        'pdf_export',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        NOW()
      )
      RETURNING id
    `,
    [
      reportId,
      overrides.status,
      overrides.progress ?? 0,
      overrides.stepCode || (overrides.status === 'failed' ? 'ERROR' : 'DONE'),
      overrides.stepName || (overrides.status === 'failed' ? 'Generation failed' : 'Completed'),
      comparisonId,
      overrides.exportTitle || 'P2-4 temporary PDF smoke job',
      overrides.fileName || `p2-4-temporary-${Date.now()}.pdf`,
      overrides.filePath || null,
      overrides.fileSize || null,
      overrides.errorMessage || null,
    ]
  );
  return Number(result.rows[0].id);
}

async function deleteTemporaryPdfJobs(jobIds) {
  if (!jobIds.length) return;
  const pool = await loadPool();
  await pool.query('DELETE FROM jobs WHERE id = ANY($1::int[])', [jobIds]);
}

async function runPdfJobApiRegression(pdfjs, args, apiBase, token) {
  const result = {
    type: 'pdf-job-api',
    status: 'skipped',
    ok: true,
    apiBase: apiBase || '',
    checks: [],
  };

  if (args.skipLive) {
    result.checks.push(makeSkipped('live_api_checks', 'disabled by --skip-live or PDF_SMOKE_SKIP_LIVE=1'));
    return result;
  }
  if (!apiBase || !(await isApiHealthy(apiBase))) {
    result.checks.push(makeSkipped('live_api_checks', 'local API is not reachable; route semantics are covered by Jest tests'));
    return result;
  }

  result.status = 'failed';
  const temporaryJobIds = [];
  const completedSmokeApiJobIds = [];
  try {
    const smokeJobTitle = `P2-4 PDF smoke ${new Date().toISOString()}`;
    const createResponse = await requestJson(`${apiBase}/api/pdf-jobs`, {
      method: 'POST',
      headers: authHeaders(token),
      timeoutMs: 10000,
      body: {
        comparison_id: 4670,
        title: smokeJobTitle,
      },
    });
    const created = createResponse.statusCode === 201 && createResponse.json?.job_id;
    result.checks.push(
      makeCheck('job_create_returns_201', created, `status=${createResponse.statusCode}`)
    );

    if (created) {
      const job = await pollPdfJob(apiBase, token, createResponse.json.job_id, args.timeoutMs);
      const reachedTerminalState = job?.status === 'done' || job?.status === 'failed';
      const isSmokeOwnedJob =
        typeof job?.export_title === 'string' &&
        job.export_title === smokeJobTitle;
      if (reachedTerminalState && isSmokeOwnedJob) {
        completedSmokeApiJobIds.push(Number(createResponse.json.job_id));
      }
      const completed = job?.status === 'done' && job.file_exists === true;
      result.checks.push(
        makeCheck('job_reaches_done', completed, job ? `status=${job.status}, file_exists=${job.file_exists}` : 'poll timeout')
      );
      if (completed) {
        const download = await requestBuffer(`${apiBase}/api/pdf-jobs/${createResponse.json.job_id}/download`, {
          headers: authHeaders(token),
          timeoutMs: 30000,
        });
        const isPdf = download.statusCode === 200 && String(download.headers['content-type'] || '').includes('application/pdf');
        result.checks.push(makeCheck('job_download_returns_pdf', isPdf, `status=${download.statusCode}`));
        if (isPdf) {
          const inspection = await inspectPdf(pdfjs, download.body);
          result.checks.push(
            makeCheck('download_pdf_page_count_positive', inspection.pageCount > 0, `pages=${inspection.pageCount}`),
            makeCheck('download_pdf_blank_pages_zero', inspection.blankPages === 0, `blankPages=${inspection.blankPages}`),
            makeCheck('download_pdf_no_replacement_char', !inspection.hasReplacementChar)
          );
        }
      }
    }

    let failedJob = await findFailedPdfJob();
    if (!failedJob) {
      const tempFailedId = await createTemporaryPdfJob(4670, {
        status: 'failed',
        errorMessage: 'P2-4 temporary failed job sample',
      });
      temporaryJobIds.push(tempFailedId);
      failedJob = { id: tempFailedId, comparison_id: 4670, status: 'failed' };
    }

    const failedDownload = await requestJson(`${apiBase}/api/pdf-jobs/${failedJob.id}/download`, {
      headers: authHeaders(token),
      timeoutMs: 10000,
    });
    result.checks.push(
      makeCheck(
        'failed_job_not_downloadable',
        failedDownload.statusCode === 400 && failedDownload.json?.error === 'PDF not ready',
        `job=${failedJob.id}, status=${failedDownload.statusCode}`
      )
    );

    let expiredJob = await findExpiredPdfJob();
    if (!expiredJob) {
      const missingPath = normalizePath(
        path.join('.codex-temp', `p2-4-missing-pdf-${Date.now()}.pdf`)
      );
      const tempMissingId = await createTemporaryPdfJob(1143, {
        status: 'done',
        progress: 100,
        fileName: `p2-4-missing-${Date.now()}.pdf`,
        filePath: missingPath,
        fileSize: 1234,
      });
      temporaryJobIds.push(tempMissingId);
      expiredJob = { id: tempMissingId, comparison_id: 1143, status: 'done', file_path: missingPath };
    }

    const expiredDownload = await requestJson(`${apiBase}/api/pdf-jobs/${expiredJob.id}/download`, {
      headers: authHeaders(token),
      timeoutMs: 10000,
    });
    result.checks.push(
      makeCheck(
        'missing_or_expired_file_returns_410',
        expiredDownload.statusCode === 410 && expiredDownload.json?.needs_regeneration === true,
        `job=${expiredJob.id}, status=${expiredDownload.statusCode}`
      )
    );

    const batchJobIds = [];
    for (const comparisonId of DEFAULT_COMPARISON_IDS) {
      const jobId = await findLatestJobIdForComparison(comparisonId);
      if (jobId) batchJobIds.push(jobId);
    }
    if (batchJobIds.length >= 2) {
      const batch = await requestBuffer(`${apiBase}/api/pdf-jobs/batch-download`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_ids: batchJobIds }),
        timeoutMs: 30000,
      });
      const contentType = String(batch.headers['content-type'] || '');
      result.checks.push(
        makeCheck(
          'batch_download_returns_zip',
          batch.statusCode === 200 && contentType.includes('application/zip') && batch.body.length > 100,
          `status=${batch.statusCode}, bytes=${batch.body.length}, jobIds=${batchJobIds.join(',')}`
        )
      );
    } else {
      result.checks.push(makeSkipped('batch_download_returns_zip', 'need at least two completed comparison PDF jobs'));
    }
  } finally {
    await deleteTemporaryPdfJobs([...completedSmokeApiJobIds, ...temporaryJobIds]);
  }

  result.ok = result.checks.every((check) => check.ok);
  result.status = result.ok ? 'passed' : 'failed';
  return result;
}

async function fetchGovInsightPdfFromApi(apiBase, token, orgId, year, timeoutMs) {
  const url = `${apiBase}/api/gov-insight/report-pdf?org_id=${encodeURIComponent(orgId)}&year=${encodeURIComponent(String(year))}`;
  const response = await requestBuffer(url, {
    headers: authHeaders(token),
    timeoutMs,
  });
  const contentType = String(response.headers['content-type'] || '');
  if (response.statusCode !== 200 || !contentType.includes('application/pdf')) {
    throw new Error(`GovInsight PDF API returned status=${response.statusCode}, contentType=${contentType}, body=${response.body.toString('utf8').slice(0, 300)}`);
  }
  return response.body;
}

async function discoverFrontendUrl(configuredUrl, orgId, year) {
  const candidates = [];
  const add = (value) => {
    const normalized = normalizeBaseUrl(value);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };
  add(configuredUrl);
  ['http://localhost:3001', 'http://127.0.0.1:3001', 'http://localhost:3000', 'http://127.0.0.1:3000'].forEach(add);

  for (const candidate of candidates) {
    try {
      const response = await requestBuffer(
        `${candidate}/print/govinsight-report/${encodeURIComponent(orgId)}/${year}`,
        { timeoutMs: 3000 }
      );
      const body = response.body.toString('utf8');
      if (
        response.statusCode &&
        response.statusCode < 500 &&
        body.includes('<div id="root"></div>') &&
        (body.includes('/static/js/') || body.includes('static/js/'))
      ) {
        return candidate;
      }
    } catch {
      // Try the next frontend candidate.
    }
  }
  return '';
}

async function runGovInsightConsoleProbe(args, token) {
  const result = {
    name: 'recharts_width_height_warning',
    ok: true,
    status: 'skipped',
    reason: '',
    frontendUrl: '',
    warnings: [],
  };

  if (args.skipLive) {
    result.reason = 'disabled by --skip-live or PDF_SMOKE_SKIP_LIVE=1';
    return result;
  }

  const frontendUrl = await discoverFrontendUrl(args.frontendUrl, args.govInsight.orgId, args.govInsight.year);
  if (!frontendUrl) {
    result.reason = 'local frontend is not reachable';
    return result;
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    result.reason = 'puppeteer is not available';
    return result;
  }

  result.status = 'failed';
  result.frontendUrl = frontendUrl;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    const messages = [];
    page.on('console', (message) => {
      messages.push({ type: message.type(), text: message.text() });
    });
    await page.evaluateOnNewDocument((adminToken) => {
      window.localStorage?.setItem('admin_token', adminToken);
    }, token);
    await page.setViewport({ width: 1440, height: 2200, deviceScaleFactor: 2 });
    await page.goto(
      `${frontendUrl}/print/govinsight-report/${encodeURIComponent(args.govInsight.orgId)}/${args.govInsight.year}`,
      { waitUntil: 'networkidle0', timeout: 60000 }
    );
    await page.waitForSelector('#govinsight-report-print', { timeout: 45000 });
    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-govinsight-pdf-ready') === 'true',
      { timeout: 15000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    result.warnings = messages.filter(
      (message) =>
        ['warning', 'error'].includes(message.type) &&
        /recharts|responsivecontainer|width|height/i.test(message.text)
    );
    result.ok = result.warnings.length === 0;
    result.status = result.ok ? 'passed' : 'failed';
    return result;
  } finally {
    await browser.close();
  }
}

async function runGovInsightSample(pdfjs, args, apiBase, token) {
  if (args.skipGovInsight) {
    return {
      type: 'govinsight',
      status: 'skipped',
      ok: true,
      orgId: args.govInsight.orgId,
      year: args.govInsight.year,
      checks: [makeSkipped('govinsight_pdf', 'disabled by --skip-govinsight or PDF_SMOKE_SKIP_GOVINSIGHT=1')],
    };
  }

  const explicitFile = args.govInsightFile ? normalizePath(args.govInsightFile) : '';
  const fixtureFile = explicitFile || firstExistingGovInsightFixture(args.govInsight.orgId, args.govInsight.year);
  let result = null;

  if (apiBase && !args.skipLive && await isApiHealthy(apiBase)) {
    try {
      const buffer = await fetchGovInsightPdfFromApi(
        apiBase,
        token,
        args.govInsight.orgId,
        args.govInsight.year,
        args.timeoutMs
      );
      result = await inspectGovInsightPdf(
        pdfjs,
        buffer,
        args.govInsight,
        `${apiBase}/api/gov-insight/report-pdf`
      );
    } catch (error) {
      result = {
        type: 'govinsight',
        status: 'failed',
        ok: false,
        orgId: args.govInsight.orgId,
        year: args.govInsight.year,
        source: `${apiBase}/api/gov-insight/report-pdf`,
        checks: [makeCheck('govinsight_api_export', false, error?.message || String(error))],
      };
    }
  } else if (fixtureFile && fs.existsSync(fixtureFile)) {
    result = await inspectGovInsightPdf(
      pdfjs,
      fixtureFile,
      args.govInsight,
      `file:${relativeOrAbsolute(fixtureFile)}`
    );
  } else {
    result = {
      type: 'govinsight',
      status: 'skipped',
      ok: true,
      orgId: args.govInsight.orgId,
      year: args.govInsight.year,
      source: '',
      checks: [
        makeSkipped(
          'govinsight_pdf',
          'no live API available and no GovInsight fixture found; pass --govinsight-file=<pdf> or start the local API/frontend'
        ),
      ],
    };
  }

  const consoleProbe = await runGovInsightConsoleProbe(args, token);
  result.checks = result.checks || [];
  result.checks.push(consoleProbe);
  result.ok = result.checks.every((check) => check.ok);
  if (result.status !== 'skipped') {
    result.status = result.ok ? 'passed' : 'failed';
  }
  return result;
}

function summarize(results, strictLive) {
  const flat = [];
  for (const result of results) {
    flat.push(result);
    for (const check of result.checks || []) {
      if (check.status === 'skipped') {
        flat.push({ status: 'skipped', ok: true });
      }
    }
  }

  const failed = results.filter((result) => result.ok === false || result.status === 'failed').length;
  const skipped = flat.filter((item) => item.status === 'skipped').length;
  return {
    total: results.length,
    passed: results.filter((result) => result.status === 'passed').length,
    failed,
    skipped,
    strictLive,
    ok: failed === 0 && (!strictLive || skipped === 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pdfjs = await loadPdfjs();
  const tools = detectToolAvailability();
  const apiBase = args.skipLive ? '' : await discoverApiBase(args.apiBase);
  const token = args.token || buildDevToken();
  const results = [];

  for (const comparisonId of args.comparisonIds) {
    results.push(await runComparisonSample(pdfjs, comparisonId, args.files.get(comparisonId)));
  }

  results.push(await runGovInsightSample(pdfjs, args, apiBase, token));
  results.push(await runPdfJobApiRegression(pdfjs, args, apiBase, token));

  const summary = summarize(results, args.strictLive);
  const output = {
    ok: summary.ok,
    generatedAt: new Date().toISOString(),
    summary,
    config: {
      comparisonIds: args.comparisonIds,
      govInsight: args.govInsight,
      apiBase: apiBase || '',
      liveChecksStrict: args.strictLive,
    },
    toolAvailability: tools,
    capabilityNotes: buildCapabilityNotes(tools),
    results,
  };

  const json = JSON.stringify(output, null, 2);
  if (args.jsonOut) {
    fs.writeFileSync(normalizePath(args.jsonOut), json, 'utf8');
  }
  console.log(json);
  process.exit(summary.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
