import fs from 'fs';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT } from '../config/constants';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { materializeService } from '../services/data-center/MaterializeService';
import { stabilizeParsedOutput } from '../services/ParsedOutputStabilityService';

type TargetRow = {
  report_id: number;
  version_id: number;
  storage_path: string;
  file_hash: string | null;
};

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

function parseIdList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function resolveStoragePath(storagePath: string): string {
  return path.isAbsolute(storagePath) ? storagePath : path.resolve(PROJECT_ROOT, storagePath);
}

function hasCriticalTables(output: any): boolean {
  if (!output || typeof output !== 'object') return false;
  const sections = Array.isArray(output.sections) ? output.sections : [];
  const hasSection = (type: string) => sections.some((item: any) => item?.type === type);
  return (
    hasSection('table_2') ||
    hasSection('table_3') ||
    hasSection('table_4') ||
    Boolean(output.activeDisclosureData) ||
    Boolean(output.tableData) ||
    Boolean(output.reviewLitigationData)
  );
}

async function loadTargets(limit: number, reportIds: number[]): Promise<TargetRow[]> {
  if (reportIds.length > 0) {
    const result = await pool.query(
      `SELECT r.id::int AS report_id,
              r.active_version_id::int AS version_id,
              rv.storage_path,
              rv.file_hash
       FROM reports r
       JOIN report_versions rv ON rv.id = r.active_version_id
       WHERE r.id = ANY($1::int[])
       ORDER BY r.id`,
      [reportIds]
    );
    return result.rows as TargetRow[];
  }

  const result = await pool.query(
    `SELECT r.id::int AS report_id,
            r.active_version_id::int AS version_id,
            rv.storage_path,
            rv.file_hash
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
     WHERE r.active_version_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM fact_active_disclosure fad
         WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_application fa
         WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_legal_proceeding flp
         WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id
       )
     ORDER BY r.id
     LIMIT $1`,
    [limit]
  );
  return result.rows as TargetRow[];
}

async function countMissingActiveFacts(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM reports r
     WHERE r.active_version_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM fact_active_disclosure fad
         WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_application fa
         WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_legal_proceeding flp
         WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id
       )`
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function saveParseOutput(versionId: number, provider: string, model: string, output: any): Promise<void> {
  const outputJson = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

  await pool.query(
    `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [versionId, provider, model, outputJson]
  );

  await pool.query(
    `UPDATE report_versions
     SET parsed_json = $1,
         provider = $2,
         model = $3,
         prompt_version = 'v1',
         updated_at = NOW()
     WHERE id = $4`,
    [outputJson, provider, model, versionId]
  );
}

async function main(): Promise<void> {
  const limit = toInt(parseArg('limit'), 2000);
  const reportIds = parseIdList(parseArg('reports'));
  const maxAttempts = toInt(parseArg('max-attempts'), 2);
  const providerName = parseArg('provider') || process.env.LLM_PARSE_PROVIDER || process.env.LLM_PROVIDER || 'stub';
  const modelName = parseArg('model') || process.env.LLM_PARSE_MODEL || process.env.LLM_MODEL || '';

  const beforeMissing = await countMissingActiveFacts();
  const rows = await loadTargets(limit, reportIds);
  const provider = createLlmProvider(providerName, modelName);

  let skippedMissingFile = 0;
  let parseSuccess = 0;
  let parseFailure = 0;
  let materializeSuccess = 0;
  let materializeFailure = 0;
  const details: Array<Record<string, any>> = [];

  for (const row of rows) {
    const resolvedPath = resolveStoragePath(row.storage_path);
    if (!fs.existsSync(resolvedPath)) {
      skippedMissingFile += 1;
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        status: 'skipped_missing_file',
        storage_path: row.storage_path,
      });
      continue;
    }

    let done = false;
    let lastError = '';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const parseResult = await provider.parse({
          reportId: row.report_id,
          versionId: row.version_id,
          storagePath: resolvedPath,
          fileHash: row.file_hash || undefined,
        });

        const stabilized = stabilizeParsedOutput(parseResult.output);
        const output = stabilized.output;
        await saveParseOutput(row.version_id, parseResult.provider, parseResult.model, output);
        parseSuccess += 1;

        const tableReady = hasCriticalTables(output);
        const materialize = await materializeService.materializeVersion(row.version_id);
        if (materialize.success && (materialize.factsCreated ?? 0) > 0) {
          materializeSuccess += 1;
          details.push({
            report_id: row.report_id,
            version_id: row.version_id,
            attempt,
            provider: parseResult.provider,
            model: parseResult.model,
            repaired_cells: stabilized.repairs.length,
            has_critical_tables: tableReady,
            facts_created: materialize.factsCreated,
            cells_created: materialize.cellsCreated,
            status: 'ok',
          });
          done = true;
          break;
        }

        materializeFailure += 1;
        lastError = materialize.error || 'materialize_empty_facts';
        details.push({
          report_id: row.report_id,
          version_id: row.version_id,
          attempt,
          provider: parseResult.provider,
          model: parseResult.model,
          repaired_cells: stabilized.repairs.length,
          has_critical_tables: tableReady,
          facts_created: materialize.factsCreated,
          cells_created: materialize.cellsCreated,
          error: lastError,
          status: 'materialize_failed',
        });
      } catch (error) {
        parseFailure += 1;
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        details.push({
          report_id: row.report_id,
          version_id: row.version_id,
          attempt,
          error: message,
          status: 'parse_failed',
        });
      }
    }

    if (!done) {
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        status: 'failed_after_retries',
        error: lastError || 'unknown',
      });
    }
  }

  const afterMissing = await countMissingActiveFacts();
  console.log(
    JSON.stringify(
      {
        provider: providerName,
        model: modelName,
        max_attempts: maxAttempts,
        limit,
        requested_reports: reportIds,
        before_missing_active_facts: beforeMissing,
        scanned: rows.length,
        skipped_missing_file: skippedMissingFile,
        parse_success: parseSuccess,
        parse_failed: parseFailure,
        materialize_success: materializeSuccess,
        materialize_failed: materializeFailure,
        after_missing_active_facts: afterMissing,
        details,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[reparse-missing-active-facts] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
