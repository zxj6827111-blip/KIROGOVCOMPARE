import pool from '../config/database-llm';
import { createLlmProvider } from './LlmProviderFactory';
import { LlmProviderError } from './LlmProvider';
import { aiModelConfigService } from './AiModelConfigService';
import { parseStructuredJsonFromText } from './LlmCommon';
import { govInsightReportPayloadService } from './GovInsightReportPayloadService';
import {
  buildGovInsightNarrativeResponseSchema,
  buildStoredNarrativeEnvelope,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  reconcileGovInsightNarrativeWithPayload,
  synthesizeGovInsightNarrativeFromPayload,
  validateGovInsightNarrative,
  validateGovInsightReportPayload,
  validateGovInsightStoredEnvelope,
} from './GovInsightReportProtocol';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

interface GovInsightReportJobRow {
  id: number;
  region_id: number;
  org_id: string;
  org_name: string;
  year: number;
  model: string;
  prompt_text: string;
  system_instruction: string | null;
  request_config: unknown;
  report_payload_json: unknown;
  report_payload_version: string | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  source_report_version_id: number | null;
  retry_count: number;
  max_retries: number;
}

const POLL_INTERVAL_MS = 5000;

const STEPS = {
  QUEUED: { code: 'QUEUED', name: '等待处理', progress: 0 },
  PREPARING: { code: 'PREPARING', name: '准备生成提示词任务', progress: 5 },
  GENERATING: { code: 'GENERATING', name: '大模型生成中', progress: 45 },
  SAVING: { code: 'SAVING', name: '正在保存报告', progress: 90 },
  DONE: { code: 'DONE', name: '报告已生成并保存', progress: 100 },
  FAILED: { code: 'FAILED', name: '生成失败', progress: 100 },
  CANCELLED: { code: 'CANCELLED', name: '已取消', progress: 100 },
} as const;

function stripJsonFences(text: string): string {
  return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function synthesizeNarrativeFallback(
  reportPayload: unknown,
  overrides?: Record<string, unknown>
): Record<string, unknown> | null {
  if (!isPlainRecord(reportPayload)) {
    return null;
  }

  const repairedNarrative = synthesizeGovInsightNarrativeFromPayload(reportPayload, overrides);
  if (!repairedNarrative) {
    return null;
  }

  const repairedValidation = validateGovInsightNarrative(repairedNarrative);
  return repairedValidation.valid ? repairedNarrative : null;
}

function parseRequestConfig(raw: unknown): Record<string, unknown> {
  const defaults = {
    responseSchema: buildGovInsightNarrativeResponseSchema(),
    responseSchemaName: 'govinsight_formal_report_v2',
    responseSchemaDescription: 'Structured formal GovInsight decision report JSON.',
  };

  if (!raw) return defaults;
  if (typeof raw === 'object') {
    const parsed = raw as Record<string, unknown>;
    return {
      ...defaults,
      ...parsed,
      responseSchema: parsed.responseSchema || defaults.responseSchema,
      responseSchemaName: parsed.responseSchemaName || defaults.responseSchemaName,
      responseSchemaDescription: parsed.responseSchemaDescription || defaults.responseSchemaDescription,
    };
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const parsedObject = parsed as Record<string, unknown>;
        return {
          ...defaults,
          ...parsedObject,
          responseSchema: parsedObject.responseSchema || defaults.responseSchema,
          responseSchemaName: parsedObject.responseSchemaName || defaults.responseSchemaName,
          responseSchemaDescription: parsedObject.responseSchemaDescription || defaults.responseSchemaDescription,
        };
      }
    } catch {
      return defaults;
    }
  }

  return defaults;
}

async function resolveGovInsightModelSelection(): Promise<{
  providerName: string;
  modelName: string;
  apiKey?: string;
  baseURL?: string;
  source: string;
}> {
  const runtime = await aiModelConfigService.resolveRuntime('gov_insight_report');
  return {
    providerName: runtime.provider,
    modelName: runtime.model,
    apiKey: runtime.apiKey || undefined,
    baseURL: runtime.baseUrl || undefined,
    source: runtime.source,
  };
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof LlmProviderError) {
    return {
      code: error.code || 'LLM_PROVIDER_ERROR',
      message: error.message || 'Model generation failed',
    };
  }

  if (error instanceof Error) {
    return {
      code: 'GOV_INSIGHT_REPORT_JOB_FAILED',
      message: error.message || 'GovInsight report job failed',
    };
  }

  return {
    code: 'GOV_INSIGHT_REPORT_JOB_FAILED',
    message: String(error || 'GovInsight report job failed'),
  };
}

class GovInsightReportJobWorker {
  private running = false;
  private processing = false;
  private pollTimer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.running) return;

    this.running = true;
    this.recoverRunningJobs().catch((error) => {
      console.error('[GovInsightReportJobWorker] Failed to recover running jobs:', error);
    });

    this.tick().catch((error) => {
      console.error('[GovInsightReportJobWorker] Initial tick failed:', error);
    });

    this.pollTimer = setInterval(() => {
      this.tick().catch((error) => {
        console.error('[GovInsightReportJobWorker] Tick failed:', error);
      });
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async recoverRunningJobs(): Promise<void> {
    await pool.query(
      `
      UPDATE gov_insight_report_jobs
      SET status = 'queued',
          progress = $1,
          step_code = $2,
          step_name = $3,
          started_at = NULL
      WHERE status = 'running'
      `,
      [STEPS.QUEUED.progress, STEPS.QUEUED.code, STEPS.QUEUED.name]
    );
  }

  private async tick(): Promise<void> {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;

    try {
      const job = await this.claimNextJob();
      if (!job) return;

      await this.processJob(job);
    } finally {
      this.processing = false;
    }
  }

  private async claimNextJob(): Promise<GovInsightReportJobRow | null> {
    const result = await pool.query(
      `
      WITH next_job AS (
        SELECT id
        FROM gov_insight_report_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE gov_insight_report_jobs job
      SET status = 'running',
          started_at = NOW(),
          progress = $1,
          step_code = $2,
          step_name = $3
      FROM next_job
      WHERE job.id = next_job.id
      RETURNING
        job.id,
        job.region_id,
        job.org_id,
        job.org_name,
        job.year,
        job.model,
        job.prompt_text,
        job.system_instruction,
        job.request_config,
        job.report_payload_json,
        job.report_payload_version,
        job.prompt_version,
        job.output_schema_version,
        job.source_report_version_id,
        job.retry_count,
        job.max_retries
      `,
      [STEPS.PREPARING.progress, STEPS.PREPARING.code, STEPS.PREPARING.name]
    );

    return (result.rows[0] as GovInsightReportJobRow | undefined) || null;
  }

  private async processJob(job: GovInsightReportJobRow): Promise<void> {
    try {
      await pool.query(
        `
        UPDATE gov_insight_report_jobs
        SET progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = NULL,
            error_message = NULL
        WHERE id = $4
        `,
        [STEPS.GENERATING.progress, STEPS.GENERATING.code, STEPS.GENERATING.name, job.id]
      );

      const { providerName, modelName, apiKey, baseURL, source } = await resolveGovInsightModelSelection();
      const llm = createLlmProvider(providerName, modelName, {
        apiKey,
        baseURL,
      });
      if (!llm.generate) {
        throw new Error(`Provider ${providerName} does not support generation`);
      }
      console.log(
        `[GovInsightReportJobWorker] Job ${job.id} using ${providerName}/${modelName} (source=${source})`
      );

      const requestConfig = parseRequestConfig(job.request_config);
      const reportPayload =
        job.report_payload_json && typeof job.report_payload_json === 'string'
          ? JSON.parse(job.report_payload_json)
          : job.report_payload_json;
      if (reportPayload) {
        const payloadValidation = validateGovInsightReportPayload(reportPayload);
        if (!payloadValidation.valid) {
          throw new Error(`invalid_report_payload: ${payloadValidation.errors.slice(0, 5).join('; ')}`);
        }
      }
      const resolvedPrompt =
        String(job.prompt_text || '').trim() ||
        (reportPayload ? govInsightReportPayloadService.buildPrompt(reportPayload as any) : '');

      if (!resolvedPrompt) {
        throw new Error(`Job ${job.id} is missing both prompt_text and report_payload_json`);
      }

      const result = await llm.generate(resolvedPrompt, job.system_instruction || undefined, requestConfig);
      const text = String(result?.text || '').trim();
      if (!text) {
        throw new LlmProviderError('empty_model_response', 'empty_model_response');
      }

      let narrative: Record<string, unknown> | null = null;
      try {
        const parsed = parseStructuredJsonFromText<unknown>(stripJsonFences(text));
        narrative = isPlainRecord(parsed) ? parsed : {};
      } catch (error) {
        narrative = synthesizeNarrativeFallback(reportPayload);
        if (!narrative) {
          throw new LlmProviderError(`json_parse_failed: ${errorMessage(error)}`, 'json_parse_failed');
        }

        console.warn(
          `[GovInsightReportJobWorker] Job ${job.id} model output failed JSON parsing; repaired via report payload synthesis. Error: ${errorMessage(error)}`
        );
      }

      const narrativeValidation = validateGovInsightNarrative(narrative);
      if (!narrativeValidation.valid) {
        const repairedNarrative = synthesizeNarrativeFallback(reportPayload, narrative);

        if (!repairedNarrative) {
          throw new LlmProviderError(
            `schema_validation_failed: ${narrativeValidation.errors.slice(0, 8).join('; ')}`,
            'schema_validation_failed'
          );
        }

        const repairedValidation = validateGovInsightNarrative(repairedNarrative);
        if (!repairedValidation.valid) {
          throw new LlmProviderError(
            `schema_validation_failed: ${narrativeValidation.errors.slice(0, 8).join('; ')}; fallback_validation_failed: ${repairedValidation.errors.slice(0, 8).join('; ')}`,
            'schema_validation_failed'
          );
        }

        console.warn(
          `[GovInsightReportJobWorker] Job ${job.id} model output failed schema validation; repaired via report payload synthesis.`
        );
        narrative = repairedNarrative;
      }

      await pool.query(
        `
        UPDATE gov_insight_report_jobs
        SET progress = $1,
            step_code = $2,
            step_name = $3
        WHERE id = $4
        `,
        [STEPS.SAVING.progress, STEPS.SAVING.code, STEPS.SAVING.name, job.id]
      );

      const reconciledNarrative =
        reconcileGovInsightNarrativeWithPayload(narrative, (reportPayload as any) || null) || narrative;

      const storedEnvelope = buildStoredNarrativeEnvelope({
        narrative: reconciledNarrative,
        reportContent: reconciledNarrative,
        reportPayload: (reportPayload as any) || null,
        materializeStatus: (reportPayload as any)?.materializeStatus || null,
        sourceReportVersionId: job.source_report_version_id,
        sourceJobId: job.id,
        modelUsed: job.model,
        promptVersion: job.prompt_version || GOVINSIGHT_PROMPT_VERSION,
        payloadVersion: job.report_payload_version || GOVINSIGHT_PAYLOAD_VERSION,
        outputSchemaVersion: job.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
      });
      const envelopeValidation = validateGovInsightStoredEnvelope(storedEnvelope);
      if (!envelopeValidation.valid) {
        throw new Error(`invalid_stored_envelope: ${envelopeValidation.errors.slice(0, 8).join('; ')}`);
      }

      await pool.query(
        `
        INSERT INTO ai_decision_reports (
          region_id,
          org_name,
          year,
          content_json,
          model_used,
          protocol_version,
          payload_version,
          prompt_version,
          output_schema_version,
          materialize_status,
          source_job_id,
          source_report_version_id,
          report_payload_json,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'gov_insight_ai_report_v1', $6, $7, $8, $9, $10, $11, $12, NOW())
        ON CONFLICT (region_id, year)
        DO UPDATE SET
          org_name = EXCLUDED.org_name,
          content_json = EXCLUDED.content_json,
          model_used = EXCLUDED.model_used,
          protocol_version = EXCLUDED.protocol_version,
          payload_version = EXCLUDED.payload_version,
          prompt_version = EXCLUDED.prompt_version,
          output_schema_version = EXCLUDED.output_schema_version,
          materialize_status = EXCLUDED.materialize_status,
          source_job_id = EXCLUDED.source_job_id,
          source_report_version_id = EXCLUDED.source_report_version_id,
          report_payload_json = EXCLUDED.report_payload_json,
          updated_at = NOW()
        `,
        [
          job.region_id,
          job.org_name,
          job.year,
          JSON.stringify(storedEnvelope),
          job.model,
          job.report_payload_version || GOVINSIGHT_PAYLOAD_VERSION,
          job.prompt_version || GOVINSIGHT_PROMPT_VERSION,
          job.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
          (reportPayload as any)?.materializeStatus || null,
          job.id,
          job.source_report_version_id,
          reportPayload ? JSON.stringify(reportPayload) : null,
        ]
      );

      await pool.query(
        `
        UPDATE gov_insight_report_jobs
        SET status = 'succeeded',
            progress = $1,
            step_code = $2,
            step_name = $3,
            finished_at = NOW()
        WHERE id = $4
        `,
        [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]
      );
    } catch (error) {
      await this.handleFailure(job, error);
    }
  }

  private async handleFailure(job: GovInsightReportJobRow, error: unknown): Promise<void> {
    const { code, message } = normalizeError(error);

    await pool.query(
      `
      UPDATE gov_insight_report_jobs
      SET status = 'failed',
          progress = $1,
          step_code = $2,
          step_name = $3,
          error_code = $4,
          error_message = $5,
          finished_at = NOW()
      WHERE id = $6
      `,
      [STEPS.FAILED.progress, STEPS.FAILED.code, STEPS.FAILED.name, code, message, job.id]
    );
  }
}

export const govInsightReportJobWorker = new GovInsightReportJobWorker();

export function startGovInsightReportJobWorker(): void {
  govInsightReportJobWorker.start();
}
