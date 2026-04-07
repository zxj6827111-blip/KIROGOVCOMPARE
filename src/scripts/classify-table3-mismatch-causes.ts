import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_DIR } from '../config/constants';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { LlmProvider } from '../services/LlmProvider';
import { resolveAbsoluteStoragePath } from '../services/SourceFileGuardService';
import { loadUserText } from '../services/LlmCommon';

type FieldKey = 'new_received' | 'carried_over' | 'total_processed' | 'carried_forward';
type Totals = Record<FieldKey, number | null>;

type SourceExtraction = {
  totals: Totals;
  extractedCount: number;
};

type CompareResult = {
  passed: boolean;
  reason?: string;
  mismatches: Array<{ field: FieldKey; source: number; parsed: number }>;
  missingParsedFields: FieldKey[];
};

type ReportSummaryRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  detail_mismatch_rows: number;
  total_mismatch_rows: number;
  max_abs_diff_detail: number;
  max_abs_diff_total: number;
  score: number;
  severity: string;
  has_detail_mismatch: boolean;
  has_total_mismatch: boolean;
};

type ActiveVersionRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  storage_path: string;
  file_hash: string | null;
  parsed_json: any;
};

type CauseType =
  | 'ai_parse_bias_likely'
  | 'source_data_issue_likely'
  | 'source_extract_insufficient'
  | 'detail_level_or_other';

type ClassifiedRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  detail_mismatch_rows: number;
  total_mismatch_rows: number;
  score: number;
  severity: string;
  cause: CauseType;
  cause_reason: string;
  source_extracted_fields: number;
  source_identity_diff: number | null;
  parsed_identity_diff: number | null;
  compared_mismatch_fields: string;
  source_totals: Totals;
  parsed_totals: Totals;
};

const FIELD_KEYS: FieldKey[] = ['new_received', 'carried_over', 'total_processed', 'carried_forward'];
let uploadHashIndex: Map<string, string[]> | null = null;

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function toInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function normalizePathForDb(absPath: string): string {
  const relative = path.relative(PROJECT_ROOT, absPath);
  return relative.replace(/\\/g, '/');
}

function buildUploadHashIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!fs.existsSync(rootDir)) {
    return index;
  }

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const matched = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(entry.name);
      if (!matched) {
        continue;
      }
      const hash = matched[1].toLowerCase();
      const list = index.get(hash) || [];
      list.push(full);
      index.set(hash, list);
    }
  }
  return index;
}

function resolveSourcePathByFileHash(fileHash: string | null): string | null {
  const hash = String(fileHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return null;
  }

  if (!uploadHashIndex) {
    uploadHashIndex = buildUploadHashIndex(UPLOADS_DIR);
  }

  const matches = uploadHashIndex.get(hash) || [];
  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
}

function coerceNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/' || trimmed === '-' || trimmed === '--') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
}

function normalizeText(input: string): string {
  return normalizeFullWidthDigits(input || '')
    .replace(/\u3000/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

function extractBalancedJsonObject(source: string, startIndex: number): string | null {
  if (startIndex < 0 || startIndex >= source.length || source[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function recoverJsonObjectFromText(rawText: string): Record<string, any> | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
  } catch {
    // noop
  }

  const stripped = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
  } catch {
    // noop
  }

  let cursor = 0;
  while (cursor < stripped.length) {
    const start = stripped.indexOf('{', cursor);
    if (start < 0) break;
    const objectText = extractBalancedJsonObject(stripped, start);
    if (!objectText) break;
    try {
      const parsed = JSON.parse(objectText);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
    } catch {
      // noop
    }
    cursor = start + 1;
  }
  return null;
}

function getSection(parsed: any, type: string): any {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  return sections.find((item: any) => item?.type === type);
}

function extractParsedTotals(output: any): Totals {
  const table3Section = getSection(output, 'table_3');
  const tableData = table3Section?.tableData ?? output?.tableData;
  return {
    new_received: coerceNumber(tableData?.total?.newReceived),
    carried_over: coerceNumber(tableData?.total?.carriedOver),
    total_processed: coerceNumber(tableData?.total?.results?.totalProcessed),
    carried_forward: coerceNumber(tableData?.total?.results?.carriedForward),
  };
}

function firstRegexNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const matched = pattern.exec(text);
    if (!matched?.[1]) continue;
    const value = coerceNumber(matched[1]);
    if (value !== null) return value;
  }
  return null;
}

function extractNarrativeTotals(text: string): Partial<Totals> {
  const normalized = normalizeText(text);
  const output: Partial<Totals> = {};

  const newReceived = firstRegexNumber(normalized, [
    /本年新收[^0-9]{0,40}(\d{1,9})\s*件/,
    /新收[^0-9]{0,40}(\d{1,9})\s*件/,
  ]);
  if (newReceived !== null) output.new_received = newReceived;

  const carriedOver = firstRegexNumber(normalized, [
    /上年结转[^0-9]{0,40}(\d{1,9})\s*件/,
  ]);
  if (carriedOver !== null) output.carried_over = carriedOver;

  const totalProcessed = firstRegexNumber(normalized, [
    /本年度办理结果[^0-9]{0,60}(\d{1,9})\s*件/,
    /办理结果[^0-9]{0,30}(\d{1,9})\s*件/,
    /答复[^0-9]{0,30}(\d{1,9})\s*件/,
  ]);
  if (totalProcessed !== null) output.total_processed = totalProcessed;

  const carriedForward = firstRegexNumber(normalized, [
    /结转下年度继续办理[^0-9]{0,30}(\d{1,9})\s*件?/,
    /结转下一年[^0-9]{0,30}(\d{1,9})\s*件?/,
  ]);
  if (carriedForward !== null) output.carried_forward = carriedForward;

  return output;
}

function extractLastIntegerFromLine(line: string): number | null {
  const normalized = normalizeText(line).replace(/,/g, '');
  const matches = normalized.match(/-?\d+/g);
  if (!matches || matches.length === 0) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

function isTable3Heading(line: string): boolean {
  const normalized = normalizeText(line);
  return (
    normalized.includes('收到和处理政府信息公开申请情况') ||
    normalized.includes('政府信息公开申请情况') ||
    normalized.includes('表三')
  );
}

function isTable4Heading(line: string): boolean {
  const normalized = normalizeText(line);
  return normalized.includes('行政复议') || normalized.includes('行政诉讼') || normalized.includes('表四');
}

function pickTable3Window(text: string): string {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (isTable3Heading(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) return text;

  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTable4Heading(lines[i])) {
      end = i;
      break;
    }
  }

  const selected = end > start ? lines.slice(start, end) : lines.slice(start);
  return selected.join('\n');
}

function extractTableTotals(table3WindowText: string): Partial<Totals> {
  const output: Partial<Totals> = {};
  const lines = String(table3WindowText || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    const compact = line.replace(/\s+/g, '');
    if (!compact) continue;
    const value = extractLastIntegerFromLine(line);
    if (value === null) continue;

    if (output.new_received === undefined && compact.includes('本年新收')) {
      output.new_received = value;
      continue;
    }
    if (output.carried_over === undefined && compact.includes('上年结转')) {
      output.carried_over = value;
      continue;
    }
    if (
      output.total_processed === undefined &&
      compact.includes('总计') &&
      (compact.includes('七') || compact.includes('(7)'))
    ) {
      output.total_processed = value;
      continue;
    }
    if (
      output.carried_forward === undefined &&
      (compact.includes('结转下年度继续办理') || compact.includes('结转下一年'))
    ) {
      output.carried_forward = value;
      continue;
    }
  }

  return output;
}

function buildSourceExtraction(text: string): SourceExtraction {
  const narrative = extractNarrativeTotals(text);
  const tableWindow = pickTable3Window(text);
  const table = extractTableTotals(tableWindow);

  const totals: Totals = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };

  for (const key of FIELD_KEYS) {
    const nv = (narrative as any)[key];
    const tv = (table as any)[key];
    if (typeof nv === 'number') {
      totals[key] = nv;
    } else if (typeof tv === 'number') {
      totals[key] = tv;
    }
  }

  const extractedCount = FIELD_KEYS.filter((key) => typeof totals[key] === 'number').length;
  return { totals, extractedCount };
}

function readByPath(input: any, dottedPath: string): any {
  const keys = dottedPath.split('.');
  let cur = input;
  for (const key of keys) {
    cur = cur?.[key];
  }
  return cur;
}

function firstNumericFromPaths(input: any, paths: string[]): number | null {
  for (const p of paths) {
    const value = readByPath(input, p);
    const numeric = coerceNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function normalizeAiReviewTotals(reviewObj: any): Totals {
  const candidateRoots = [
    reviewObj,
    reviewObj?.source_totals,
    reviewObj?.sourceTotals,
    reviewObj?.extracted_source_totals,
    reviewObj?.extractedTotals,
    reviewObj?.source_table3_json?.tableData?.total,
    reviewObj?.source_table3_json?.total,
  ];

  const totals: Totals = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };

  for (const root of candidateRoots) {
    if (!root || typeof root !== 'object') continue;

    if (totals.new_received === null) {
      totals.new_received = firstNumericFromPaths(root, ['new_received', 'newReceived', 'new']);
    }
    if (totals.carried_over === null) {
      totals.carried_over = firstNumericFromPaths(root, ['carried_over', 'carriedOver']);
    }
    if (totals.total_processed === null) {
      totals.total_processed = firstNumericFromPaths(root, ['total_processed', 'totalProcessed', 'results.totalProcessed']);
    }
    if (totals.carried_forward === null) {
      totals.carried_forward = firstNumericFromPaths(root, ['carried_forward', 'carriedForward', 'results.carriedForward']);
    }
  }

  return totals;
}

function compareSourceAndParsed(source: SourceExtraction, parsedTotals: Totals, minSourceFields: number): CompareResult {
  const extractedFields = FIELD_KEYS.filter((field) => source.totals[field] !== null);
  if (extractedFields.length < minSourceFields) {
    return {
      passed: false,
      reason: `source_extract_insufficient:${extractedFields.length}<${minSourceFields}`,
      mismatches: [],
      missingParsedFields: [],
    };
  }

  const missingParsedFields: FieldKey[] = [];
  const mismatches: Array<{ field: FieldKey; source: number; parsed: number }> = [];

  for (const field of extractedFields) {
    const sourceValue = source.totals[field];
    const parsedValue = parsedTotals[field];
    if (sourceValue === null) continue;
    if (parsedValue === null) {
      missingParsedFields.push(field);
      continue;
    }
    if (sourceValue !== parsedValue) {
      mismatches.push({ field, source: sourceValue, parsed: parsedValue });
    }
  }

  if (missingParsedFields.length > 0) {
    return {
      passed: false,
      reason: `parsed_missing_fields:${missingParsedFields.join('|')}`,
      mismatches,
      missingParsedFields,
    };
  }

  if (mismatches.length > 0) {
    return {
      passed: false,
      reason: `source_mismatch:${mismatches.map((m) => `${m.field}:${m.source}!=${m.parsed}`).join('|')}`,
      mismatches,
      missingParsedFields: [],
    };
  }

  return { passed: true, mismatches: [], missingParsedFields: [] };
}

async function aiReviewSourceTotals(
  provider: LlmProvider,
  sourceText: string,
  parsedTotals: Totals
): Promise<SourceExtraction | null> {
  const generate = (provider as any)?.generate;
  if (typeof generate !== 'function') return null;

  const table3Window = pickTable3Window(sourceText || '');
  const reviewWindow = table3Window.length > 40000 ? table3Window.slice(0, 40000) : table3Window;

  const systemInstruction = [
    'You are a strict reviewer for Chinese government annual report table_3 source totals.',
    'Extract source totals from SOURCE_TEXT.',
    'Return JSON only with keys: source_totals.new_received, carried_over, total_processed, carried_forward.',
    'Unknown values must be null.',
  ].join('\n');

  const prompt = JSON.stringify(
    {
      parsed_totals: parsedTotals,
      source_text: reviewWindow,
      output_schema: {
        source_totals: {
          new_received: 'number|null',
          carried_over: 'number|null',
          total_processed: 'number|null',
          carried_forward: 'number|null',
        },
      },
    },
    null,
    2
  );

  try {
    const reviewed = await generate(prompt, systemInstruction, {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 1000,
    });
    const reviewRawText = typeof reviewed?.text === 'string' ? reviewed.text : JSON.stringify(reviewed || {});
    const reviewObj = recoverJsonObjectFromText(reviewRawText);
    if (!reviewObj || typeof reviewObj !== 'object') return null;

    const totals = normalizeAiReviewTotals(reviewObj);
    const extractedCount = FIELD_KEYS.filter((key) => typeof totals[key] === 'number').length;
    return { totals, extractedCount };
  } catch {
    return null;
  }
}

function computeIdentityDiff(totals: Totals): number | null {
  const a = totals.new_received;
  const b = totals.carried_over;
  const c = totals.total_processed;
  const d = totals.carried_forward;
  if ([a, b, c, d].some((v) => typeof v !== 'number')) return null;
  return Number(a) + Number(b) - Number(c) - Number(d);
}

function findLatestReportSummaryJson(tmpDir: string): string {
  const files = fs
    .readdirSync(tmpDir)
    .filter((name) => /^table3_report_summary_\d{8}_\d{6}\.json$/.test(name))
    .map((name) => path.join(tmpDir, name));
  if (files.length === 0) {
    throw new Error('report_summary_json_not_found');
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
}

async function loadReportSummaryRows(reportSummaryPath: string): Promise<ReportSummaryRow[]> {
  const raw = await fsp.readFile(reportSummaryPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('report_summary_json_invalid');
  }
  return parsed as ReportSummaryRow[];
}

async function loadActiveVersions(reportIds: number[]): Promise<Map<number, ActiveVersionRow>> {
  const mapping = new Map<number, ActiveVersionRow>();
  if (reportIds.length === 0) return mapping;

  const result = await pool.query(
    `SELECT r.id::int AS report_id,
            r.year::int AS year,
            r.region_id::int AS region_id,
            rg.name AS region_name,
            r.active_version_id::int AS version_id,
            rv.storage_path,
            rv.file_hash,
            rv.parsed_json
       FROM reports r
       LEFT JOIN regions rg ON rg.id = r.region_id
       JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.id = ANY($1::int[])`,
    [reportIds]
  );

  for (const row of result.rows) {
    mapping.set(Number(row.report_id), {
      report_id: Number(row.report_id),
      version_id: Number(row.version_id),
      year: Number(row.year),
      region_id: row.region_id === null ? null : Number(row.region_id),
      region_name: row.region_name ?? null,
      storage_path: String(row.storage_path || ''),
      file_hash: row.file_hash ?? null,
      parsed_json: row.parsed_json,
    });
  }
  return mapping;
}

async function main(): Promise<void> {
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);
  const tmpDir = path.resolve(process.cwd(), 'tmp');
  const reportSummaryArg = parseArg('report-summary-json');
  const reportSummaryPath = reportSummaryArg
    ? (path.isAbsolute(reportSummaryArg) ? reportSummaryArg : path.resolve(process.cwd(), reportSummaryArg))
    : findLatestReportSummaryJson(tmpDir);

  const providerName = (parseArg('provider') || 'gemini').trim().toLowerCase();
  const modelName = (parseArg('model') || 'gemini-2.5-flash').trim();
  const minSourceFields = toInt(parseArg('min-source-fields'), 3);

  await fsp.mkdir(outDir, { recursive: true });

  const reportSummaryRows = await loadReportSummaryRows(reportSummaryPath);
  const reportIds = Array.from(new Set(reportSummaryRows.map((item) => Number(item.report_id)).filter((id) => Number.isInteger(id) && id > 0)));
  const summaryByReportId = new Map<number, ReportSummaryRow>();
  for (const row of reportSummaryRows) {
    summaryByReportId.set(Number(row.report_id), row);
  }

  const activeMap = await loadActiveVersions(reportIds);
  const provider = createLlmProvider(providerName, modelName);

  const classified: ClassifiedRow[] = [];
  let recoveredMissingSourceByHash = 0;
  let unresolvedMissingSource = 0;

  for (let i = 0; i < reportIds.length; i += 1) {
    const reportId = reportIds[i];
    const base = summaryByReportId.get(reportId);
    const active = activeMap.get(reportId);
    if (!base || !active) {
      continue;
    }

    let resolvedPath = resolveAbsoluteStoragePath(active.storage_path);
    if (!fs.existsSync(resolvedPath)) {
      const recoveredByHash = resolveSourcePathByFileHash(active.file_hash);
      if (recoveredByHash && fs.existsSync(recoveredByHash)) {
        resolvedPath = recoveredByHash;
        recoveredMissingSourceByHash += 1;
        const normalizedStoragePath = normalizePathForDb(recoveredByHash);
        if (normalizedStoragePath && normalizedStoragePath !== active.storage_path) {
          try {
            await pool.query(
              `UPDATE report_versions
               SET storage_path = $1,
                   updated_at = NOW()
               WHERE id = $2`,
              [normalizedStoragePath, active.version_id]
            );
            active.storage_path = normalizedStoragePath;
          } catch (error) {
            console.warn(
              `[classify-table3-mismatch-causes] failed to repair storage_path for version ${active.version_id}:`,
              error
            );
          }
        }
      }
    }
    if (!fs.existsSync(resolvedPath)) {
      unresolvedMissingSource += 1;
      classified.push({
        report_id: reportId,
        version_id: active.version_id,
        year: active.year,
        region_id: active.region_id,
        region_name: active.region_name,
        detail_mismatch_rows: Number(base.detail_mismatch_rows || 0),
        total_mismatch_rows: Number(base.total_mismatch_rows || 0),
        score: Number(base.score || 0),
        severity: String(base.severity || ''),
        cause: 'source_extract_insufficient',
        cause_reason: 'source_file_missing',
        source_extracted_fields: 0,
        source_identity_diff: null,
        parsed_identity_diff: null,
        compared_mismatch_fields: '',
        source_totals: {
          new_received: null,
          carried_over: null,
          total_processed: null,
          carried_forward: null,
        },
        parsed_totals: {
          new_received: null,
          carried_over: null,
          total_processed: null,
          carried_forward: null,
        },
      });
      continue;
    }

    const parsedRaw = active.parsed_json;
    const parsed = typeof parsedRaw === 'string' ? JSON.parse(parsedRaw) : parsedRaw;
    const parsedTotals = extractParsedTotals(parsed);
    const parsedIdentityDiff = computeIdentityDiff(parsedTotals);

    let sourceText = '';
    const loaded = await loadUserText(resolvedPath, {
      reportId: reportId,
      versionId: active.version_id,
      storagePath: resolvedPath,
      fileHash: active.file_hash || undefined,
    });
    if (loaded.text) {
      sourceText = loaded.text;
    }

    let sourceExtraction = buildSourceExtraction(sourceText);
    if (sourceExtraction.extractedCount < minSourceFields) {
      const aiReviewed = await aiReviewSourceTotals(provider, sourceText, parsedTotals);
      if (aiReviewed && aiReviewed.extractedCount > sourceExtraction.extractedCount) {
        sourceExtraction = aiReviewed;
      }
    }

    const compare = compareSourceAndParsed(sourceExtraction, parsedTotals, minSourceFields);
    const sourceIdentityDiff = computeIdentityDiff(sourceExtraction.totals);

    let cause: CauseType = 'detail_level_or_other';
    let causeReason = compare.reason || '';

    if (sourceExtraction.extractedCount < minSourceFields) {
      cause = 'source_extract_insufficient';
      causeReason = compare.reason || `source_extract_insufficient:${sourceExtraction.extractedCount}<${minSourceFields}`;
    } else if (sourceIdentityDiff !== null && sourceIdentityDiff !== 0) {
      cause = 'source_data_issue_likely';
      causeReason = `source_identity_broken:${sourceIdentityDiff}`;
    } else if (!compare.passed) {
      cause = 'ai_parse_bias_likely';
      causeReason = compare.reason || 'source_mismatch';
    } else {
      cause = 'detail_level_or_other';
      causeReason = 'total_level_consistent_but_audit_still_mismatch';
    }

    classified.push({
      report_id: reportId,
      version_id: active.version_id,
      year: active.year,
      region_id: active.region_id,
      region_name: active.region_name,
      detail_mismatch_rows: Number(base.detail_mismatch_rows || 0),
      total_mismatch_rows: Number(base.total_mismatch_rows || 0),
      score: Number(base.score || 0),
      severity: String(base.severity || ''),
      cause,
      cause_reason: causeReason,
      source_extracted_fields: sourceExtraction.extractedCount,
      source_identity_diff: sourceIdentityDiff,
      parsed_identity_diff: parsedIdentityDiff,
      compared_mismatch_fields: compare.mismatches.map((item) => item.field).join('|'),
      source_totals: sourceExtraction.totals,
      parsed_totals: parsedTotals,
    });

    if ((i + 1) % 20 === 0) {
      console.log(`[classify-table3-mismatch-causes] ${i + 1}/${reportIds.length}`);
    }
  }

  const parseBiasRows = classified.filter((row) => row.cause === 'ai_parse_bias_likely');
  const sourceIssueRows = classified.filter((row) => row.cause === 'source_data_issue_likely');
  const insufficientRows = classified.filter((row) => row.cause === 'source_extract_insufficient');

  const timestamp = buildTimestamp();
  const allJsonPath = path.join(outDir, `table3_mismatch_cause_classified_${timestamp}.json`);
  const allCsvPath = path.join(outDir, `table3_mismatch_cause_classified_${timestamp}.csv`);
  const parseBiasCsvPath = path.join(outDir, `table3_ai_parse_bias_only_${timestamp}.csv`);
  const sourceIssueCsvPath = path.join(outDir, `table3_source_data_issue_only_${timestamp}.csv`);
  const summaryJsonPath = path.join(outDir, `table3_mismatch_cause_summary_${timestamp}.json`);

  const csvHeaders = [
    'report_id',
    'version_id',
    'year',
    'region_id',
    'region_name',
    'detail_mismatch_rows',
    'total_mismatch_rows',
    'score',
    'severity',
    'cause',
    'cause_reason',
    'source_extracted_fields',
    'source_identity_diff',
    'parsed_identity_diff',
    'compared_mismatch_fields',
    'source_totals',
    'parsed_totals',
  ];

  const toCsvRows = (rows: ClassifiedRow[]) =>
    rows.map((row) => ({
      ...row,
      source_totals: JSON.stringify(row.source_totals),
      parsed_totals: JSON.stringify(row.parsed_totals),
    }));

  const summary = {
    scanned_at: new Date().toISOString(),
    report_summary_input: reportSummaryPath,
    provider: providerName,
    model: modelName,
    min_source_fields: minSourceFields,
    source_path_recovered_by_hash: recoveredMissingSourceByHash,
    source_path_missing_after_hash_recovery: unresolvedMissingSource,
    counts: {
      total_reports: classified.length,
      ai_parse_bias_likely: parseBiasRows.length,
      source_data_issue_likely: sourceIssueRows.length,
      source_extract_insufficient: insufficientRows.length,
      detail_level_or_other: classified.length - parseBiasRows.length - sourceIssueRows.length - insufficientRows.length,
    },
  };

  await fsp.writeFile(allJsonPath, JSON.stringify(classified, null, 2), 'utf8');
  await fsp.writeFile(allCsvPath, toCsv(toCsvRows(classified), csvHeaders), 'utf8');
  await fsp.writeFile(parseBiasCsvPath, toCsv(toCsvRows(parseBiasRows), csvHeaders), 'utf8');
  await fsp.writeFile(sourceIssueCsvPath, toCsv(toCsvRows(sourceIssueRows), csvHeaders), 'utf8');
  await fsp.writeFile(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(
    JSON.stringify(
      {
        summary,
        artifacts: {
          all_json: allJsonPath,
          all_csv: allCsvPath,
          ai_parse_bias_csv: parseBiasCsvPath,
          source_data_issue_csv: sourceIssueCsvPath,
          summary_json: summaryJsonPath,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[classify-table3-mismatch-causes] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
