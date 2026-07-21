import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import fsPromises from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { UPLOADS_TMP_DIR } from '../config/constants';
import { validateRedirectURL, validateURLSecurity } from '../utils/urlValidator';
import { reportUploadService } from './ReportUploadService';

export type UrlCollectionMode = 'auto' | 'single' | 'list';

type ResolvedCollectionMode = 'single' | 'list';

export interface UrlCollectionImportOptions {
  url: string;
  collectionMode?: UrlCollectionMode;
  year?: number | null;
  regionId?: number | null;
  unitName?: string | null;
  model?: string;
  limit?: number;
  allowedRegionIds?: number[] | null;
  dryRun?: boolean;
}

export interface UrlCollectionImportItem {
  id: string;
  title: string;
  url: string;
  final_url?: string;
  unit_name?: string | null;
  year?: number | null;
  region_id?: number | null;
  region_name?: string | null;
  status: 'ready' | 'queued' | 'reused' | 'pending_match' | 'failed';
  message?: string;
  report_id?: number;
  version_id?: number;
  job_id?: number;
  file_name?: string;
  file_hash?: string;
  storage_path?: string;
  reused_version?: boolean;
  reused_job?: boolean;
}

export interface UrlCollectionImportResult {
  ok: true;
  dry_run: boolean;
  requested_mode: UrlCollectionMode;
  collection_mode: ResolvedCollectionMode;
  source_url: string;
  final_url: string;
  rule: {
    province: string | null;
    city: string | null;
    unit: string | null;
    domain: string;
    page_type: 'detail_page' | 'list_page';
    status: 'enabled';
  };
  summary: {
    discovered: number;
    downloaded: number;
    matched: number;
    submitted: number;
    reused: number;
    pending: number;
    failed: number;
  };
  items: UrlCollectionImportItem[];
  truncated: boolean;
  batch_uuid: string;
}

interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  contentType: string;
  buffer: Buffer;
}

interface CandidateLink {
  url: string;
  title: string;
}

interface ResolvedRegion {
  id: number;
  name: string;
}

const DEFAULT_MAX_ITEMS = 50;
const MAX_MAX_ITEMS = 200;
const REQUEST_TIMEOUT_MS = Number(process.env.URL_COLLECTION_TIMEOUT_MS || 20000);
const MAX_PAGE_BYTES = Number(process.env.URL_COLLECTION_MAX_PAGE_BYTES || 15 * 1024 * 1024);
const MAX_REDIRECTS = 5;
const USER_AGENT =
  process.env.URL_COLLECTION_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) GovReportCollector/1.0 Safari/537.36';

type FetchedFileKind = 'html' | 'pdf';

const HUAiAN_PDF_UNIT_CODE_MAP: Record<string, string> = {
  qjp: '清江浦区',
  ha: '淮安区',
  hy: '淮阴区',
  hz: '洪泽区',
  ls: '涟水县',
  xy: '盱眙县',
  jh: '金湖县',
  kfq: '淮安经济技术开发区',
  stwlq: '淮安生态文化旅游区',
  gyyq: '淮安工业园区',
};

function getUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url || '');
  }
}

function isPdfUrl(url: string): boolean {
  return /\.pdf$/i.test(getUrlPathname(url).split(/[?#]/)[0]);
}

function isPdfPage(page: FetchedPage): boolean {
  return isPdfUrl(page.finalUrl) || /application\/pdf/i.test(page.contentType || '');
}

function isKnownAnnualReportPdfUrl(url: string): boolean {
  const pathname = getUrlPathname(url).toLowerCase();
  return isPdfUrl(url) && (pathname.includes('/wzxxgknb/') || pathname.includes('xxgknb'));
}

function getFetchedFileKind(page: FetchedPage): FetchedFileKind {
  return isPdfPage(page) ? 'pdf' : 'html';
}

function getFileExtension(kind: FetchedFileKind): string {
  return kind === 'pdf' ? '.pdf' : '.html';
}

function getMimeType(kind: FetchedFileKind): string {
  return kind === 'pdf' ? 'application/pdf' : 'text/html';
}

function extractUnitNameFromUrl(url: string): string | null {
  const basename = path.basename(getUrlPathname(url)).replace(/\.[^.]+$/i, '').toLowerCase();
  return HUAiAN_PDF_UNIT_CODE_MAP[basename] || null;
}

function inferReportYearFromDirectFileUrl(url: string): number | null {
  const pathname = getUrlPathname(url);
  const huaianAnnualReportMatch = /\/wzxxgknb\/(20\d{2})(?:\/|$)/i.exec(pathname);
  if (huaianAnnualReportMatch) {
    const publicationYear = Number(huaianAnnualReportMatch[1]);
    if (Number.isInteger(publicationYear) && publicationYear > 2000) {
      return publicationYear - 1;
    }
  }
  return null;
}

function buildDirectFileTitle(url: string, requestedYear?: number | null, requestedUnitName?: string | null): string {
  const unitName = normalizeText(requestedUnitName) || extractUnitNameFromUrl(url);
  const year = requestedYear && Number.isInteger(requestedYear) ? requestedYear : inferReportYearFromDirectFileUrl(url);
  if (unitName && year) {
    return `${unitName}${year}年政府信息公开工作年度报告`;
  }
  if (unitName) {
    return `${unitName}政府信息公开工作年度报告`;
  }
  return sanitizeFileName(path.basename(getUrlPathname(url)) || 'url-report.pdf');
}

export function inferUrlCollectionMode(url: string): ResolvedCollectionMode {
  const normalized = String(url || '').trim().toLowerCase();
  if (!normalized) return 'list';
  if (isPdfUrl(normalized)) return 'single';
  if (normalized.includes('/art/') || /\/art\/[^/]+\/[^/]+\.html?$/.test(normalized)) return 'single';
  if (normalized.includes('/index.') || normalized.includes('/col/') || normalized.includes('list')) return 'list';
  return 'list';
}

function normalizeText(input: unknown): string {
  return String(input || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(input: unknown): string {
  return normalizeText(input).replace(/\s+/g, '');
}

function normalizeForMatch(input: unknown): string {
  return compactText(input)
    .replace(/^淮安市?/, '淮安')
    .replace(/人民政府办公室$/, '政府办公室')
    .replace(/委员会$/, '委')
    .replace(/发展和改革/, '发展改革')
    .replace(/[（）()《》【】\[\]：:，,。.;；、\-_\s]/g, '');
}

function sanitizeFileName(input: string): string {
  const cleaned = path
    .basename(input || 'report.html')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'report.html';
}

function buildSafeFileName(unitName: string | null | undefined, year: number | null | undefined, title: string, extension: string): string {
  const rawName = `${unitName || ''}${year || ''}年政府信息公开工作年度报告`.trim() || title || 'url-report';
  const base = sanitizeFileName(rawName).replace(/\.(html?|pdf|txt|md)$/i, '');
  const normalizedExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return `${base || 'url-report'}${normalizedExtension}`;
}

function decodePageBuffer(buffer: Buffer, contentType: string): string {
  const head = buffer.subarray(0, 4096).toString('latin1');
  const fromContentType = /charset\s*=\s*([^;]+)/i.exec(contentType || '')?.[1];
  const fromMeta = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(head)?.[1];
  const encoding = String(fromContentType || fromMeta || 'utf-8').trim().toLowerCase();

  try {
    return new TextDecoder(encoding as any).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function fetchPage(url: string, redirectDepth = 0): Promise<FetchedPage> {
  const security = await validateURLSecurity(url);
  if (!security.valid) {
    throw new Error(security.error || 'url_security_rejected');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: MAX_PAGE_BYTES,
    maxBodyLength: MAX_PAGE_BYTES,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (response.status >= 300 && response.status < 400) {
    if (redirectDepth >= MAX_REDIRECTS) {
      throw new Error('redirect_limit_exceeded');
    }
    const location = response.headers.location;
    if (!location) {
      throw new Error('redirect_without_location');
    }
    const redirectUrl = new URL(location, url).toString();
    const redirectValidation = await validateRedirectURL(url, redirectUrl);
    if (!redirectValidation.valid) {
      throw new Error(redirectValidation.error || 'redirect_security_rejected');
    }
    return fetchPage(redirectUrl, redirectDepth + 1);
  }

  const contentType = String(response.headers['content-type'] || '');
  const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  return {
    requestedUrl: url,
    finalUrl: response.request?.res?.responseUrl || url,
    html: decodePageBuffer(buffer, contentType),
    contentType,
    buffer,
  };
}

function getGovRootDomain(hostname: string): string {
  const host = hostname.toLowerCase();
  const parts = host.split('.').filter(Boolean);
  const govIndex = parts.length >= 3 && parts[parts.length - 2] === 'gov' && parts[parts.length - 1] === 'cn';
  if (govIndex) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function isSameGovSite(baseUrl: string, candidateUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const candidate = new URL(candidateUrl);
    if (!['http:', 'https:'].includes(candidate.protocol)) return false;
    if (base.hostname === candidate.hostname) return true;
    return getGovRootDomain(base.hostname) === getGovRootDomain(candidate.hostname);
  } catch {
    return false;
  }
}

function isAnnualReportCandidate(title: string, url: string): boolean {
  const target = compactText(`${title} ${url}`);
  if (!/(20\d{2})/.test(target)) return false;
  return /政府信息公开.*年度报告|信息公开.*年报|年度报告|年报/.test(target);
}

function isAnnualReportSummaryPage(html: string): boolean {
  const $ = cheerio.load(html);
  const pageText = compactText(
    [
      $('title').first().text(),
      $('meta[name="ColumnName"]').attr('content'),
      $('meta[name="ArticleTitle"]').attr('content'),
      $('h1').first().text(),
    ].join(' ')
  );
  return /(20\d{2}).*(政府信息公开)?年报汇总|政府信息公开年报汇总|年度报告汇总/.test(pageText);
}

function extractPageTitle(html: string, fallback = ''): string {
  const $ = cheerio.load(html);
  const title =
    normalizeText($('meta[name="ArticleTitle"]').attr('content')) ||
    normalizeText($('meta[property="og:title"]').attr('content')) ||
    normalizeText($('h1').first().text()) ||
    normalizeText($('title').first().text()) ||
    fallback;
  return normalizeText(title.replace(/[-_]{1,2}.*$/, '')) || fallback;
}

function extractCandidateLinks(html: string, baseUrl: string, limit: number): { links: CandidateLink[]; truncated: boolean } {
  const $ = cheerio.load(html);
  const candidates: CandidateLink[] = [];
  const seen = new Set<string>();
  const summaryPage = isAnnualReportSummaryPage(html);

  $('a[href]').each((_, element) => {
    const href = normalizeText($(element).attr('href'));
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

    let absoluteUrl = '';
    try {
      absoluteUrl = new URL(href, baseUrl).toString();
    } catch {
      return;
    }

    if (!isSameGovSite(baseUrl, absoluteUrl)) return;

    const title =
      normalizeText($(element).attr('title')) ||
      normalizeText($(element).text()) ||
      normalizeText(path.basename(new URL(absoluteUrl).pathname));
    const looksLikeArticle = new URL(absoluteUrl).pathname.includes('/art/');
    const looksLikeReportPdf = isKnownAnnualReportPdfUrl(absoluteUrl);
    if (!isAnnualReportCandidate(title, absoluteUrl) && !(summaryPage && ((looksLikeArticle && title) || looksLikeReportPdf))) return;

    const key = absoluteUrl.split('#')[0];
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ url: key, title });
  });

  return {
    links: candidates.slice(0, limit),
    truncated: candidates.length > limit,
  };
}

function stripSiteSuffix(title: string): string {
  return normalizeText(
    title
      .replace(/[-_]{1,2}.+$/, '')
      .replace(/(淮安市人民政府|淮安市政府门户网站|政府网站)$/g, '')
  );
}

function extractYear(title: string, html: string, url: string, requestedYear?: number | null): number | null {
  if (requestedYear && Number.isInteger(requestedYear)) {
    return requestedYear;
  }

  const $ = cheerio.load(html);
  const haystack = `${title}\n${normalizeText($.root().text()).slice(0, 8000)}\n${url}`;
  const matches = Array.from(haystack.matchAll(/(20\d{2})\s*年?/g))
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2100);
  return matches[0] || null;
}

function extractUnitName(title: string, requestedUnitName?: string | null): string | null {
  const requested = normalizeText(requestedUnitName);
  if (requested) {
    return requested;
  }

  const cleanTitle = stripSiteSuffix(title);
  const compact = compactText(cleanTitle);
  const reportSuffixPattern = /(?:20\d{2}(?:年|年度)?)?(?:政府信息公开工作年度报告|政府信息公开年度报告|信息公开工作年度报告|信息公开年度报告|政府信息公开年报|年报)$/;
  const beforeSuffix = compact.replace(reportSuffixPattern, '');
  const beforeYear = compact.split(/20\d{2}年?/)[0];
  const candidate = normalizeText(beforeSuffix || beforeYear);

  if (!candidate || candidate.length < 2 || candidate.length > 80) {
    return null;
  }
  return candidate.replace(/^关于/, '').replace(/[：:，,。]+$/g, '') || null;
}

async function findReportRegionByUnit(unitName: string, year: number | null, allowedRegionIds: Set<number> | null): Promise<ResolvedRegion | null> {
  const compactUnitName = compactText(unitName);
  if (!compactUnitName || compactUnitName.length < 2) return null;

  const result = await pool.query(
    `SELECT r.region_id, reg.name AS region_name, r.year, r.unit_name
     FROM reports r
     JOIN regions reg ON reg.id = r.region_id
     WHERE LENGTH(REPLACE(REPLACE(COALESCE(r.unit_name, ''), ' ', ''), '　', '')) >= 2
       AND (
         REPLACE(REPLACE(r.unit_name, ' ', ''), '　', '') ILIKE $1
         OR $2 ILIKE '%' || REPLACE(REPLACE(r.unit_name, ' ', ''), '　', '') || '%'
       )
     ORDER BY CASE WHEN r.year = $3 THEN 0 ELSE 1 END,
              r.updated_at DESC NULLS LAST,
              r.id DESC
     LIMIT 10`,
    [`%${compactUnitName}%`, compactUnitName, year]
  );

  for (const row of result.rows) {
    const id = Number(row.region_id);
    if (allowedRegionIds && !allowedRegionIds.has(id)) continue;
    return { id, name: row.region_name };
  }
  return null;
}

async function findRegionByUnit(unitName: string, allowedRegionIds: Set<number> | null): Promise<ResolvedRegion | null> {
  const normalizedUnit = normalizeForMatch(unitName);
  if (!normalizedUnit) return null;

  const result = await pool.query('SELECT id, name, parent_id, level FROM regions ORDER BY id');
  const regions = result.rows.map((row: any) => ({
    id: Number(row.id),
    name: String(row.name || ''),
    parent_id: row.parent_id ? Number(row.parent_id) : null,
    level: Number(row.level || 0),
  }));
  const byId = new Map(regions.map((region) => [region.id, region]));

  let best: { id: number; name: string; score: number } | null = null;

  for (const region of regions) {
    if (allowedRegionIds && !allowedRegionIds.has(region.id)) continue;
    const normalizedRegion = normalizeForMatch(region.name);
    if (!normalizedRegion || normalizedRegion.length < 2) continue;

    let score = 0;
    if (normalizedUnit === normalizedRegion) {
      score += 100;
    } else if (normalizedUnit.includes(normalizedRegion)) {
      const isBroadAdministrativeNode = region.level <= 2;
      const isGovernmentBody =
        normalizedUnit === `${normalizedRegion}人民政府` ||
        normalizedUnit === `${normalizedRegion}政府办公室` ||
        normalizedUnit === `${normalizedRegion}政府办`;
      if (isBroadAdministrativeNode && !isGovernmentBody) {
        continue;
      }
      score += 40 + normalizedRegion.length;
    } else if (normalizedRegion.includes(normalizedUnit)) {
      score += 20 + normalizedUnit.length;
    } else {
      continue;
    }

    let parentId = region.parent_id;
    let depth = 0;
    while (parentId && byId.has(parentId) && depth < 8) {
      const parent = byId.get(parentId)!;
      const parentName = normalizeForMatch(parent.name);
      if (parentName && normalizedUnit.includes(parentName)) {
        score += 60 + parentName.length;
      }
      parentId = parent.parent_id;
      depth += 1;
    }

    score += region.level;

    if (!best || score > best.score) {
      best = { id: region.id, name: region.name, score };
    }
  }

  return best ? { id: best.id, name: best.name } : null;
}

async function resolveRegion(
  regionId: number | null | undefined,
  unitName: string | null,
  year: number | null,
  allowedRegionIds: Set<number> | null
): Promise<ResolvedRegion | null> {
  if (regionId && Number.isInteger(regionId)) {
    if (allowedRegionIds && !allowedRegionIds.has(regionId)) {
      return null;
    }
    const result = await pool.query('SELECT id, name FROM regions WHERE id = $1 LIMIT 1', [regionId]);
    const row = result.rows[0];
    return row ? { id: Number(row.id), name: String(row.name || '') } : null;
  }

  if (!unitName) {
    return null;
  }

  return (await findRegionByUnit(unitName, allowedRegionIds)) || (await findReportRegionByUnit(unitName, year, allowedRegionIds));
}

function addSourceMetadata(html: string, sourceUrl: string, title: string): string {
  const meta = `<!-- source_url: ${sourceUrl} -->\n<!-- source_title: ${title.replace(/-->/g, '')} -->\n`;
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([\s>])/i, `<html$1\n${meta}`);
  }
  return `${meta}${html}`;
}

function buildBatchUuid(sourceUrl: string): string {
  const hash = crypto.createHash('sha1').update(`${sourceUrl}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`).digest('hex');
  return `url_collection_${hash}`;
}

function buildSummary(items: UrlCollectionImportItem[], discovered: number) {
  return {
    discovered,
    downloaded: items.filter((item) => ['ready', 'queued', 'reused', 'pending_match'].includes(item.status)).length,
    matched: items.filter((item) => ['ready', 'queued', 'reused'].includes(item.status)).length,
    submitted: items.filter((item) => item.status === 'queued').length,
    reused: items.filter((item) => item.status === 'reused' || item.reused_job || item.reused_version).length,
    pending: items.filter((item) => item.status === 'pending_match').length,
    failed: items.filter((item) => item.status === 'failed').length,
  };
}

export class UrlCollectionImportService {
  async collectAndImport(options: UrlCollectionImportOptions): Promise<UrlCollectionImportResult> {
    const sourceUrl = normalizeText(options.url);
    if (!sourceUrl) {
      throw new Error('url_required');
    }

    const requestedMode = options.collectionMode || 'auto';
    const limit = Math.min(Math.max(Number(options.limit || DEFAULT_MAX_ITEMS), 1), MAX_MAX_ITEMS);
    const allowedRegionIds = Array.isArray(options.allowedRegionIds)
      ? new Set(options.allowedRegionIds.map(Number).filter((id) => Number.isInteger(id)))
      : null;
    const sourcePage = await fetchPage(sourceUrl);
    const resolvedMode: ResolvedCollectionMode = requestedMode === 'auto' ? inferUrlCollectionMode(sourcePage.finalUrl) : requestedMode;
    const batchUuid = buildBatchUuid(sourcePage.finalUrl);

    let candidates: CandidateLink[] = [];
    let truncated = false;
    if (resolvedMode === 'single') {
      const sourceKind = getFetchedFileKind(sourcePage);
      candidates = [
        {
          url: sourcePage.finalUrl,
          title:
            sourceKind === 'pdf'
              ? buildDirectFileTitle(sourcePage.finalUrl, options.year, options.unitName)
              : extractPageTitle(sourcePage.html, sourcePage.finalUrl),
        },
      ];
    } else {
      const extracted = extractCandidateLinks(sourcePage.html, sourcePage.finalUrl, limit);
      candidates = extracted.links;
      truncated = extracted.truncated;
    }

    const items: UrlCollectionImportItem[] = [];

    if (candidates.length === 0) {
      items.push({
        id: crypto.randomUUID(),
        title:
          getFetchedFileKind(sourcePage) === 'pdf'
            ? buildDirectFileTitle(sourcePage.finalUrl, options.year, options.unitName)
            : extractPageTitle(sourcePage.html, sourcePage.finalUrl) || '未发现年报链接',
        url: sourcePage.finalUrl,
        final_url: sourcePage.finalUrl,
        status: 'failed',
        message: resolvedMode === 'list' ? '未在该栏目页识别到政府信息公开年报链接' : '未能识别目标页面内容',
      });
    }

    for (const candidate of candidates) {
      try {
        const detailPage = resolvedMode === 'single' && candidate.url === sourcePage.finalUrl ? sourcePage : await fetchPage(candidate.url);
        const fileKind = getFetchedFileKind(detailPage);
        const title =
          fileKind === 'pdf'
            ? buildDirectFileTitle(detailPage.finalUrl, options.year, options.unitName)
            : stripSiteSuffix(extractPageTitle(detailPage.html, candidate.title));
        const directFileYear = fileKind === 'pdf' ? inferReportYearFromDirectFileUrl(detailPage.finalUrl) : null;
        const year = extractYear(title, detailPage.html, detailPage.finalUrl, options.year || directFileYear);
        const unitName = normalizeText(options.unitName) || (fileKind === 'pdf' ? extractUnitNameFromUrl(detailPage.finalUrl) : null) || extractUnitName(title);
        const region = await resolveRegion(options.regionId, unitName, year, allowedRegionIds);
        const fileExtension = getFileExtension(fileKind);

        const baseItem: UrlCollectionImportItem = {
          id: crypto.randomUUID(),
          title,
          url: candidate.url,
          final_url: detailPage.finalUrl,
          unit_name: unitName,
          year,
          region_id: region?.id || null,
          region_name: region?.name || null,
          file_name: buildSafeFileName(unitName, year, title, fileExtension),
          status: 'ready',
        };

        if (!year || !unitName || !region) {
          items.push({
            ...baseItem,
            status: 'pending_match',
            message: !region
              ? '未能自动匹配系统中的部门或区县，请人工确认单位'
              : !year
                ? '未能自动识别年份，请人工确认'
                : '未能自动识别单位名称，请人工确认',
          });
          continue;
        }

        if (options.dryRun) {
          items.push(baseItem);
          continue;
        }

        const fileName = baseItem.file_name || buildSafeFileName(unitName, year, title, fileExtension);
        const fileBuffer =
          fileKind === 'pdf' ? detailPage.buffer : Buffer.from(addSourceMetadata(detailPage.html, detailPage.finalUrl, title), 'utf8');
        await fsPromises.mkdir(UPLOADS_TMP_DIR, { recursive: true });
        const tempFilePath = path.join(UPLOADS_TMP_DIR, `url-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${fileExtension}`);

        try {
          await fsPromises.writeFile(tempFilePath, fileBuffer);
          const uploadResult = await reportUploadService.processUpload({
            regionId: region.id,
            year,
            unitName,
            tempFilePath,
            originalName: fileName,
            mimeType: getMimeType(fileKind),
            size: fileBuffer.length,
            model: options.model,
            batchUuid,
            sourceUrl: detailPage.finalUrl,
          });

          items.push({
            ...baseItem,
            status: uploadResult.reusedVersion || uploadResult.reusedJob ? 'reused' : 'queued',
            report_id: uploadResult.reportId,
            version_id: uploadResult.versionId,
            job_id: uploadResult.jobId,
            file_hash: uploadResult.fileHash,
            storage_path: uploadResult.storagePath,
            reused_version: uploadResult.reusedVersion,
            reused_job: uploadResult.reusedJob,
            message: uploadResult.reusedVersion || uploadResult.reusedJob ? '已存在相同来源内容，复用已有解析任务' : '已创建解析任务',
          });
        } finally {
          await fsPromises.unlink(tempFilePath).catch(() => undefined);
        }
      } catch (error: any) {
        items.push({
          id: crypto.randomUUID(),
          title: candidate.title || candidate.url,
          url: candidate.url,
          status: 'failed',
          message: error?.message || '采集失败',
        });
      }
    }

    const firstMatched = items.find((item) => item.region_name || item.unit_name);
    return {
      ok: true,
      dry_run: Boolean(options.dryRun),
      requested_mode: requestedMode,
      collection_mode: resolvedMode,
      source_url: sourceUrl,
      final_url: sourcePage.finalUrl,
      rule: {
        province: null,
        city: null,
        unit: firstMatched?.region_name || firstMatched?.unit_name || null,
        domain: new URL(sourcePage.finalUrl).hostname,
        page_type: resolvedMode === 'single' ? 'detail_page' : 'list_page',
        status: 'enabled',
      },
      summary: buildSummary(items, candidates.length),
      items,
      truncated,
      batch_uuid: batchUuid,
    };
  }
}

export const urlCollectionImportService = new UrlCollectionImportService();
