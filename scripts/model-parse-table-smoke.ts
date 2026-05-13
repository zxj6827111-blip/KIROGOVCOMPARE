import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import pool from '../src/config/database-llm';
import { createLlmProvider } from '../src/services/LlmProviderFactory';
import { materializeReportVersion } from '../src/services/MaterializeService';
import { calculateFileHash } from '../src/utils/fileHash';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

type ProviderName = 'openai';
type SampleFormat = 'html' | 'txt' | 'pdf';

interface ModelTarget {
  label: string;
  provider: ProviderName;
  model: string;
}

interface SampleTarget {
  format: SampleFormat;
  storagePath: string;
  year: number;
}

interface SmokeResult {
  label: string;
  provider: ProviderName;
  model: string;
  format: SampleFormat;
  storagePath: string;
  reportId?: number;
  versionId?: number;
  ok: boolean;
  durationMs: number;
  counts?: Record<string, number>;
  extracted?: Record<string, unknown>;
  sourceCheck?: Record<string, unknown>;
  sampleCells?: Array<Record<string, unknown>>;
  error?: string;
}

const RUN_TAG = `CODEX_MODEL_SMOKE_${Date.now()}`;

const SAMPLES: SampleTarget[] = [
  {
    format: 'html',
    storagePath:
      'data/uploads/1000/2021/1e8b3e918b0191d0e8522c6a1aa905aab50e7088c58606fe11491fee9c314cd9.html',
    year: 2021,
  },
  {
    format: 'txt',
    storagePath:
      'data/uploads/775/2025/6bc1f395e89564496ffa0a72c6ae95521c7ad583cacd6c581fb3255a8806268c.txt',
    year: 2025,
  },
  {
    format: 'pdf',
    storagePath:
      'data/uploads/789/2023/6cabe1ff99a82cc8568fad606927bbc97d764505545f98b57492c8402991ae40.pdf',
    year: 2023,
  },
];

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function csvSet<T extends string>(name: string, fallback: T[]): Set<T> {
  const value = argValue(name);
  if (!value) return new Set(fallback);
  return new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean) as T[]
  );
}

function intArg(name: string, fallback: number): number {
  const parsed = Number(argValue(name));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleStable<T>(items: T[], seed: number): T[] {
  const random = seededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sampleFormatFromPath(filePath: string): SampleFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.txt') return 'txt';
  if (ext === '.pdf') return 'pdf';
  return null;
}

function inferYearFromPath(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/\/(20\d{2})\//);
  return match ? Number(match[1]) : new Date().getFullYear();
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  await visit(root);
  return out;
}

async function buildAutoSamples(formatFilter: Set<SampleFormat>, perFormat: number, seed: number): Promise<SampleTarget[]> {
  const root = path.resolve(process.cwd(), 'data', 'uploads');
  const minBytes = intArg('min-file-bytes', 512);
  const maxBytes = intArg('max-file-mb', 12) * 1024 * 1024;
  const files = await walkFiles(root);
  const buckets = new Map<SampleFormat, SampleTarget[]>();

  for (const absolutePath of files) {
    const format = sampleFormatFromPath(absolutePath);
    if (!format || !formatFilter.has(format)) continue;

    const stats = await fs.promises.stat(absolutePath);
    if (stats.size < minBytes || stats.size > maxBytes) continue;

    const storagePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
    const list = buckets.get(format) || [];
    list.push({ format, storagePath, year: inferYearFromPath(storagePath) });
    buckets.set(format, list);
  }

  const samples: SampleTarget[] = [];
  for (const format of Array.from(formatFilter).sort()) {
    const list = buckets.get(format) || [];
    samples.push(...shuffleStable(list, seed + format.charCodeAt(0)).slice(0, perFormat));
  }
  return samples;
}

function assertEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function buildModelTargets(): ModelTarget[] {
  assertEnv('OPENAI_API_KEY');
  assertEnv('OPENAI_BASE_URL');

  return [{ label: 'GPT-5.5', provider: 'openai', model: 'gpt-5.5' }];
}

function providerBaseUrl(provider: ProviderName): string {
  return process.env.OPENAI_BASE_URL || '';
}

function relativeStoragePath(storagePath: string): string {
  const absolutePath = path.isAbsolute(storagePath) ? storagePath : path.resolve(process.cwd(), storagePath);
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
}

function getSections(parsed: any): any[] {
  return Array.isArray(parsed?.sections) ? parsed.sections : [];
}

function getSection(parsed: any, type: string): any {
  return getSections(parsed).find((section) => section?.type === type);
}

function summarizeExtracted(parsed: any): Record<string, unknown> {
  const table2 = getSection(parsed, 'table_2')?.activeDisclosureData || parsed?.activeDisclosureData || {};
  const table3 = getSection(parsed, 'table_3')?.tableData || parsed?.tableData || {};
  const table4 = getSection(parsed, 'table_4')?.reviewLitigationData || parsed?.reviewLitigationData || {};

  return {
    sections: getSections(parsed).map((section) => section?.type).filter(Boolean),
    activeDisclosure: {
      regulationsMade: table2?.regulations?.made ?? null,
      regulationsValid: table2?.regulations?.valid ?? null,
      normativeDocumentsMade: table2?.normativeDocuments?.made ?? null,
      licensingProcessed: table2?.licensing?.processed ?? null,
    },
    applications: {
      totalNewReceived: table3?.total?.newReceived ?? null,
      totalGranted: table3?.total?.results?.granted ?? null,
      totalProcessed: table3?.total?.results?.totalProcessed ?? null,
      totalCarriedForward: table3?.total?.results?.carriedForward ?? null,
    },
    legalProceeding: {
      reviewTotal: table4?.review?.total ?? null,
      litigationDirectTotal: table4?.litigationDirect?.total ?? null,
      litigationPostReviewTotal: table4?.litigationPostReview?.total ?? null,
    },
  };
}

function getTablePayloads(parsed: any): Record<string, unknown> {
  return {
    table2: getSection(parsed, 'table_2')?.activeDisclosureData || parsed?.activeDisclosureData || {},
    table3: getSection(parsed, 'table_3')?.tableData || parsed?.tableData || {},
    table4: getSection(parsed, 'table_4')?.reviewLitigationData || parsed?.reviewLitigationData || {},
  };
}

function normalizeDigits(text: string): string {
  return text.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10)).replace(/,/g, '');
}

function normalizeNumber(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num === 0) return null;
  return Number.isInteger(num) ? String(num) : String(num).replace(/\.?0+$/, '');
}

function collectNonZeroNumbers(value: unknown, out: string[]): void {
  const normalized = normalizeNumber(value);
  if (normalized) {
    out.push(normalized);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectNonZeroNumbers(item, out));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => collectNonZeroNumbers(item, out));
  }
}

function countMeaningfulValues(value: unknown): number {
  let count = 0;
  function visit(item: unknown): void {
    if (item === null || item === undefined || item === '') return;
    if (typeof item === 'number') {
      count += 1;
      return;
    }
    if (typeof item === 'string') {
      if (item.trim() && item.trim() !== '---') count += 1;
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (item && typeof item === 'object') {
      Object.values(item as Record<string, unknown>).forEach(visit);
    }
  }
  visit(value);
  return count;
}

function sourceContainsNumber(sourceText: string, numberText: string): boolean {
  const escaped = numberText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9.])${escaped}([^0-9.]|$)`).test(sourceText);
}

function evaluateSourceCheck(parsed: any, sourceText: string): Record<string, unknown> {
  const tables = getTablePayloads(parsed);
  const source = normalizeDigits(sourceText || '');
  const numbers: string[] = [];
  Object.values(tables).forEach((table) => collectNonZeroNumbers(table, numbers));
  const uniqueNumbers = Array.from(new Set(numbers));
  const matched = uniqueNumbers.filter((num) => sourceContainsNumber(source, num));
  const issues: string[] = [];

  if (uniqueNumbers.length > 0 && matched.length / uniqueNumbers.length < 0.8) {
    issues.push(`low_source_number_match:${matched.length}/${uniqueNumbers.length}`);
  }
  if (countMeaningfulValues(tables.table2) === 0) issues.push('table2_empty');
  if (countMeaningfulValues(tables.table3) === 0) issues.push('table3_empty');
  if (countMeaningfulValues(tables.table4) === 0) issues.push('table4_empty');

  return {
    numbersChecked: uniqueNumbers.length,
    numbersMatched: matched.length,
    sourceNumberMatchRate: uniqueNumbers.length > 0 ? Number((matched.length / uniqueNumbers.length).toFixed(3)) : null,
    tableValueCounts: {
      table2: countMeaningfulValues(tables.table2),
      table3: countMeaningfulValues(tables.table3),
      table4: countMeaningfulValues(tables.table4),
    },
    issues,
  };
}

async function createSmokeShell(sample: SampleTarget, model: ModelTarget): Promise<{ reportId: number; versionId: number }> {
  const absolutePath = path.resolve(process.cwd(), sample.storagePath);
  const stats = await fs.promises.stat(absolutePath);
  const fileHash = await calculateFileHash(absolutePath);
  const regionCode = `${RUN_TAG}_${model.provider}_${sample.format}_${fileHash.slice(0, 8)}`.slice(0, 50);

  const regionRes = await pool.query(
    `INSERT INTO regions (code, name, level)
     VALUES ($1, $2, 0)
     RETURNING id`,
    [regionCode, `${RUN_TAG} ${model.label} ${sample.format}`]
  );
  const regionId = Number(regionRes.rows[0].id);

  const reportRes = await pool.query(
    `INSERT INTO reports (region_id, year, unit_name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [regionId, sample.year, `${RUN_TAG} ${model.label} ${sample.format}`]
  );
  const reportId = Number(reportRes.rows[0].id);

  const versionRes = await pool.query(
    `INSERT INTO report_versions (
       report_id,
       file_name,
       file_hash,
       file_size,
       storage_path,
       provider,
       model,
       prompt_version,
       parsed_json,
       schema_version,
       is_active,
       state,
       review_status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'model_parse_table_smoke', $8::jsonb, 'v1', false, 'smoke_pending', 'published')
     RETURNING id`,
    [
      reportId,
      path.basename(sample.storagePath),
      fileHash,
      stats.size,
      relativeStoragePath(sample.storagePath),
      model.provider,
      model.model,
      JSON.stringify({ smoke_pending: true, run_tag: RUN_TAG }),
    ]
  );
  const versionId = Number(versionRes.rows[0].id);

  await pool.query('UPDATE reports SET active_version_id = $1 WHERE id = $2', [versionId, reportId]);

  return { reportId, versionId };
}

async function queryMaterializedCounts(versionId: number): Promise<Record<string, number>> {
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM cells WHERE version_id = $1) AS cells,
       (SELECT COUNT(*)::int FROM cells WHERE version_id = $1 AND value_num IS NOT NULL) AS numeric_cells,
       (SELECT COUNT(*)::int FROM cells WHERE version_id = $1 AND value_num IS NOT NULL AND value_num <> 0) AS nonzero_numeric_cells,
       (SELECT COUNT(*)::int FROM fact_active_disclosure WHERE version_id = $1) AS fact_active_disclosure,
       (SELECT COUNT(*)::int FROM fact_application WHERE version_id = $1) AS fact_application,
       (SELECT COUNT(*)::int FROM fact_application WHERE version_id = $1 AND count IS NOT NULL) AS fact_application_numeric,
       (SELECT COUNT(*)::int FROM fact_legal_proceeding WHERE version_id = $1) AS fact_legal_proceeding,
       (SELECT COUNT(*)::int FROM fact_legal_proceeding WHERE version_id = $1 AND count IS NOT NULL) AS fact_legal_numeric`,
    [versionId]
  );
  return Object.fromEntries(Object.entries(res.rows[0]).map(([key, value]) => [key, Number(value)]));
}

async function querySampleCells(versionId: number): Promise<Array<Record<string, unknown>>> {
  const res = await pool.query(
    `SELECT table_id, row_key, col_key, value_raw, value_num::text AS value_num, value_semantic
     FROM cells
     WHERE version_id = $1
     ORDER BY table_id, row_key, col_key
     LIMIT 12`,
    [versionId]
  );
  return res.rows;
}

function validateCounts(counts: Record<string, number>): string[] {
  const issues: string[] = [];
  if ((counts.cells || 0) <= 0) issues.push('cells_empty');
  if ((counts.numeric_cells || 0) <= 0) issues.push('numeric_cells_empty');
  if ((counts.fact_active_disclosure || 0) <= 0) issues.push('fact_active_disclosure_empty');
  if ((counts.fact_application || 0) <= 0) issues.push('fact_application_empty');
  if ((counts.fact_legal_proceeding || 0) <= 0) issues.push('fact_legal_proceeding_empty');
  return issues;
}

async function runConnectivity(model: ModelTarget): Promise<void> {
  const provider = createLlmProvider(model.provider, model.model);
  const generator = (provider as any).generate;
  if (typeof generator !== 'function') {
    throw new Error(`${model.provider} provider does not support generate()`);
  }

  const response = await generator.call(
    provider,
    'Return JSON only: {"status":"ok","task":"connectivity"}.',
    'You are a connectivity smoke test. Return only valid JSON.',
    {
      maxOutputTokens: 256,
      responseSchemaName: 'connectivity_smoke',
      responseSchemaDescription: 'Connectivity smoke test.',
      responseSchema: {
        type: 'object',
        additionalProperties: true,
        required: ['status', 'task'],
        properties: {
          status: { type: 'string' },
          task: { type: 'string' },
        },
      },
      responseStrict: false,
    }
  );

  const text = String(response?.text || '').trim();
  if (!text) {
    throw new Error(`${model.label} connectivity returned empty text`);
  }
}

async function runCase(model: ModelTarget, sample: SampleTarget): Promise<SmokeResult> {
  const startedAt = Date.now();
  let reportId: number | undefined;
  let versionId: number | undefined;

  try {
    const shell = await createSmokeShell(sample, model);
    reportId = shell.reportId;
    versionId = shell.versionId;

    const provider = createLlmProvider(model.provider, model.model);
    const result = await provider.parse({
      reportId,
      versionId,
      storagePath: relativeStoragePath(sample.storagePath),
    });

    await pool.query(
      `UPDATE report_versions
       SET provider = $1,
           model = $2,
           parsed_json = $3::jsonb,
           raw_text = $4,
           state = 'parsed',
           updated_at = NOW()
       WHERE id = $5`,
      [result.provider, result.model, JSON.stringify(result.output), result.sourceText || '', versionId]
    );

    await materializeReportVersion({ reportId, versionId, parsedJson: result.output });

    const counts = await queryMaterializedCounts(versionId);
    const issues = validateCounts(counts);
    const sampleCells = await querySampleCells(versionId);

    if (issues.length > 0) {
      throw new Error(`materialized count validation failed: ${issues.join(', ')}`);
    }

    return {
      label: model.label,
      provider: model.provider,
      model: result.model || model.model,
      format: sample.format,
      storagePath: sample.storagePath,
      reportId,
      versionId,
      ok: true,
      durationMs: Date.now() - startedAt,
      counts,
      extracted: summarizeExtracted(result.output),
      sourceCheck: evaluateSourceCheck(result.output, result.sourceText || ''),
      sampleCells,
    };
  } catch (error: any) {
    return {
      label: model.label,
      provider: model.provider,
      model: model.model,
      format: sample.format,
      storagePath: sample.storagePath,
      reportId,
      versionId,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  }
}

async function cleanupRun(): Promise<void> {
  await pool.query('BEGIN');
  try {
    const reportRes = await pool.query(
      `SELECT r.id
       FROM reports r
       JOIN regions reg ON reg.id = r.region_id
       WHERE reg.code LIKE $1 OR r.unit_name LIKE $2`,
      [`${RUN_TAG}%`, `${RUN_TAG}%`]
    );
    const reportIds = reportRes.rows.map((row) => Number(row.id));

    if (reportIds.length > 0) {
      const versionRes = await pool.query(
        `SELECT id FROM report_versions WHERE report_id = ANY($1::bigint[])`,
        [reportIds]
      );
      const versionIds = versionRes.rows.map((row) => Number(row.id));

      await pool.query('UPDATE reports SET active_version_id = NULL WHERE id = ANY($1::bigint[])', [reportIds]);

      if (versionIds.length > 0) {
        await pool.query('DELETE FROM cells WHERE version_id = ANY($1::bigint[])', [versionIds]);
        await pool.query('DELETE FROM fact_active_disclosure WHERE version_id = ANY($1::bigint[])', [versionIds]);
        await pool.query('DELETE FROM fact_application WHERE version_id = ANY($1::bigint[])', [versionIds]);
        await pool.query('DELETE FROM fact_legal_proceeding WHERE version_id = ANY($1::bigint[])', [versionIds]);
        await pool.query('DELETE FROM report_versions WHERE id = ANY($1::bigint[])', [versionIds]);
      }

      await pool.query('DELETE FROM reports WHERE id = ANY($1::bigint[])', [reportIds]);
    }

    await pool.query('DELETE FROM regions WHERE code LIKE $1', [`${RUN_TAG}%`]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const keep = hasFlag('keep');
  const skipConnectivity = hasFlag('skip-connectivity');
  const autoSamplesPerFormat = intArg('auto-samples', 0);
  const seed = intArg('seed', 20260507);
  const providerFilter = csvSet<ProviderName>('providers', ['openai']);
  const formatFilter = csvSet<SampleFormat>('formats', ['html', 'txt', 'pdf']);
  const models = buildModelTargets().filter((model) => providerFilter.has(model.provider));
  const samples =
    autoSamplesPerFormat > 0
      ? await buildAutoSamples(formatFilter, autoSamplesPerFormat, seed)
      : SAMPLES.filter((sample) => formatFilter.has(sample.format));

  console.log(
    JSON.stringify(
      {
        runTag: RUN_TAG,
        keep,
        sampleMode: autoSamplesPerFormat > 0 ? 'auto_uploads' : 'fixed',
        sampleCount: samples.length,
        providers: models.map((model) => ({
          label: model.label,
          provider: model.provider,
          model: model.model,
          baseUrl: providerBaseUrl(model.provider),
        })),
        samples: samples.map((sample) => ({
          format: sample.format,
          year: sample.year,
          storagePath: sample.storagePath,
        })),
      },
      null,
      2
    )
  );

  const results: SmokeResult[] = [];

  try {
    if (!skipConnectivity) {
      for (const model of models) {
        const startedAt = Date.now();
        await runConnectivity(model);
        console.log(
          JSON.stringify({
            step: 'connectivity',
            label: model.label,
            provider: model.provider,
            model: model.model,
            ok: true,
            durationMs: Date.now() - startedAt,
          })
        );
      }
    }

    for (const model of models) {
      for (const sample of samples) {
        console.log(
          JSON.stringify({
            step: 'parse_materialize_start',
            label: model.label,
            provider: model.provider,
            model: model.model,
            format: sample.format,
            storagePath: sample.storagePath,
          })
        );
        const result = await runCase(model, sample);
        results.push(result);
        console.log(JSON.stringify({ step: 'parse_materialize_result', ...result }, null, 2));
      }
    }
  } finally {
    if (!keep) {
      await cleanupRun();
      console.log(JSON.stringify({ step: 'cleanup', runTag: RUN_TAG, ok: true }));
    } else {
      console.log(JSON.stringify({ step: 'cleanup_skipped', runTag: RUN_TAG, ok: true }));
    }
    await pool.end();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({ step: 'summary', ok: failed.length === 0, total: results.length, failed }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(JSON.stringify({ step: 'fatal', ok: false, error: error?.message || String(error) }, null, 2));
  try {
    await pool.end();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});
