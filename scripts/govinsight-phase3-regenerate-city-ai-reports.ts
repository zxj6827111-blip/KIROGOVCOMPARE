import pool from '../src/config/database-llm';
import { buildPrefixedModelValue, resolveFirstNonEmpty } from '../src/utils/aiEnv';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  buildGovInsightNarrativeResponseSchema,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
} from '../src/services/GovInsightReportProtocol';

interface CandidateRow {
  region_id: number;
  org_name: string;
  year: number;
  materialize_status: string;
  source_report_version_id: number | null;
  model_used: string | null;
  source_job_id: number | null;
}

const SYSTEM_INSTRUCTION = '请只返回符合 JSON Schema 的正式报告 JSON，不要输出 Markdown，也不要额外解释。';

function parseNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseStringArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  return raw ? raw.trim() : undefined;
}

function resolveGovInsightReportModel(override?: string): string {
  if (override) {
    return override.trim();
  }

  const provider = String(
    process.env.GOV_INSIGHT_REPORT_PROVIDER ||
    process.env.LLM_REPORT_PROVIDER ||
    process.env.LLM_PROVIDER
  )
    .trim()
    .toLowerCase();

  const model = resolveFirstNonEmpty(
    process.env.GOV_INSIGHT_REPORT_MODEL,
    process.env.LLM_REPORT_MODEL,
    process.env.OPENAI_MODEL,
    process.env.LLM_MODEL
  );

  return buildPrefixedModelValue(provider, model);
}

function buildRequestConfig(): Record<string, unknown> {
  return {
    temperature: Number(process.env.GOV_INSIGHT_REPORT_TEMPERATURE || 0.3),
    thinkingBudget: Number(process.env.GOV_INSIGHT_REPORT_THINKING_BUDGET || 0),
    responseMimeType: (process.env.GOV_INSIGHT_REPORT_RESPONSE_MIME_TYPE || 'application/json').trim(),
    maxOutputTokens: Number(process.env.GOV_INSIGHT_REPORT_MAX_OUTPUT_TOKENS || 4096),
    timeoutMs: Number(process.env.GOV_INSIGHT_REPORT_TIMEOUT_MS || 600000),
    responseSchema: buildGovInsightNarrativeResponseSchema(),
    responseSchemaName: 'govinsight_formal_report_v2',
    responseSchemaDescription: 'Structured formal GovInsight decision report JSON.',
  };
}

async function loadCandidates(options: {
  regionId?: number;
  year?: number;
  limit: number;
  force: boolean;
}): Promise<CandidateRow[]> {
  const params: Array<number | string> = [];
  const filters = [`s.materialize_status = 'official'`, `s.unit_type = 'city'`];

  if (!options.force) {
    filters.push(`(
      reports.region_id IS NULL
      OR reports.model_used LIKE 'system/report_payload_v1%'
      OR reports.source_job_id IS NULL
    )`);
  }

  if (options.regionId) {
    params.push(options.regionId);
    filters.push(`s.region_id = $${params.length}`);
  }

  if (options.year) {
    params.push(options.year);
    filters.push(`s.year = $${params.length}`);
  }

  params.push(options.limit);

  const result = await pool.query<CandidateRow>(
    `
    SELECT
      s.region_id,
      s.org_name,
      s.year,
      s.materialize_status,
      s.source_report_version_id,
      reports.model_used,
      reports.source_job_id
    FROM gov_open_annual_stats_v2 s
    LEFT JOIN ai_decision_reports reports
      ON reports.region_id = s.region_id
     AND reports.year = s.year
    WHERE ${filters.join(' AND ')}
    ORDER BY s.year DESC, s.region_id ASC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function hasActiveJob(regionId: number, year: number): Promise<boolean> {
  const result = await pool.query(
    `
    SELECT 1
    FROM gov_insight_report_jobs
    WHERE region_id = $1
      AND year = $2
      AND status IN ('queued', 'running')
    LIMIT 1
    `,
    [regionId, year]
  );

  return result.rows.length > 0;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const regionId = parseNumberArg('region');
  const year = parseNumberArg('year');
  const limit = parseNumberArg('limit') ?? 50;
  const model = resolveGovInsightReportModel(parseStringArg('model'));
  const candidates = await loadCandidates({ regionId, year, limit, force });
  const requestConfig = buildRequestConfig();

  let queued = 0;
  let skipped = 0;

  for (const row of candidates) {
    const activeJobExists = await hasActiveJob(Number(row.region_id), Number(row.year));
    const payload = await govInsightReportPayloadService.build(Number(row.region_id), Number(row.year));
    const promptText = govInsightReportPayloadService.buildPrompt(payload);

    const summary = {
      regionId: row.region_id,
      orgName: row.org_name,
      year: row.year,
      apply,
      force,
      currentModel: row.model_used,
      currentSourceJobId: row.source_job_id,
      nextModel: model,
      sourceReportVersionId: payload.sourceReportVersionId ?? row.source_report_version_id ?? null,
      materializeStatus: payload.materializeStatus,
      activeJobExists,
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!apply || activeJobExists) {
      skipped += activeJobExists ? 1 : 0;
      continue;
    }

    try {
      await pool.query(
        `
        INSERT INTO gov_insight_report_jobs (
          region_id,
          org_id,
          org_name,
          year,
          model,
          prompt_text,
          system_instruction,
          request_config,
          report_payload_json,
          report_payload_version,
          prompt_version,
          output_schema_version,
          source_report_version_id,
          created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL
        )
        `,
        [
          row.region_id,
          `city_${row.region_id}`,
          payload.orgName || row.org_name,
          row.year,
          model,
          promptText,
          SYSTEM_INSTRUCTION,
          JSON.stringify(requestConfig),
          JSON.stringify(payload),
          payload.version || GOVINSIGHT_PAYLOAD_VERSION,
          GOVINSIGHT_PROMPT_VERSION,
          GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
          payload.sourceReportVersionId ?? row.source_report_version_id ?? null,
        ]
      );

      queued += 1;
    } catch (error: any) {
      skipped += 1;
      console.warn('[GovInsight Regenerate City AI Reports] failed to enqueue job', {
        regionId: row.region_id,
        year: row.year,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        force,
        regionId: regionId ?? null,
        year: year ?? null,
        limit,
        discovered: candidates.length,
        queued,
        skipped,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[GovInsight Regenerate City AI Reports] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
