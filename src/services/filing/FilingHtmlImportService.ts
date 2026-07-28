import axios from 'axios';
import * as cheerio from 'cheerio';
import { validateRedirectURL, validateURLSecurity } from '../../utils/urlValidator';
import { tryParseTable2FromSourceText } from '../TableSectionScoring';
import { tryParseFlattenedTable4 } from '../SegmentedAnnualReportParse';
import {
  buildBlankAnnualReportForm,
  ensureSixSectionForm,
  validateFilingFormStructure,
} from './BlankTemplateService';
import { buildTable3Skeleton } from '../LlmCommon';

const REQUEST_TIMEOUT_MS = 30000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function hasAnnualReportMarkers(html: string): boolean {
  const raw = String(html || '');
  return (
    /一[、.．]\s*总体情况/.test(raw) ||
    /二[、.．]\s*主动公开/.test(raw) ||
    /本年新收政府信息公开申请/.test(raw) ||
    /收到和处理政府信息公开申请/.test(raw)
  );
}

/** Vue/React 壳页：首屏 HTML 无年报表格，正文靠 XHR 拉取 */
function looksLikeSpaShell(html: string): boolean {
  const raw = String(html || '');
  const compact = raw.replace(/\s+/g, ' ');
  if (hasAnnualReportMarkers(raw) && /<table[\s>]/i.test(raw)) return false;

  const spaSignals =
    /id=["'](?:app|container|root)["']/i.test(raw) ||
    /Please enable it to continue/i.test(raw) ||
    /chunk-vendors/i.test(raw) ||
    /window\.__INITIAL_STATE__/i.test(raw);
  const fewTables = (raw.match(/<table[\s>]/gi) || []).length <= 1;
  return spaSignals && fewTables && !hasAnnualReportMarkers(raw) && compact.length < 20000;
}

/**
 * 新点 WebBuilder 详情壳（虹口/静安/松江等）：
 * showinfo.html?infoGuid=uuid 或路径含 uuid，正文靠 rest getGovInfoDetail
 */
function looksLikeWebBuilderShell(html: string, pageUrl: string): boolean {
  if (hasAnnualReportMarkers(html)) return false;
  const raw = String(html || '');
  const urlHit =
    /(?:[?&](?:infoGuid|infoid|infoId)=|[\/-])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.test(
      pageUrl
    ) || /showinfo\.html/i.test(pageUrl);
  const pageHit =
    /info_spnContent|getGovInfoDetail|webBuilderCommon|gxhWebBuilderCommon|shhkZwgk|webbuilder\.get/i.test(
      raw
    );
  return urlHit && pageHit;
}

function extractInfoGuid(pageUrl: string, html?: string): string | null {
  try {
    const u = new URL(pageUrl);
    for (const key of ['infoGuid', 'infoid', 'infoId', 'id']) {
      const v = u.searchParams.get(key);
      if (v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
        return v;
      }
    }
    const pathMatch = u.pathname.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (pathMatch?.[1]) return pathMatch[1];
  } catch {
    /* ignore */
  }
  if (html) {
    const m = String(html).match(
      /(?:infoGuid|infoid|infoId)["'\s:=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    );
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractSiteInfoFromHtml(html: string): { siteGuid?: string; projectName?: string } {
  const raw = String(html || '');
  const block =
    raw.match(/var\s+siteInfo\s*=\s*(\{[\s\S]*?\})\s*;/i)?.[1] ||
    raw.match(/siteInfo\s*=\s*(\{[\s\S]*?\})\s*;/i)?.[1] ||
    '';
  const siteGuid = block.match(/["']?siteGuid["']?\s*:\s*["']([^"']+)["']/i)?.[1];
  const projectName = block.match(/["']?projectName["']?\s*:\s*["']([^"']+)["']/i)?.[1];
  return { siteGuid, projectName };
}

function extractProjectNameFromScripts(html: string): string | null {
  const raw = String(html || '');
  const m = raw.match(/["'](\/[^"']+)["']\s*\+\s*["']\/rest\//i);
  if (m?.[1]) return m[1];
  const m2 = raw.match(/projectName["']?\s*:\s*["'](\/[^"']+)["']/i);
  return m2?.[1] || null;
}

/**
 * 奉贤等上海区县政务公开 SPA：/art/info/:columnId/:artId
 * 正文接口 POST {origin}/html/info/detail  (x-www-form-urlencoded id=artId)
 */
function extractSpaArticleId(pageUrl: string): { artId: string; origin: string } | null {
  try {
    const u = new URL(pageUrl);
    const m = u.pathname.match(/\/art\/info\/[^/]+\/([^/]+)\/?$/i);
    if (m?.[1]) {
      return { artId: decodeURIComponent(m[1]), origin: u.origin };
    }
    // 兜底：路径末段形如 i20260109-xxxx
    const tail = u.pathname.split('/').filter(Boolean).pop() || '';
    if (/^i[0-9a-z-]{8,}$/i.test(tail)) {
      return { artId: tail, origin: u.origin };
    }
  } catch {
    /* ignore */
  }
  return null;
}

type SpaArticlePayload = { html: string; title?: string | null; dept?: string | null };

async function fetchSpaArticleHtml(
  pageUrl: string,
  artId: string,
  origin: string
): Promise<SpaArticlePayload | null> {
  const detailUrl = `${origin}/html/info/detail`;
  const security = await validateURLSecurity(detailUrl);
  if (!security.valid) return null;

  try {
    const response = await axios.post(detailUrl, new URLSearchParams({ id: artId }).toString(), {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_PAGE_BYTES,
      maxBodyLength: MAX_PAGE_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: pageUrl,
        Origin: origin,
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const payload = response.data;
    if (!payload || payload.success === false) return null;
    const data = payload.data ?? payload;
    const body = data?.body ?? data?.content ?? data?.html ?? data?.infoContent ?? null;
    if (typeof body === 'string' && body.replace(/\s+/g, '').length > 50) {
      const title =
        (typeof data?.title === 'string' && data.title.trim()) ||
        (typeof data?.name === 'string' && data.name.trim()) ||
        (typeof data?.infoTitle === 'string' && data.infoTitle.trim()) ||
        null;
      const dept =
        (typeof data?.dept === 'string' && data.dept.trim()) ||
        (typeof data?.publisher === 'string' && data.publisher.trim()) ||
        null;
      return { html: body, title, dept };
    }
  } catch {
    return null;
  }
  return null;
}

/** 从标题/正文/域名推断单位名（批量匹配用） */
export function inferUnitNameFromPage(params: {
  pageTitle?: string | null;
  html?: string;
  pageUrl?: string;
  dept?: string | null;
}): string | null {
  const title = String(params.pageTitle || '').trim();
  if (title) {
    const fromTitle = title
      .replace(/[-_]{1,2}.+$/, '')
      .replace(/(市政府门户网站|人民政府网站|政府网站)$/g, '')
      .replace(
        /(?:20\d{2}\s*年(?:度)?)?(?:政府信息公开工作年度报告|政府信息公开年度报告|信息公开工作年度报告|信息公开年度报告|政府信息公开年报|年度报告|年报)\s*$/g,
        ''
      )
      .replace(/20\d{2}\s*年(?:度)?/g, '')
      .replace(/^关于/, '')
      .replace(/[：:，,。\s]+$/g, '')
      .trim();
    if (fromTitle.length >= 2 && fromTitle.length <= 80) return fromTitle;
  }
  const dept = String(params.dept || '').trim();
  if (dept.length >= 2 && dept.length <= 80) return dept;

  const html = String(params.html || '');
  if (html) {
    const $ = cheerio.load(html);
    const h1 = String($('h1').first().text() || '').trim();
    if (h1.length >= 4) {
      const cleaned = h1
        .replace(
          /(?:20\d{2}\s*年(?:度)?)?(?:政府信息公开工作年度报告|政府信息公开年度报告|信息公开工作年度报告|年报)\s*$/g,
          ''
        )
        .replace(/20\d{2}\s*年(?:度)?/g, '')
        .trim();
      if (cleaned.length >= 2 && cleaned.length <= 80) return cleaned;
    }
    // 正文常见：「2025年，区经济委员会…」
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = plain.match(
      /20\d{2}\s*年[，,\s]{0,4}([\u4e00-\u9fa5A-Za-z0-9（）()]{2,40}?(?:委员会|管理局|局|办公室|政府|街道|镇))/
    );
    if (m?.[1]) return m[1].replace(/^我[局委厅部]$/, '').trim() || m[1];
  }
  return null;
}

type WebBuilderFetchResult =
  | { kind: 'html'; html: string }
  | { kind: 'pdf_only'; title?: string; attachName?: string }
  | { kind: 'none' };

function hostProjectNameGuesses(hostname: string): string[] {
  const h = hostname.toLowerCase();
  const guesses: string[] = [];
  if (h.includes('shhk') || h.includes('hongkou')) guesses.push('/shhk-zwgk', '/shhk-zwgks-interface');
  if (h.includes('jingan')) guesses.push('/shja-cms');
  if (h.includes('songjiang')) guesses.push('/shsj-application-front');
  if (h.includes('shcm') || h.includes('chongming')) guesses.push('/shcm-application-front', '/shcm-cms');
  if (h.includes('shyp') || h.includes('yangpu')) guesses.push('/shyp-application-front');
  if (h.includes('shpt') || h.includes('putuo')) guesses.push('/shpt-application-front');
  if (h.includes('shmh') || h.includes('minhang')) guesses.push('/shmh-application-front');
  if (h.includes('shbs') || h.includes('baoshan')) guesses.push('/shbs-application-front');
  guesses.push('/EpointWebBuilder', '');
  return [...new Set(guesses.filter((x) => x !== undefined))];
}

function detailActionPaths(projectName: string): string[] {
  const base = projectName.replace(/\/$/, '');
  const actions = [
    '/rest/shhkZwgkFrontAppNotNeedLoginAction/getGovInfoDetail',
    '/rest/commonapiaction/getgovinfodetail',
    '/rest/zdjceapiaction/getgovinfodetail',
    '/rest/frontAppNotNeedLoginAction/getGovInfoDetail',
    '/rest/frontAppNotNeedLoginAction/getOneArchiveInformation',
  ];
  return actions.map((a) => `${base}${a}`);
}

async function postWebBuilderParams(
  apiUrl: string,
  pageUrl: string,
  params: Record<string, string>
): Promise<any | null> {
  const security = await validateURLSecurity(apiUrl);
  if (!security.valid) return null;
  const origin = new URL(pageUrl).origin;
  const body = new URLSearchParams({ params: JSON.stringify(params) }).toString();
  try {
    const response = await axios.post(apiUrl, body, {
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_PAGE_BYTES,
      maxBodyLength: MAX_PAGE_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: pageUrl,
        Origin: origin,
        'X-Requested-With': 'XMLHttpRequest',
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  } catch {
    return null;
  }
}

function pickWebBuilderData(payload: any): any | null {
  if (!payload || typeof payload !== 'object') return null;
  const custom = payload.custom ?? payload;
  if (custom?.status === 'false' || custom?.status === false) return null;
  if (custom?.data && typeof custom.data === 'object') return custom.data;
  if (custom?.infocontent || custom?.title || custom?.infotype) return custom;
  return null;
}

async function fetchWebBuilderArticle(
  pageUrl: string,
  html: string,
  infoGuid: string
): Promise<WebBuilderFetchResult> {
  const origin = new URL(pageUrl).origin;
  const site = extractSiteInfoFromHtml(html);
  const projectFromHtml = site.projectName || extractProjectNameFromScripts(html);
  const projectNames = [
    ...(projectFromHtml ? [projectFromHtml] : []),
    ...hostProjectNameGuesses(new URL(pageUrl).hostname),
  ];
  const uniqueProjects = [...new Set(projectNames.map((p) => (p.startsWith('/') ? p : `/${p}`)))];

  for (const project of uniqueProjects) {
    for (const actionPath of detailActionPaths(project)) {
      const apiUrl = `${origin}${actionPath}`;
      const paramVariants: Record<string, string>[] = [
        { infoid: infoGuid },
        { infoGuid: infoGuid },
        { id: infoGuid },
      ];
      if (site.siteGuid) {
        paramVariants.push(
          { siteGuid: site.siteGuid, infoid: infoGuid },
          { siteGuid: site.siteGuid, infoGuid: infoGuid }
        );
      }
      for (const params of paramVariants) {
        const payload = await postWebBuilderParams(apiUrl, pageUrl, params);
        const data = pickWebBuilderData(payload);
        if (!data) continue;

        const content =
          data.infocontent ||
          data.infoContent ||
          data.content ||
          data.html ||
          data.body ||
          '';
        if (typeof content === 'string' && content.replace(/\s+/g, '').length > 50) {
          return { kind: 'html', html: content };
        }

        const infotype = String(data.infotype || data.infoType || '').toLowerCase();
        const pdfList = data.pdflist || data.pdfList || data.attach || data.attachlist || [];
        const hasPdf =
          infotype === 'pdf' ||
          (Array.isArray(pdfList) &&
            pdfList.some(
              (a: any) =>
                String(a?.attachtype || a?.attachType || '').toLowerCase() === 'pdf' ||
                /\.pdf$/i.test(String(a?.attachname || a?.attachName || a?.attachurl || ''))
            ));
        if (hasPdf) {
          const first = Array.isArray(pdfList) ? pdfList[0] : null;
          return {
            kind: 'pdf_only',
            title: data.title,
            attachName: first?.attachname || first?.attachName,
          };
        }
      }
    }
  }
  return { kind: 'none' };
}

/** 列表页仅有 CMS 动态加载、无年报正文 */
function looksLikeCmsListShell(html: string): boolean {
  const raw = String(html || '');
  if (hasAnnualReportMarkers(raw)) return false;
  return (
    (/new\s+CMS\s*\(/i.test(raw) || /\/front\/api\/data\/(?:search|affair)/i.test(raw)) &&
    /columnlist|v-for\s*=\s*["']item\s+in\s+list["']/i.test(raw)
  );
}

function countNumericCellsDeep(obj: any): number {
  let n = 0;
  const walk = (v: any) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) n += 1;
      return;
    }
    if (typeof v === 'string') {
      if (parseNumberCell(v) !== null) n += 1;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(obj);
  return n;
}

export interface FilingHtmlImportStats {
  text1Chars: number;
  text5Chars: number;
  text6Chars: number;
  table2Filled: number;
  table3Filled: number;
  table4Filled: number;
  tablesFound: number;
  warnings: string[];
}

export interface FilingHtmlImportResult {
  form_json: Record<string, any>;
  finalUrl: string;
  stats: FilingHtmlImportStats;
  /** 页面/接口标题（用于单位匹配；SPA 站点尤其依赖） */
  pageTitle?: string | null;
}

type Matrix = string[][];

function parseNumberCell(raw: string | null | undefined): number | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim().replace(/,/g, '').replace(/，/g, '');
  if (!s || /^[-–—/／:：]+$/.test(s)) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function coalesceNum(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = parseNumberCell(String(v));
  return n === null ? 0 : n;
}

function tableToMatrix($: any, table: any): Matrix {
  const matrix: (string | null)[][] = [];
  $(table)
    .find('tr')
    .each((rowIdx: number, tr: any) => {
      if (!matrix[rowIdx]) matrix[rowIdx] = [];
      let colIdx = 0;
      $(tr)
        .find('td, th')
        .each((_: number, cell: any) => {
          const $cell = $(cell);
          const text = $cell.text().trim().replace(/\s+/g, ' ');
          const colspan = parseInt($cell.attr('colspan') || '1', 10);
          const rowspan = parseInt($cell.attr('rowspan') || '1', 10);
          while (matrix[rowIdx][colIdx] !== undefined) {
            colIdx += 1;
          }
          for (let c = 0; c < colspan; c += 1) {
            for (let r = 0; r < rowspan; r += 1) {
              if (!matrix[rowIdx + r]) matrix[rowIdx + r] = [];
              matrix[rowIdx + r][colIdx + c] = r === 0 && c === 0 ? text : '';
            }
          }
          colIdx += colspan;
        });
    });

  return matrix.map((row) => {
    const cells = row.map((c) => String(c ?? '').trim());
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells;
  });
}

function matrixToMarkdown(matrix: Matrix): string {
  if (!matrix.length) return '';
  const maxCols = Math.max(...matrix.map((r) => r.length), 0);
  const lines: string[] = [];
  for (let i = 0; i < matrix.length; i += 1) {
    const row = [...matrix[i]];
    while (row.length < maxCols) row.push('');
    lines.push('| ' + row.join(' | ') + ' |');
    if (i === 0) {
      lines.push('|' + row.map(() => '---').join('|') + '|');
    }
  }
  return lines.join('\n');
}

function identifyTableKind(matrix: Matrix): 'table_2' | 'table_3' | 'table_4' | null {
  const flat = matrix.map((r) => r.join(' ')).join(' ');
  if (
    (flat.includes('行政复议') && flat.includes('行政诉讼')) ||
    (flat.includes('未经复议') && flat.includes('复议后'))
  ) {
    return 'table_4';
  }
  if (
    flat.includes('本年新收') ||
    flat.includes('上年结转') ||
    (flat.includes('予以公开') && flat.includes('自然人'))
  ) {
    return 'table_3';
  }
  if (
    flat.includes('规章') ||
    flat.includes('规范性文件') ||
    flat.includes('行政许可') ||
    flat.includes('第二十条')
  ) {
    return 'table_2';
  }
  return null;
}

function countFilledDeep(obj: any): number {
  let n = 0;
  const walk = (v: any) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') {
      if (Number.isFinite(v) && v !== 0) n += 1;
      return;
    }
    if (typeof v === 'string') {
      const num = parseNumberCell(v);
      if (num !== null && num !== 0) n += 1;
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      Object.values(v).forEach(walk);
    }
  };
  walk(obj);
  return n;
}

function normalizeTable2(raw: Record<string, any> | null): Record<string, any> {
  const blank = buildBlankAnnualReportForm().sections[1].activeDisclosureData;
  if (!raw) return blank;
  return {
    regulations: {
      made: coalesceNum(raw.regulations?.made),
      repealed: coalesceNum(raw.regulations?.repealed),
      valid: coalesceNum(raw.regulations?.valid),
    },
    normativeDocuments: {
      made: coalesceNum(raw.normativeDocuments?.made),
      repealed: coalesceNum(raw.normativeDocuments?.repealed),
      valid: coalesceNum(raw.normativeDocuments?.valid),
    },
    licensing: { processed: coalesceNum(raw.licensing?.processed) },
    punishment: { processed: coalesceNum(raw.punishment?.processed) },
    coercion: { processed: coalesceNum(raw.coercion?.processed) },
    fees: { amount: coalesceNum(raw.fees?.amount) },
  };
}

/** Map table_3 matrix: last 7 numeric columns = NP + 5 legal + total */
function parseTable3FromMatrix(matrix: Matrix): Record<string, any> {
  const data = buildTable3Skeleton();
  const colKeys = [
    'naturalPerson',
    'legalPerson.commercial',
    'legalPerson.research',
    'legalPerson.social',
    'legalPerson.legal',
    'legalPerson.other',
    'total',
  ] as const;

  const getEntity = (path: string) => {
    if (path === 'naturalPerson') return data.naturalPerson;
    if (path === 'total') return data.total;
    const key = path.replace('legalPerson.', '');
    return data.legalPerson[key];
  };

  const setPath = (entity: any, fieldPath: string, value: number) => {
    const parts = fieldPath.split('.');
    let cur = entity;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  };

  type RowRule = { test: (label: string) => boolean; path: string };
  const rules: RowRule[] = [
    { test: (l) => /本年新收/.test(l), path: 'newReceived' },
    { test: (l) => /上年结转/.test(l), path: 'carriedOver' },
    { test: (l) => /予以公开/.test(l) && !/部分/.test(l), path: 'results.granted' },
    { test: (l) => /部分公开/.test(l), path: 'results.partialGrant' },
    { test: (l) => /国家秘密/.test(l), path: 'results.denied.stateSecret' },
    {
      test: (l) => /其他法律|行政法规禁止|法律行政法规禁止/.test(l),
      path: 'results.denied.lawForbidden',
    },
    { test: (l) => /三安全一稳定|危及/.test(l), path: 'results.denied.safetyStability' },
    { test: (l) => /第三方合法权益|保护第三方/.test(l), path: 'results.denied.thirdPartyRights' },
    { test: (l) => /内部事务/.test(l), path: 'results.denied.internalAffairs' },
    { test: (l) => /过程性信息/.test(l), path: 'results.denied.processInfo' },
    { test: (l) => /行政执法案卷/.test(l), path: 'results.denied.enforcementCase' },
    { test: (l) => /行政查询/.test(l), path: 'results.denied.adminQuery' },
    {
      test: (l) => /不掌握|本机关不掌握/.test(l),
      path: 'results.unableToProvide.noInfo',
    },
    {
      test: (l) => /另行制作|没有现成信息/.test(l),
      path: 'results.unableToProvide.needCreation',
    },
    {
      test: (l) => /仍不明确|补正后申请内容/.test(l),
      path: 'results.unableToProvide.unclear',
    },
    {
      test: (l) => /信访|举报投诉/.test(l),
      path: 'results.notProcessed.complaint',
    },
    { test: (l) => /重复申请/.test(l), path: 'results.notProcessed.repeat' },
    {
      test: (l) => /公开出版物|提供公开出版物/.test(l),
      path: 'results.notProcessed.publication',
    },
    {
      test: (l) => /大量反复|无正当理由大量/.test(l),
      path: 'results.notProcessed.massiveRequests',
    },
    {
      test: (l) => /确认或重新出具|重新出具已获取/.test(l),
      path: 'results.notProcessed.confirmInfo',
    },
    {
      test: (l) => /逾期不补正|不再处理其政府信息公开申请/.test(l) && /补正/.test(l),
      path: 'results.other.overdueCorrection',
    },
    {
      test: (l) => /缴纳费用|收费通知/.test(l),
      path: 'results.other.overdueFee',
    },
    {
      test: (l) => /3[.、．]?\s*其他/.test(l) && !/法律|行政|处理/.test(l.replace(/3[.、．]?\s*其他.*/, '')),
      path: 'results.other.otherReasons',
    },
    {
      test: (l) => /（七）\s*总计|办理结果总计|（七）总计/.test(l),
      path: 'results.totalProcessed',
    },
    {
      test: (l) => /结转下年度|四、结转/.test(l),
      path: 'results.carriedForward',
    },
  ];

  for (const row of matrix) {
    if (!row.length) continue;
    // Find trailing numeric run of length 7 (or at least 7 cells at end that look numeric)
    let dataStart = -1;
    for (let i = 0; i <= row.length - 7; i += 1) {
      const slice = row.slice(i, i + 7);
      const nums = slice.map(parseNumberCell);
      if (nums.every((n) => n !== null)) {
        dataStart = i;
      }
    }
    if (dataStart < 0) continue;

    const label = row
      .slice(0, dataStart)
      .join('')
      .replace(/\s+/g, '');
    if (!label || /申请人情况|自然人|法人或其他组织|商业企业|科研机构/.test(label)) {
      // header-ish
      if (!/本年新收|上年结转|予以公开|部分公开|不予公开|无法提供|不予处理|其他处理|总计|结转/.test(label)) {
        continue;
      }
    }

    const values = row.slice(dataStart, dataStart + 7).map((c) => coalesceNum(c));
    const matched = rules.find((r) => r.test(label));
    if (!matched) {
      // special: pure "3.其他" under 其他处理
      if (/^3\.?其他$/.test(label) || label.endsWith('3.其他') || label === '其他') {
        // only if parent context suggests otherReasons - if label is just 其他 and short
        if (label.includes('3') || label === '其他') {
          for (let i = 0; i < 7; i += 1) {
            setPath(getEntity(colKeys[i]), 'results.other.otherReasons', values[i]);
          }
        }
      }
      continue;
    }

    // Avoid matching bare "总计" in header
    if (matched.path === 'results.totalProcessed' && /申请人/.test(label)) continue;

    for (let i = 0; i < 7; i += 1) {
      setPath(getEntity(colKeys[i]), matched.path, values[i]);
    }
  }

  return data;
}

function parseTable4FromMatrix(matrix: Matrix): Record<string, any> {
  const blank = buildBlankAnnualReportForm().sections[3].reviewLitigationData;

  // Prefer last row with 15 consecutive numbers
  for (let r = matrix.length - 1; r >= 0; r -= 1) {
    const row = matrix[r];
    const nums: number[] = [];
    for (const cell of row) {
      const n = parseNumberCell(cell);
      if (n !== null) nums.push(n);
    }
    if (nums.length >= 15) {
      const c = nums.slice(0, 15);
      return {
        review: {
          maintain: c[0],
          correct: c[1],
          other: c[2],
          unfinished: c[3],
          total: c[4],
        },
        litigationDirect: {
          maintain: c[5],
          correct: c[6],
          other: c[7],
          unfinished: c[8],
          total: c[9],
        },
        litigationPostReview: {
          maintain: c[10],
          correct: c[11],
          other: c[12],
          unfinished: c[13],
          total: c[14],
        },
      };
    }
  }

  // Fallback: flattened markdown parser
  const md = matrixToMarkdown(matrix);
  const flat = tryParseFlattenedTable4(md);
  if (flat) {
    return {
      review: {
        maintain: coalesceNum(flat.review?.maintain),
        correct: coalesceNum(flat.review?.correct),
        other: coalesceNum(flat.review?.other),
        unfinished: coalesceNum(flat.review?.unfinished),
        total: coalesceNum(flat.review?.total),
      },
      litigationDirect: {
        maintain: coalesceNum(flat.litigationDirect?.maintain),
        correct: coalesceNum(flat.litigationDirect?.correct),
        other: coalesceNum(flat.litigationDirect?.other),
        unfinished: coalesceNum(flat.litigationDirect?.unfinished),
        total: coalesceNum(flat.litigationDirect?.total),
      },
      litigationPostReview: {
        maintain: coalesceNum(flat.litigationPostReview?.maintain),
        correct: coalesceNum(flat.litigationPostReview?.correct),
        other: coalesceNum(flat.litigationPostReview?.other),
        unfinished: coalesceNum(flat.litigationPostReview?.unfinished),
        total: coalesceNum(flat.litigationPostReview?.total),
      },
    };
  }

  return blank;
}

function cleanBodyText(raw: string): string {
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextSections(fullText: string): { s1: string; s5: string; s6: string } {
  const text = cleanBodyText(fullText);
  // Match full section titles so leftover title tails (e.g. 「及改进情况」) are not kept in body.
  const markers = [
    { key: 's1', re: /一[、.．]\s*总体情况[^\n]{0,40}/ },
    { key: 's2', re: /二[、.．]\s*主动公开政府信息情况[^\n]{0,40}|二[、.．]\s*主动公开[^\n]{0,40}/ },
    { key: 's3', re: /三[、.．]\s*收到和处理政府信息公开申请情况[^\n]{0,40}|三[、.．]\s*收到和处理[^\n]{0,40}/ },
    {
      key: 's4',
      re: /四[、.．]\s*政府信息公开行政复议[、，,]?行政诉讼情况[^\n]{0,40}|四[、.．]\s*行政复议[^\n]{0,40}/,
    },
    {
      key: 's5',
      re: /五[、.．]\s*存在(的主要)?问题及改进情况[^\n]{0,40}|五[、.．]\s*存在(的主要)?问题[^\n]{0,40}/,
    },
    { key: 's6', re: /六[、.．]\s*其他需要报告的事项[^\n]{0,40}|六[、.．]\s*其他需要报告[^\n]{0,40}/ },
  ] as const;

  const hits: { key: string; index: number; end: number }[] = [];
  for (const m of markers) {
    const match = m.re.exec(text);
    if (match) {
      hits.push({ key: m.key, index: match.index, end: match.index + match[0].length });
    }
  }
  hits.sort((a, b) => a.index - b.index);

  const sliceBetween = (startKey: string, endKey?: string): string => {
    const start = hits.find((h) => h.key === startKey);
    if (!start) return '';
    const end = endKey ? hits.find((h) => h.key === endKey && h.index > start.index) : undefined;
    const body = text.slice(start.end, end ? end.index : text.length);
    return cleanBodyText(body)
      .replace(/^(时间|来源|浏览次数)[：:].*$/gm, '')
      .replace(/关闭\.png|打印\.png/g, '')
      .trim();
  };

  return {
    s1: sliceBetween('s1', 's2'),
    s5: sliceBetween('s5', 's6'),
    s6: sliceBetween('s6'),
  };
}

function stripTablesForText($root: any): string {
  const clone = cheerio.load($root.root().html() || '');
  clone('script, style, noscript, iframe, svg').remove();
  clone('table').remove();
  clone('br').replaceWith('\n');
  clone('p, div, h1, h2, h3, h4, li, tr, section, article').each((_: number, el: any) => {
    clone(el).prepend('\n').append('\n');
  });
  return cleanBodyText(clone.root().text());
}

function pickContentRoot($: any): any {
  const selectors = [
    '#zoom',
    '.article-content',
    '.TRS_Editor',
    '.trs_editor_view',
    '.content',
    '.article',
    '#content',
    '.xxgk-content',
    '.pages_content',
    'article',
  ];
  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().replace(/\s+/g, '').length > 200) {
      return cheerio.load(el.html() || '');
    }
  }
  // Fallback: body
  return cheerio.load($('body').html() || $.root().html() || '');
}

/**
 * Pure rule-based HTML → filing form_json (no AI).
 */
export function parseAnnualReportHtmlToForm(
  html: string,
  options?: { year?: number; unitName?: string; regionId?: number }
): { form_json: Record<string, any>; stats: FilingHtmlImportStats } {
  const warnings: string[] = [];
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  const $content = pickContentRoot($);
  const tables = $content('table').toArray();
  const byKind: Partial<Record<'table_2' | 'table_3' | 'table_4', Matrix>> = {};

  for (const table of tables) {
    const matrix = tableToMatrix($content, table);
    const kind = identifyTableKind(matrix);
    if (!kind) continue;
    // Prefer larger / first meaningful table of each kind
    if (!byKind[kind] || matrix.length > (byKind[kind]?.length || 0)) {
      byKind[kind] = matrix;
    }
  }

  let table2 = normalizeTable2(null);
  if (byKind.table_2) {
    // Prefer direct matrix mapping (preserves explicit 0 cells).
    const fromMatrix: any = normalizeTable2(null);
    for (const row of byKind.table_2) {
      const label = (row[0] || '').replace(/\s+/g, '');
      if (/规章/.test(label) && !/规范/.test(label) && row.length >= 4) {
        fromMatrix.regulations = {
          made: coalesceNum(row[1]),
          repealed: coalesceNum(row[2]),
          valid: coalesceNum(row[3]),
        };
      } else if (/规范性文件/.test(label) && row.length >= 4) {
        fromMatrix.normativeDocuments = {
          made: coalesceNum(row[1]),
          repealed: coalesceNum(row[2]),
          valid: coalesceNum(row[3]),
        };
      } else if (/行政许可/.test(label)) {
        fromMatrix.licensing.processed = coalesceNum(row[1]);
      } else if (/行政处罚/.test(label)) {
        fromMatrix.punishment.processed = coalesceNum(row[1]);
      } else if (/行政强制/.test(label)) {
        fromMatrix.coercion.processed = coalesceNum(row[1]);
      } else if (/行政事业性收费/.test(label)) {
        fromMatrix.fees.amount = coalesceNum(row[1]);
      }
    }
    if (countNumericCellsDeep(fromMatrix) > 0) {
      table2 = fromMatrix;
    } else {
      const md = matrixToMarkdown(byKind.table_2);
      table2 = normalizeTable2(tryParseTable2FromSourceText(md));
    }
  } else {
    warnings.push('未识别到表二（主动公开）');
  }

  let table3 = buildTable3Skeleton();
  if (byKind.table_3) {
    table3 = parseTable3FromMatrix(byKind.table_3);
  } else {
    warnings.push('未识别到表三（依申请公开）');
  }

  let table4 = buildBlankAnnualReportForm().sections[3].reviewLitigationData;
  if (byKind.table_4) {
    table4 = parseTable4FromMatrix(byKind.table_4);
  } else {
    warnings.push('未识别到表四（复议诉讼）');
  }

  const textBody = stripTablesForText($content);
  const texts = extractTextSections(textBody);
  if (!texts.s1) warnings.push('未抽取到「一、总体情况」正文');
  if (!texts.s5) warnings.push('未抽取到「五、存在问题」正文');
  if (!texts.s6) warnings.push('未抽取到「六、其他事项」正文');

  const blank = buildBlankAnnualReportForm(options);
  const form_json = ensureSixSectionForm(
    {
      ...blank,
      sections: [
        { title: blank.sections[0].title, type: 'text', content: texts.s1 },
        { title: blank.sections[1].title, type: 'table_2', activeDisclosureData: table2 },
        { title: blank.sections[2].title, type: 'table_3', tableData: table3 },
        { title: blank.sections[3].title, type: 'table_4', reviewLitigationData: table4 },
        { title: blank.sections[4].title, type: 'text', content: texts.s5 },
        { title: blank.sections[5].title, type: 'text', content: texts.s6 },
      ],
    },
    options
  );

  const structure = validateFilingFormStructure(form_json);
  if (!structure.ok) {
    warnings.push(...structure.errors);
  }

  const stats: FilingHtmlImportStats = {
    text1Chars: texts.s1.length,
    text5Chars: texts.s5.length,
    text6Chars: texts.s6.length,
    table2Filled: countFilledDeep(table2),
    table3Filled: countFilledDeep(table3),
    table4Filled: countFilledDeep(table4),
    tablesFound: tables.length,
    warnings,
  };

  return { form_json, stats };
}

function decodePageBuffer(buffer: Buffer, contentType: string): string {
  const head = buffer.subarray(0, 4096).toString('binary');
  const fromContentType = /charset\s*=\s*([^;]+)/i.exec(contentType || '')?.[1];
  const fromMeta = /charset\s*=\s*["']?([a-zA-Z0-9_-]+)/i.exec(head)?.[1];
  const encoding = String(fromContentType || fromMeta || 'utf-8').trim().toLowerCase();
  const normalized = ['gbk', 'gb2312', 'gb18030'].includes(encoding) ? 'gbk' : encoding;
  try {
    return new TextDecoder(normalized as any).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

async function fetchHtmlPage(url: string, redirectDepth = 0): Promise<{ html: string; finalUrl: string }> {
  const security = await validateURLSecurity(url);
  if (!security.valid) {
    const err: any = new Error(security.error || 'url_security_rejected');
    err.code = 'URL_SECURITY_REJECTED';
    throw err;
  }

  let response;
  try {
    response = await axios.get(url, {
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
  } catch (e: any) {
    const err: any = new Error(e?.message || 'fetch_failed');
    err.code = 'URL_FETCH_FAILED';
    throw err;
  }

  if (response.status >= 300 && response.status < 400) {
    if (redirectDepth >= MAX_REDIRECTS) {
      const err: any = new Error('redirect_limit_exceeded');
      err.code = 'URL_REDIRECT_LIMIT';
      throw err;
    }
    const location = response.headers.location;
    if (!location) {
      const err: any = new Error('redirect_without_location');
      err.code = 'URL_REDIRECT_INVALID';
      throw err;
    }
    const redirectUrl = new URL(location, url).toString();
    const redirectValidation = await validateRedirectURL(url, redirectUrl);
    if (!redirectValidation.valid) {
      const err: any = new Error(redirectValidation.error || 'redirect_security_rejected');
      err.code = 'URL_SECURITY_REJECTED';
      throw err;
    }
    return fetchHtmlPage(redirectUrl, redirectDepth + 1);
  }

  const contentType = String(response.headers['content-type'] || '');
  if (/application\/pdf/i.test(contentType) || /\.pdf(\?|#|$)/i.test(url)) {
    const err: any = new Error(
      '该链接直接指向 PDF 文件，规则 HTML 导入无法解析。请改用含表格的 HTML 年报页，或走上传/AI 采集'
    );
    err.code = 'IMPORT_PDF_ONLY';
    throw err;
  }
  if (contentType && !/html|xml|text\/plain/i.test(contentType) && !/octet-stream/i.test(contentType)) {
    const err: any = new Error(`不支持的内容类型: ${contentType}（仅支持 HTML 年报页面）`);
    err.code = 'URL_UNSUPPORTED_CONTENT';
    throw err;
  }

  const buffer = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  const html = decodePageBuffer(buffer, contentType);
  const finalUrl = response.request?.res?.responseUrl || url;
  return { html, finalUrl };
}

export async function importFilingFormFromUrl(
  url: string,
  options?: { year?: number; unitName?: string; regionId?: number }
): Promise<FilingHtmlImportResult> {
  const trimmed = String(url || '').trim();
  if (!trimmed) {
    const err: any = new Error('url 必填');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    const err: any = new Error('URL 格式无效');
    err.code = 'INVALID_URL';
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err: any = new Error('仅支持 http/https');
    err.code = 'INVALID_URL';
    throw err;
  }

  let { html, finalUrl } = await fetchHtmlPage(trimmed);
  const pageUrl = finalUrl || trimmed;
  let pageTitle: string | null = null;
  let pageDept: string | null = null;

  // 年报列表壳（长宁/普陀/金山 CMS）：仅栏目列表，无文章正文
  if (looksLikeCmsListShell(html) && !hasAnnualReportMarkers(html)) {
    const err: any = new Error(
      '该链接是年报列表页（动态加载列表），不是单篇年报正文。请打开具体「××年政府信息公开工作年度报告」文章页后再导入'
    );
    err.code = 'IMPORT_LIST_PAGE';
    throw err;
  }

  // SPA 站点（如奉贤 xxgk）：首屏无正文，改走同站详情接口拉 body HTML
  if (looksLikeSpaShell(html)) {
    const spa = extractSpaArticleId(pageUrl);
    if (spa) {
      const article = await fetchSpaArticleHtml(pageUrl, spa.artId, spa.origin);
      if (article?.html) {
        html = article.html;
        pageTitle = article.title || null;
        pageDept = article.dept || null;
      } else {
        const err: any = new Error(
          '该链接为前端渲染页面，未能通过公开接口拉取正文。请打开页面后复制正文/表格粘贴，或换用含完整 HTML 表格的链接（如杭州门户静态页）'
        );
        err.code = 'IMPORT_SPA_UNSUPPORTED';
        throw err;
      }
    } else {
      const err: any = new Error(
        '该链接为前端渲染页面且无法识别文章 ID，规则导入无法读取动态正文。请换用静态 HTML 年报页，或手工粘贴表格'
      );
      err.code = 'IMPORT_SPA_UNSUPPORTED';
      throw err;
    }
  } else {
    // 静态页：从 title / h1 / meta 取标题
    try {
      const $ = cheerio.load(html);
      pageTitle =
        String($('meta[name="ArticleTitle"]').attr('content') || '').trim() ||
        String($('meta[property="og:title"]').attr('content') || '').trim() ||
        String($('h1').first().text() || '').trim() ||
        String($('title').first().text() || '').trim() ||
        null;
    } catch {
      /* ignore */
    }
  }

  // 新点 WebBuilder 详情壳（虹口 showinfo 等）：GET 壳页后走 rest getGovInfoDetail
  if (!hasAnnualReportMarkers(html) && looksLikeWebBuilderShell(html, pageUrl)) {
    const infoGuid = extractInfoGuid(pageUrl, html);
    if (!infoGuid) {
      const err: any = new Error(
        '该链接为政务公开动态详情页，但未能识别 infoGuid。请换用含完整 HTML 表格的年报正文链接，或手工粘贴'
      );
      err.code = 'IMPORT_SPA_UNSUPPORTED';
      throw err;
    }
    const wb = await fetchWebBuilderArticle(pageUrl, html, infoGuid);
    if (wb.kind === 'html') {
      html = wb.html;
    } else if (wb.kind === 'pdf_only') {
      const name = wb.attachName || wb.title || '附件';
      const err: any = new Error(
        `该年报以 PDF 附件发布（${name}），规则 HTML 导入无法解析 PDF。请下载 PDF 后走上传/AI 采集，或手工粘贴表格`
      );
      err.code = 'IMPORT_PDF_ONLY';
      throw err;
    } else {
      const err: any = new Error(
        '该链接为政务公开动态详情页，未能通过公开接口拉取正文。请换用静态 HTML 年报页，或手工粘贴表格'
      );
      err.code = 'IMPORT_SPA_UNSUPPORTED';
      throw err;
    }
  }

  // 路径含 infoGuid 但壳页特征不明显时仍尝试一次 WebBuilder
  if (!hasAnnualReportMarkers(html)) {
    const infoGuid = extractInfoGuid(pageUrl, html);
    if (infoGuid && /showinfo|infoGuid|govxxgk|hkxxgk/i.test(pageUrl + html.slice(0, 4000))) {
      const wb = await fetchWebBuilderArticle(pageUrl, html, infoGuid);
      if (wb.kind === 'html') html = wb.html;
      else if (wb.kind === 'pdf_only') {
        const name = wb.attachName || wb.title || '附件';
        const err: any = new Error(
          `该年报以 PDF 附件发布（${name}），规则 HTML 导入无法解析 PDF。请下载 PDF 后走上传/AI 采集，或手工粘贴表格`
        );
        err.code = 'IMPORT_PDF_ONLY';
        throw err;
      }
    }
  }

  const inferredUnit =
    options?.unitName ||
    inferUnitNameFromPage({ pageTitle, html, pageUrl, dept: pageDept }) ||
    undefined;

  const { form_json, stats } = parseAnnualReportHtmlToForm(html, {
    ...options,
    unitName: inferredUnit,
  });

  if (inferredUnit && !form_json.unit_name) {
    form_json.unit_name = inferredUnit;
  }
  if (pageTitle && !form_json.source_title) {
    form_json.source_title = pageTitle;
  }

  // 以「识别到的表二/三/四或有效正文」为准；导航杂表 + 空白骨架数字不得算导入成功
  const filled =
    stats.table2Filled +
    stats.table3Filled +
    stats.table4Filled +
    (stats.text1Chars > 20 ? 1 : 0);
  if (filled === 0) {
    const err: any = new Error(
      '未能从页面抽取到年报数据，请确认链接为政府信息公开工作年度报告正文页（含六章正文/表格的 HTML）。列表页、PDF-only、纯壳页不支持'
    );
    err.code = 'IMPORT_EMPTY';
    err.stats = stats;
    throw err;
  }

  return { form_json, finalUrl, stats, pageTitle: pageTitle || form_json.source_title || null };
}
