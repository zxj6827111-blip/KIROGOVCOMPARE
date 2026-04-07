import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_DIR } from '../config/constants';
import { resolveAbsoluteStoragePath } from '../services/SourceFileGuardService';
import { loadUserText } from '../services/LlmCommon';

type FieldKey = 'new_received' | 'carried_over' | 'total_processed' | 'carried_forward';

type InputRow = {
  report_id: number;
  version_id: number;
  year: number | null;
  region_name: string;
  old_cause_reason: string;
  old_source_extracted_fields: number;
};

type VersionMeta = {
  report_id: number;
  version_id: number;
  storage_path: string;
  file_hash: string | null;
  file_name: string | null;
};

type ExtractionResult = {
  totals: Record<FieldKey, number | null>;
  source: Record<FieldKey, string>;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
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

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cur += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ',') {
      out.push(cur);
      cur = '';
      continue;
    }

    cur += ch;
  }
  out.push(cur);
  return out;
}

async function loadInputRows(inputPath: string): Promise<InputRow[]> {
  const raw = await fsp.readFile(inputPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header, idx) => {
    if (idx === 0) {
      return header.replace(/^\uFEFF/, '');
    }
    return header;
  });
  const idx = (name: string): number => headers.indexOf(name);

  const reportIdx = idx('report_id');
  const versionIdx = idx('version_id');
  const yearIdx = idx('year');
  const regionIdx = idx('region_name');
  const reasonIdx = idx('cause_reason');
  const fieldsIdx = idx('source_extracted_fields');

  if (reportIdx < 0 || versionIdx < 0) {
    throw new Error('input_csv_missing_required_columns');
  }

  const rows: InputRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const reportId = Number(cols[reportIdx]);
    const versionId = Number(cols[versionIdx]);
    if (!Number.isInteger(reportId) || reportId <= 0 || !Number.isInteger(versionId) || versionId <= 0) {
      continue;
    }

    const yearRaw = yearIdx >= 0 ? Number(cols[yearIdx]) : NaN;
    rows.push({
      report_id: reportId,
      version_id: versionId,
      year: Number.isInteger(yearRaw) ? yearRaw : null,
      region_name: regionIdx >= 0 ? cols[regionIdx] : '',
      old_cause_reason: reasonIdx >= 0 ? cols[reasonIdx] : '',
      old_source_extracted_fields: fieldsIdx >= 0 ? Number(cols[fieldsIdx] || 0) : 0,
    });
  }

  return rows;
}

async function loadVersionMeta(versionIds: number[]): Promise<Map<number, VersionMeta>> {
  const mapping = new Map<number, VersionMeta>();
  if (versionIds.length === 0) return mapping;

  const result = await pool.query(
    `SELECT id::int AS version_id,
            report_id::int AS report_id,
            storage_path,
            file_hash,
            file_name
       FROM report_versions
      WHERE id = ANY($1::int[])`,
    [versionIds]
  );

  for (const row of result.rows) {
    mapping.set(Number(row.version_id), {
      version_id: Number(row.version_id),
      report_id: Number(row.report_id),
      storage_path: String(row.storage_path || ''),
      file_hash: row.file_hash ?? null,
      file_name: row.file_name ?? null,
    });
  }
  return mapping;
}

function coerceNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || text === '/' || text === '-' || text === '--') return null;
  const normalized = text.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastIntegerFromText(text: string): number | null {
  const matches = String(text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return Number(matches[matches.length - 1]);
}

function firstIntegerFromText(text: string): number | null {
  const matches = String(text || '').match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  return Number(matches[0]);
}

function normalizeText(input: string): string {
  return String(input || '')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyExtraction(): ExtractionResult {
  return {
    totals: {
      new_received: null,
      carried_over: null,
      total_processed: null,
      carried_forward: null,
    },
    source: {
      new_received: '',
      carried_over: '',
      total_processed: '',
      carried_forward: '',
    },
  };
}

function mergeExtraction(base: ExtractionResult, patch: ExtractionResult): ExtractionResult {
  const merged = emptyExtraction();
  for (const key of Object.keys(base.totals) as FieldKey[]) {
    merged.totals[key] = base.totals[key];
    merged.source[key] = base.source[key];
    if (merged.totals[key] === null && patch.totals[key] !== null) {
      merged.totals[key] = patch.totals[key];
      merged.source[key] = patch.source[key];
    }
  }
  return merged;
}

function extractFromTextWindow(text: string): ExtractionResult {
  const output = emptyExtraction();
  const normalized = String(text || '');

  const patterns: Array<{ key: FieldKey; labelRegex: RegExp }> = [
    { key: 'new_received', labelRegex: /本年新收(?:政府信息公开申请)?(?:数量)?/g },
    { key: 'carried_over', labelRegex: /上年结转(?:政府信息公开申请)?(?:数量)?/g },
    { key: 'total_processed', labelRegex: /(?:（七）总计|\(七\)总计|七[、，.]?总计|总计[（(]?7[）)]?)/g },
    { key: 'carried_forward', labelRegex: /结转下年度继续办理|结转下一年度继续办理/g },
  ];

  for (const item of patterns) {
    let matched: RegExpExecArray | null;
    while ((matched = item.labelRegex.exec(normalized)) !== null) {
      const start = matched.index;
      const segment = normalized.slice(start, Math.min(normalized.length, start + 180));
      const value = firstIntegerFromText(segment);
      if (value !== null) {
        output.totals[item.key] = value;
        output.source[item.key] = 'text_window';
        break;
      }
    }
  }

  return output;
}

function extractFromHtmlTable(html: string): ExtractionResult {
  const output = emptyExtraction();
  const $ = cheerio.load(html);

  const processRow = (rowTextRaw: string): void => {
    const rowText = normalizeText(rowTextRaw);
    if (!rowText) return;
    const value = lastIntegerFromText(rowText);
    if (value === null) return;

    if (output.totals.new_received === null && /本年新收/.test(rowText)) {
      output.totals.new_received = value;
      output.source.new_received = 'html_table_row';
      return;
    }

    if (output.totals.carried_over === null && /上年结转/.test(rowText)) {
      output.totals.carried_over = value;
      output.source.carried_over = 'html_table_row';
      return;
    }

    if (
      output.totals.total_processed === null &&
      (/（七）总计|\(七\)总计|七[、，.]?总计|总计[（(]?7[）)]?/.test(rowText))
    ) {
      output.totals.total_processed = value;
      output.source.total_processed = 'html_table_row';
      return;
    }

    if (
      output.totals.carried_forward === null &&
      (/结转下年度继续办理|结转下一年度继续办理/.test(rowText))
    ) {
      output.totals.carried_forward = value;
      output.source.carried_forward = 'html_table_row';
    }
  };

  $('tr').each((_, tr) => {
    const cells = $(tr)
      .find('th,td')
      .map((__, cell) => normalizeText($(cell).text()))
      .get()
      .filter((text) => text.length > 0);

    if (cells.length > 0) {
      processRow(cells.join(' '));
    } else {
      processRow($(tr).text());
    }
  });

  return output;
}

type PathResolution = {
  path: string | null;
  mode: 'storage_path' | 'file_hash_fallback' | 'missing';
};

function buildUploadHashIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!fs.existsSync(rootDir)) return index;

  const stack = [rootDir];
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
      if (!entry.isFile()) continue;
      const matched = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(entry.name);
      if (!matched) continue;
      const hash = matched[1].toLowerCase();
      const list = index.get(hash) || [];
      list.push(full);
      index.set(hash, list);
    }
  }
  return index;
}

function resolvePath(meta: VersionMeta, hashIndex: Map<string, string[]>): PathResolution {
  const byStorage = resolveAbsoluteStoragePath(meta.storage_path);
  if (fs.existsSync(byStorage)) {
    return { path: byStorage, mode: 'storage_path' };
  }

  const hash = String(meta.file_hash || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(hash)) {
    const matches = hashIndex.get(hash) || [];
    if (matches.length === 1 && fs.existsSync(matches[0])) {
      return { path: matches[0], mode: 'file_hash_fallback' };
    }
  }

  return { path: null, mode: 'missing' };
}

async function main(): Promise<void> {
  const inputArg = parseArg('input-csv') || path.resolve(process.cwd(), 'tmp/table3_source_extract_insufficient_only_20260305_210032.csv');
  const inputPath = path.isAbsolute(inputArg) ? inputArg : path.resolve(process.cwd(), inputArg);
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);

  const inputRows = await loadInputRows(inputPath);
  const versionMeta = await loadVersionMeta(inputRows.map((row) => row.version_id));
  const hashIndex = buildUploadHashIndex(UPLOADS_DIR);

  const details: Array<Record<string, unknown>> = [];
  const summary = {
    total_input_rows: inputRows.length,
    resolved_by_storage_path: 0,
    resolved_by_file_hash_fallback: 0,
    unresolved_missing_file: 0,
    source_has_enough_fields_likely: 0,
    source_still_insufficient: 0,
  };

  for (let i = 0; i < inputRows.length; i += 1) {
    const row = inputRows[i];
    const meta = versionMeta.get(row.version_id);
    if (!meta) {
      details.push({
        ...row,
        ext: '',
        resolved_mode: 'missing_meta',
        resolved_path: '',
        new_extracted_fields: 0,
        new_received: null,
        carried_over: null,
        total_processed: null,
        carried_forward: null,
        reassess: 'meta_missing',
      });
      continue;
    }

    const resolved = resolvePath(meta, hashIndex);
    if (resolved.mode === 'storage_path') summary.resolved_by_storage_path += 1;
    if (resolved.mode === 'file_hash_fallback') summary.resolved_by_file_hash_fallback += 1;
    if (resolved.mode === 'missing') summary.unresolved_missing_file += 1;

    if (!resolved.path) {
      details.push({
        ...row,
        ext: path.extname(meta.storage_path || '').toLowerCase(),
        resolved_mode: resolved.mode,
        resolved_path: '',
        storage_path: meta.storage_path,
        file_hash: meta.file_hash,
        new_extracted_fields: 0,
        new_received: null,
        carried_over: null,
        total_processed: null,
        carried_forward: null,
        source_new_received: '',
        source_carried_over: '',
        source_total_processed: '',
        source_carried_forward: '',
        reassess: 'file_missing',
      });
      continue;
    }

    const ext = path.extname(resolved.path).toLowerCase();
    const extracted = emptyExtraction();

    if (ext === '.html' || ext === '.htm') {
      try {
        const html = await fsp.readFile(resolved.path, 'utf8');
        const fromHtml = extractFromHtmlTable(html);
        const merged = mergeExtraction(extracted, fromHtml);
        extracted.totals = merged.totals;
        extracted.source = merged.source;
      } catch {
        // keep empty and continue with text extraction fallback
      }
    }

    let loadedText = '';
    try {
      const loaded = await loadUserText(resolved.path, {
        reportId: row.report_id,
        versionId: row.version_id,
        storagePath: resolved.path,
        fileHash: meta.file_hash || undefined,
      });
      loadedText = loaded.text || '';
    } catch {
      loadedText = '';
    }

    if (loadedText.trim().length > 0) {
      const fromText = extractFromTextWindow(loadedText);
      const merged = mergeExtraction(extracted, fromText);
      extracted.totals = merged.totals;
      extracted.source = merged.source;
    }

    const newExtractedFields = (Object.keys(extracted.totals) as FieldKey[]).filter((key) => typeof extracted.totals[key] === 'number').length;
    const reassess = newExtractedFields >= 3 ? 'source_has_enough_fields_likely' : 'source_still_insufficient';
    if (reassess === 'source_has_enough_fields_likely') {
      summary.source_has_enough_fields_likely += 1;
    } else {
      summary.source_still_insufficient += 1;
    }

    details.push({
      report_id: row.report_id,
      version_id: row.version_id,
      year: row.year,
      region_name: row.region_name,
      old_cause_reason: row.old_cause_reason,
      old_source_extracted_fields: row.old_source_extracted_fields,
      storage_path: meta.storage_path,
      file_hash: meta.file_hash,
      ext,
      resolved_mode: resolved.mode,
      resolved_path: resolved.path,
      new_extracted_fields: newExtractedFields,
      new_received: extracted.totals.new_received,
      carried_over: extracted.totals.carried_over,
      total_processed: extracted.totals.total_processed,
      carried_forward: extracted.totals.carried_forward,
      source_new_received: extracted.source.new_received,
      source_carried_over: extracted.source.carried_over,
      source_total_processed: extracted.source.total_processed,
      source_carried_forward: extracted.source.carried_forward,
      reassess,
    });

    if ((i + 1) % 10 === 0) {
      console.log(`[recheck-source-extract-insufficient] ${i + 1}/${inputRows.length}`);
    }
  }

  await fsp.mkdir(outDir, { recursive: true });
  const timestamp = buildTimestamp();
  const detailsPath = path.join(outDir, `source_extract_insufficient_recheck_details_${timestamp}.csv`);
  const summaryPath = path.join(outDir, `source_extract_insufficient_recheck_summary_${timestamp}.json`);

  const headers = [
    'report_id',
    'version_id',
    'year',
    'region_name',
    'old_cause_reason',
    'old_source_extracted_fields',
    'storage_path',
    'file_hash',
    'ext',
    'resolved_mode',
    'resolved_path',
    'new_extracted_fields',
    'new_received',
    'carried_over',
    'total_processed',
    'carried_forward',
    'source_new_received',
    'source_carried_over',
    'source_total_processed',
    'source_carried_forward',
    'reassess',
  ];

  await fsp.writeFile(detailsPath, toCsv(details, headers), 'utf8');
  await fsp.writeFile(
    summaryPath,
    JSON.stringify(
      {
        scanned_at: new Date().toISOString(),
        input_csv: inputPath,
        ...summary,
        artifacts: {
          details_csv: detailsPath,
        },
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        summary: {
          scanned_at: new Date().toISOString(),
          input_csv: inputPath,
          ...summary,
        },
        artifacts: {
          details_csv: detailsPath,
          summary_json: summaryPath,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[recheck-source-extract-insufficient] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
