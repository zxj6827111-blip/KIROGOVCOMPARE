/**
 * Batch URL → filing draft (rule-based HTML import, no AI).
 * Flow: preview (match region/year + parse form) → human confirm → apply (createOrGet + updateDraft).
 */
import pool from '../../config/database-llm';
import {
  importFilingFormFromUrl,
  inferUnitNameFromPage,
  type FilingHtmlImportStats,
} from './FilingHtmlImportService';
import { filingService, type FilingRow } from './FilingService';
import { evaluateFilingGate } from './FilingGateService';
import { consistencyCheckService } from '../ConsistencyCheckService';

const MAX_BATCH_URLS = 50;
const DEFAULT_YEAR = () => new Date().getFullYear() - 1;

export type FilingBatchItemStatus =
  | 'ready'
  | 'needs_region'
  | 'failed'
  | 'applied'
  | 'skipped';

export interface FilingBatchUrlItem {
  id: string;
  url: string;
  finalUrl?: string;
  title?: string;
  status: FilingBatchItemStatus;
  message?: string;
  code?: string;
  year: number | null;
  unitName: string | null;
  regionId: number | null;
  regionName: string | null;
  matchConfidence?: number;
  stats?: FilingHtmlImportStats;
  gate?: { passed: boolean; failCount: number };
  /** Present only in preview when parse succeeded (not returned after apply to save payload). */
  form_json?: Record<string, any>;
  filingId?: number;
  filingCreated?: boolean;
  selected?: boolean;
}

export interface FilingBatchPreviewResult {
  items: FilingBatchUrlItem[];
  summary: {
    total: number;
    ready: number;
    needs_region: number;
    failed: number;
  };
}

export interface FilingBatchApplyInputItem {
  url: string;
  regionId: number;
  year: number;
  /** Optional: reuse preview form to avoid re-fetch; if omitted, re-import from url */
  form_json?: Record<string, any>;
  unitName?: string | null;
}

export interface FilingBatchApplyResult {
  items: FilingBatchUrlItem[];
  summary: {
    total: number;
    applied: number;
    failed: number;
    skipped: number;
  };
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
    .replace(/人民政府办公室$/, '政府办公室')
    .replace(/人民政府$/, '')
    .replace(/委员会$/, '委')
    .replace(/发展和改革/, '发展改革')
    .replace(/^区/, '区') // keep 区 prefix for dept names like 区经济委
    .replace(/[（）()《》【】\[\]：:，,。.;；、\-_\s]/g, '');
}

/** 上海区县域名/标题 → 行政区线索（用于消歧同名委办局） */
const SH_DISTRICT_HOST_HINTS: Array<{ re: RegExp; names: string[] }> = [
  { re: /fengxian|fx\.sh\.cn/i, names: ['奉贤区', '奉贤'] },
  { re: /xuhui/i, names: ['徐汇区', '徐汇'] },
  { re: /jingan|ja\.sh\.cn/i, names: ['静安区', '静安'] },
  { re: /huangpu|shhuangpu/i, names: ['黄浦区', '黄浦'] },
  { re: /changning|shcn\.gov/i, names: ['长宁区', '长宁'] },
  { re: /shpt|putuo/i, names: ['普陀区', '普陀'] },
  { re: /shhk|hongkou/i, names: ['虹口区', '虹口'] },
  { re: /shyp|yangpu/i, names: ['杨浦区', '杨浦'] },
  { re: /baoshan|shbsq/i, names: ['宝山区', '宝山'] },
  { re: /shmh|minhang/i, names: ['闵行区', '闵行'] },
  { re: /jiading/i, names: ['嘉定区', '嘉定'] },
  { re: /jinshan/i, names: ['金山区', '金山'] },
  { re: /songjiang/i, names: ['松江区', '松江'] },
  { re: /shqp|qingpu/i, names: ['青浦区', '青浦'] },
  { re: /shcm|chongming/i, names: ['崇明区', '崇明'] },
  { re: /pudong/i, names: ['浦东新区', '浦东'] },
];

export function extractGeoHintsFromUrlAndText(url: string, text?: string | null): string[] {
  const hints = new Set<string>();
  const hay = `${url}\n${text || ''}`;
  try {
    const host = new URL(url).hostname;
    for (const h of SH_DISTRICT_HOST_HINTS) {
      if (h.re.test(host) || h.re.test(url)) {
        h.names.forEach((n) => hints.add(n));
      }
    }
  } catch {
    /* ignore */
  }
  // 标题里的「奉贤区」「上海市奉贤区」
  const districtHits = hay.match(
    /(?:上海)?(?:市)?(浦东新区|[\u4e00-\u9fa5]{1,3}区|[\u4e00-\u9fa5]{1,3}县)/g
  );
  if (districtHits) {
    for (const d of districtHits) {
      const cleaned = d.replace(/^上海市?/, '');
      if (cleaned.length >= 2) hints.add(cleaned);
    }
  }
  if (/上海|shanghai/i.test(hay)) hints.add('上海市');
  return [...hints];
}

function regionAncestorNames(regionId: number, byId: Map<number, RegionRow>): string[] {
  const names: string[] = [];
  let cur = byId.get(regionId);
  let depth = 0;
  while (cur && depth < 10) {
    if (cur.name) names.push(cur.name);
    cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
    depth += 1;
  }
  return names;
}

function makeItemId(url: string, index: number): string {
  return `u${index}_${Buffer.from(url).toString('base64url').slice(0, 24)}`;
}

/** Split textarea / pasted list into unique http(s) URLs */
export function parseUrlList(raw: string | string[]): string[] {
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw || '');
  const parts = text
    .split(/[\r\n,;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    let u = p;
    if (!/^https?:\/\//i.test(u)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(u)) u = `https://${u}`;
      else continue;
    }
    try {
      const parsed = new URL(u);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const key = parsed.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    } catch {
      /* skip */
    }
  }
  return out.slice(0, MAX_BATCH_URLS);
}

export function extractYearFromText(...parts: string[]): number | null {
  const haystack = parts.filter(Boolean).join('\n');
  const matches = Array.from(haystack.matchAll(/(20\d{2})\s*年?/g))
    .map((m) => Number(m[1]))
    .filter((y) => y >= 2000 && y <= 2100);
  if (!matches.length) return null;
  // Prefer years that look like report year (not far future pub year alone)
  const now = new Date().getFullYear();
  const reportish = matches.filter((y) => y <= now && y >= now - 15);
  return reportish[0] || matches[0] || null;
}

export function extractUnitNameFromTitle(title: string): string | null {
  const clean = normalizeText(title)
    .replace(/[-_]{1,2}.+$/, '')
    .replace(/(市政府门户网站|人民政府网站|政府网站)$/g, '');
  // Work on original spacing first for year/suffix strip, then compact
  let s = clean
    .replace(
      /(?:20\d{2}\s*年(?:度)?)?(?:政府信息公开工作年度报告|政府信息公开年度报告|信息公开工作年度报告|信息公开年度报告|政府信息公开年报|年度报告|年报)\s*$/g,
      ''
    )
    .replace(/20\d{2}\s*年(?:度)?/g, '')
    .replace(/^关于/, '')
    .replace(/[：:，,。]+$/g, '');
  const candidate = normalizeText(s);
  if (!candidate || candidate.length < 2 || candidate.length > 80) return null;
  return candidate;
}

function titleFromForm(form: Record<string, any> | undefined, finalUrl: string): string {
  const unit = normalizeText(form?.unit_name);
  const year = form?.year;
  if (unit && year) return `${unit}${year}年政府信息公开工作年度报告`;
  if (unit) return `${unit}政府信息公开工作年度报告`;
  try {
    return decodeURIComponent(pathBasename(finalUrl));
  } catch {
    return finalUrl;
  }
}

function pathBasename(url: string): string {
  try {
    const p = new URL(url).pathname;
    const seg = p.split('/').filter(Boolean).pop() || '';
    return seg || url;
  } catch {
    return url;
  }
}

type RegionRow = { id: number; name: string; parent_id: number | null; level: number };

async function loadRegions(allowedRegionIds: number[] | null): Promise<RegionRow[]> {
  const result = await pool.query(`SELECT id, name, parent_id, level FROM regions ORDER BY id`);
  const rows = result.rows.map((row: any) => ({
    id: Number(row.id),
    name: String(row.name || ''),
    parent_id: row.parent_id != null ? Number(row.parent_id) : null,
    level: Number(row.level || 0),
  }));
  if (!allowedRegionIds) return rows;
  const allow = new Set(allowedRegionIds.map(Number));
  return rows.filter((r) => allow.has(r.id));
}

export function matchRegionByUnitName(
  unitName: string | null,
  regions: RegionRow[],
  options?: { pageUrl?: string; pageTitle?: string | null }
): { id: number; name: string; score: number; path?: string } | null {
  const normalizedUnit = normalizeForMatch(unitName);
  if (!normalizedUnit || normalizedUnit.length < 2) return null;

  const byId = new Map(regions.map((r) => [r.id, r]));
  const geoHints = extractGeoHintsFromUrlAndText(
    options?.pageUrl || '',
    `${unitName || ''}\n${options?.pageTitle || ''}`
  );
  const normalizedHints = geoHints.map((h) => normalizeForMatch(h)).filter((h) => h.length >= 2);

  // 单位名里是否自带区县（奉贤区经济委）
  const unitHasDistrict = /区|县|市|新区/.test(String(unitName || ''));

  let best: { id: number; name: string; score: number; path?: string } | null = null;

  for (const region of regions) {
    const normalizedRegion = normalizeForMatch(region.name);
    if (!normalizedRegion || normalizedRegion.length < 2) continue;

    let score = 0;
    // 「区经济委员会」vs「奉贤区经济委员会」：去头「区」后比核心名
    const regionCore = normalizedRegion.replace(/^区/, '');
    const unitCore = normalizedUnit.replace(/^区/, '');

    if (normalizedUnit === normalizedRegion || unitCore === regionCore) {
      score += 100;
    } else if (normalizedUnit.includes(normalizedRegion) || unitCore.includes(regionCore)) {
      const isBroad = region.level <= 2;
      const isGovBody =
        normalizedUnit === `${normalizedRegion}人民政府` ||
        normalizedUnit === `${normalizedRegion}政府` ||
        normalizedUnit.endsWith(`${normalizedRegion}人民政府`) ||
        normalizedUnit.endsWith(`${normalizedRegion}政府办公室`) ||
        normalizedUnit.endsWith(`${normalizedRegion}政府办`);
      if (isBroad && !isGovBody && normalizedRegion.length <= 3) {
        continue;
      }
      score += 40 + Math.min(normalizedRegion.length, 12);
    } else if (normalizedRegion.includes(normalizedUnit) || regionCore.includes(unitCore)) {
      // 库名更长包含单位短名（易误伤同名局）：基础分低，必须靠地理加分
      score += 15 + Math.min(normalizedUnit.length, 8);
    } else {
      continue;
    }

    const ancestors = regionAncestorNames(region.id, byId);
    const ancestorNorms = ancestors.map((n) => normalizeForMatch(n));

    // 标题/单位名中的上级地名
    let parentHits = 0;
    for (const parentName of ancestorNorms) {
      if (parentName.length >= 2 && normalizedUnit.includes(parentName)) {
        score += 70 + Math.min(parentName.length, 8);
        parentHits += 1;
      }
    }

    // URL/域名地理线索（fengxian → 奉贤区）
    let geoHits = 0;
    for (const hint of normalizedHints) {
      if (ancestorNorms.some((a) => a === hint || a.includes(hint) || hint.includes(a))) {
        score += 90;
        geoHits += 1;
      }
    }

    // 标题/单位明确写了某区，但候选节点祖先链不含该区 → 直接否决（避免淮安「机关事务」抢奉贤）
    const districtHints = normalizedHints.filter((h) => /区|县|新区$/.test(h) || h.length >= 2);
    if (districtHints.length > 0) {
      const ancestorBlob = ancestorNorms.join('|');
      const anyDistrictOnPath = districtHints.some(
        (h) => ancestorBlob.includes(h) || h.includes(normalizeForMatch(region.name))
      );
      // 单位名里也抽区县
      const unitDistricts = Array.from(
        String(unitName || '').matchAll(/(浦东新区|[\u4e00-\u9fa5]{1,3}区|[\u4e00-\u9fa5]{1,3}县)/g)
      ).map((m) => normalizeForMatch(m[1]));
      const required = [...new Set([...districtHints, ...unitDistricts])].filter(
        (h) => h.length >= 2 && !/^上海/.test(h)
      );
      if (required.length > 0) {
        const ok = required.some(
          (h) =>
            ancestorNorms.some((a) => a === h || a.includes(h) || h.includes(a)) ||
            normalizedRegion === h ||
            normalizedRegion.includes(h)
        );
        if (!ok) {
          continue; // 地理冲突，跳过
        }
      }
    }

    // 同名委办局跨省：单位名无区县且无 geo/parent 命中 → 重罚
    const looksLikeDept =
      /委|局|办|中心|街道|镇/.test(String(region.name || '')) || region.level >= 3;
    if (looksLikeDept && parentHits === 0 && geoHits === 0) {
      if (!unitHasDistrict) {
        score -= 80;
      } else {
        score -= 40;
      }
    }

    // 偏好更深的部门节点（区经委优于区）
    score += Math.min(region.level, 6) * 2;

    if (score < 40) continue;

    const path = [...ancestors].reverse().join(' > ');
    if (!best || score > best.score) {
      best = { id: region.id, name: region.name, score, path };
    }
  }

  // 部门节点不在库中时：回退匹配到区县（仍可导入，提示人工核对）
  if ((!best || best.score < 50) && normalizedHints.length > 0) {
    for (const region of regions) {
      if (region.level > 3) continue;
      const normalizedRegion = normalizeForMatch(region.name);
      const hit = normalizedHints.some(
        (h) => normalizedRegion === h || normalizedRegion.includes(h) || h.includes(normalizedRegion)
      );
      if (!hit) continue;
      // 优先区县级
      const score = 55 + (region.level >= 2 ? 10 : 0);
      const path = [...regionAncestorNames(region.id, byId)].reverse().join(' > ');
      if (!best || score > best.score) {
        best = {
          id: region.id,
          name: region.name,
          score,
          path: path + (unitName ? `（库无「${unitName}」部门节点，已落到区县）` : ''),
        };
      }
    }
  }

  return best && best.score >= 50 ? best : null;
}

async function runLightGate(formJson: Record<string, any>): Promise<{ passed: boolean; failCount: number }> {
  try {
    const year = Number(formJson?.year);
    const items = consistencyCheckService.runChecks(
      formJson,
      Number.isFinite(year) ? year : undefined
    );
    const gate = evaluateFilingGate(items as any);
    return { passed: gate.passed, failCount: gate.failCount };
  } catch {
    return { passed: true, failCount: 0 };
  }
}

async function previewOne(
  url: string,
  index: number,
  regions: RegionRow[],
  defaultYear: number | null
): Promise<FilingBatchUrlItem> {
  const id = makeItemId(url, index);
  try {
    const imported = await importFilingFormFromUrl(url, {
      year: defaultYear || undefined,
    });
    const form = imported.form_json || {};
    const pageTitle = normalizeText(imported.pageTitle || form.source_title) || null;
    const title =
      pageTitle ||
      titleFromForm(form, imported.finalUrl) ||
      imported.finalUrl;
    const unitFromForm = normalizeText(form.unit_name) || null;
    const unitFromPage =
      inferUnitNameFromPage({
        pageTitle,
        pageUrl: imported.finalUrl || url,
      }) || extractUnitNameFromTitle(title);
    const unitName = unitFromForm || unitFromPage;
    const year =
      (Number.isFinite(Number(form.year)) ? Number(form.year) : null) ||
      extractYearFromText(title, pageTitle || '', imported.finalUrl, url) ||
      defaultYear;

    if (unitName && !form.unit_name) {
      form.unit_name = unitName;
    }

    const matched = matchRegionByUnitName(unitName, regions, {
      pageUrl: imported.finalUrl || url,
      pageTitle: pageTitle || title,
    });
    const gate = await runLightGate(form);

    if (!matched) {
      return {
        id,
        url,
        finalUrl: imported.finalUrl,
        title,
        status: 'needs_region',
        message: unitName
          ? `已抽表，但未能自动匹配单位「${unitName}」，请手工选择地区后确认导入`
          : '已抽表，但未能识别单位名称，请手工选择地区后确认导入',
        code: 'NEEDS_REGION',
        year,
        unitName,
        regionId: null,
        regionName: null,
        stats: imported.stats,
        gate,
        form_json: form,
        selected: false,
      };
    }

    const pathHint = matched.path ? `（${matched.path}）` : '';
    return {
      id,
      url,
      finalUrl: imported.finalUrl,
      title,
      status: 'ready',
      message:
        gate.failCount > 0
          ? `已匹配${pathHint}；勾稽预检有 ${gate.failCount} 项 FAIL（仍可导入草稿）`
          : `已抽表并匹配单位${pathHint}`,
      year,
      unitName: unitName || matched.name,
      regionId: matched.id,
      regionName: matched.name,
      matchConfidence: matched.score,
      stats: imported.stats,
      gate,
      form_json: form,
      selected: true,
    };
  } catch (e: any) {
    return {
      id,
      url,
      status: 'failed',
      message: e?.message || 'import_failed',
      code: e?.code || 'IMPORT_FAILED',
      year: defaultYear,
      unitName: null,
      regionId: null,
      regionName: null,
      stats: e?.stats,
      selected: false,
    };
  }
}

function summarizePreview(items: FilingBatchUrlItem[]) {
  return {
    total: items.length,
    ready: items.filter((i) => i.status === 'ready').length,
    needs_region: items.filter((i) => i.status === 'needs_region').length,
    failed: items.filter((i) => i.status === 'failed').length,
  };
}

export class FilingBatchUrlImportService {
  async preview(params: {
    urls: string | string[];
    defaultYear?: number | null;
    allowedRegionIds?: number[] | null;
  }): Promise<FilingBatchPreviewResult> {
    const list = parseUrlList(params.urls);
    if (!list.length) {
      const err: any = new Error('请至少提供一条有效的 http(s) 年报链接');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    const defaultYear =
      params.defaultYear && Number.isFinite(params.defaultYear)
        ? Number(params.defaultYear)
        : DEFAULT_YEAR();
    const regions = await loadRegions(params.allowedRegionIds ?? null);

    const items: FilingBatchUrlItem[] = [];
    // Sequential to avoid hammering gov sites / rate limits
    for (let i = 0; i < list.length; i += 1) {
      items.push(await previewOne(list[i], i, regions, defaultYear));
    }
    return { items, summary: summarizePreview(items) };
  }

  async apply(params: {
    items: FilingBatchApplyInputItem[];
    userId?: number;
    allowedRegionIds?: number[] | null;
  }): Promise<FilingBatchApplyResult> {
    const allowed = params.allowedRegionIds;
    const out: FilingBatchUrlItem[] = [];
    let applied = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < params.items.length; i += 1) {
      const row = params.items[i];
      const url = normalizeText(row?.url);
      const regionId = Number(row?.regionId);
      const year = Number(row?.year);
      const id = makeItemId(url || `row${i}`, i);

      if (!url || !Number.isFinite(regionId) || !Number.isFinite(year)) {
        skipped += 1;
        out.push({
          id,
          url: url || '',
          status: 'skipped',
          message: '缺少 url / regionId / year',
          code: 'INVALID_INPUT',
          year: Number.isFinite(year) ? year : null,
          unitName: row?.unitName || null,
          regionId: Number.isFinite(regionId) ? regionId : null,
          regionName: null,
        });
        continue;
      }
      if (allowed && !allowed.includes(regionId)) {
        failed += 1;
        out.push({
          id,
          url,
          status: 'failed',
          message: '超出数据权限范围',
          code: 'FORBIDDEN_SCOPE',
          year,
          unitName: row?.unitName || null,
          regionId,
          regionName: null,
        });
        continue;
      }
      if (year < 2000 || year > 2100) {
        failed += 1;
        out.push({
          id,
          url,
          status: 'failed',
          message: 'year 不合法',
          code: 'INVALID_YEAR',
          year,
          unitName: row?.unitName || null,
          regionId,
          regionName: null,
        });
        continue;
      }

      try {
        let formJson = row.form_json;
        let finalUrl = url;
        let stats: FilingHtmlImportStats | undefined;
        if (!formJson || typeof formJson !== 'object') {
          const imported = await importFilingFormFromUrl(url, {
            year,
            regionId,
            unitName: row.unitName || undefined,
          });
          formJson = imported.form_json;
          finalUrl = imported.finalUrl;
          stats = imported.stats;
        }

        const { filing, created } = await filingService.createOrGet({
          regionId,
          year,
          userId: params.userId,
        });

        if (filing.status !== 'draft' && filing.status !== 'checks_failed') {
          failed += 1;
          out.push({
            id,
            url,
            finalUrl,
            status: 'failed',
            message: `填报状态为 ${filing.status}，不可覆盖（请先撤回为草稿）`,
            code: 'FILING_NOT_EDITABLE',
            year,
            unitName: row.unitName || filing.region_name || null,
            regionId,
            regionName: filing.region_name || null,
            filingId: filing.id,
            stats,
          });
          continue;
        }

        // Prefer region name on form
        if (formJson && typeof formJson === 'object') {
          formJson = {
            ...formJson,
            year,
            region_id: regionId,
            unit_name: row.unitName || filing.region_name || formJson.unit_name || '',
          };
        }

        const updated = await filingService.updateDraft(filing.id, formJson, params.userId);
        applied += 1;
        out.push({
          id,
          url,
          finalUrl,
          status: 'applied',
          message: created ? '已创建草稿并写入' : '已写入已有草稿',
          year,
          unitName: updated.region_name || row.unitName || null,
          regionId,
          regionName: updated.region_name || null,
          filingId: updated.id,
          filingCreated: created,
          stats,
        });
      } catch (e: any) {
        failed += 1;
        out.push({
          id,
          url,
          status: 'failed',
          message: e?.message || 'apply_failed',
          code: e?.code || 'APPLY_FAILED',
          year,
          unitName: row?.unitName || null,
          regionId,
          regionName: null,
          stats: e?.stats,
        });
      }
    }

    return {
      items: out,
      summary: {
        total: params.items.length,
        applied,
        failed,
        skipped,
      },
    };
  }
}

export const filingBatchUrlImportService = new FilingBatchUrlImportService();

// re-export for tests typing
export type { FilingRow };
