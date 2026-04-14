import pool from '../config/database-llm';
import { createLlmProvider } from './LlmProviderFactory';
import { LlmProviderError } from './LlmProvider';
import { buildPrefixedModelValue, resolveFirstNonEmpty } from '../utils/aiEnv';

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

const NARRATIVE_REPORT_FORMAT = 'govInsightFormalReportV2';

function stripJsonFences(text: string): string {
  return text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function parseRequestConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeModelSelection(modelInput: string): { providerName: string; modelName: string } {
  const model = String(modelInput || '').trim();
  const lower = model.toLowerCase();

  if (lower.startsWith('gemini_openai/')) {
    return { providerName: 'gemini_openai', modelName: model.slice('gemini_openai/'.length) };
  }

  if (lower.startsWith('gemini-openai/')) {
    return { providerName: 'gemini_openai', modelName: model.slice('gemini-openai/'.length) };
  }

  if (lower.startsWith('openai/')) {
    return { providerName: 'openai', modelName: model.slice('openai/'.length) };
  }

  if (lower.startsWith('gpt-')) {
    return { providerName: 'openai', modelName: model };
  }

  if (lower === 'deepseek-v3' || lower === 'deepseek-v3.2') {
    return {
      providerName: 'nvidia',
      modelName: resolveFirstNonEmpty(process.env.NVIDIA_MODEL, model),
    };
  }

  if (lower === 'kimi2.5' || lower === 'kimi-k2.5') {
    return {
      providerName: 'nvidia',
      modelName: resolveFirstNonEmpty(process.env.KIMI_MODEL, model),
    };
  }

  if (lower.startsWith('nvidia/')) {
    return { providerName: 'nvidia', modelName: model.slice('nvidia/'.length) };
  }

  if (lower.startsWith('deepseek/')) {
    return { providerName: 'nvidia', modelName: model.slice('deepseek/'.length) };
  }

  if (lower.startsWith('kimi/')) {
    return { providerName: 'nvidia', modelName: model.slice('kimi/'.length) };
  }

  if (lower.startsWith('gemini/')) {
    return { providerName: 'gemini', modelName: model.slice('gemini/'.length) };
  }

  if (lower.includes('gemini')) {
    return { providerName: 'gemini', modelName: model };
  }

  if (lower.startsWith('zhipu/')) {
    return { providerName: 'zhipu', modelName: model.slice('zhipu/'.length) };
  }

  if (lower.includes('glm')) {
    return { providerName: 'zhipu', modelName: model };
  }

  return {
    providerName: resolveFirstNonEmpty(
      process.env.GOV_INSIGHT_REPORT_PROVIDER,
      process.env.LLM_REPORT_PROVIDER,
      process.env.LLM_PROVIDER,
      'stub'
    ).toLowerCase(),
    modelName: model || resolveFirstNonEmpty(
      process.env.GOV_INSIGHT_REPORT_MODEL,
      process.env.LLM_REPORT_MODEL,
      process.env.LLM_MODEL
    ),
  };
}

function resolveFallbackJobModel(currentModel: string): string | null {
  const fallbackProvider = String(
    process.env.GOV_INSIGHT_REPORT_FALLBACK_PROVIDER ||
      process.env.LLM_REPORT_FALLBACK_PROVIDER ||
      process.env.LLM_FALLBACK_PROVIDER ||
      ''
  )
    .trim()
    .toLowerCase();
  const fallbackModel = String(
    process.env.GOV_INSIGHT_REPORT_FALLBACK_MODEL ||
      process.env.LLM_REPORT_FALLBACK_MODEL ||
      process.env.LLM_FALLBACK_MODEL ||
      ''
  ).trim();
  if (!fallbackProvider || !fallbackModel) {
    return null;
  }

  const nextModel = buildPrefixedModelValue(fallbackProvider, fallbackModel);
  if (!nextModel) {
    return null;
  }

  const current = normalizeModelSelection(currentModel);
  const next = normalizeModelSelection(nextModel);
  if (current.providerName === next.providerName && current.modelName === next.modelName) {
    return null;
  }

  return nextModel;
}

function buildStoredNarrativePayload(narrative: Record<string, unknown>): Record<string, unknown> {
  return {
    _reportFormat: NARRATIVE_REPORT_FORMAT,
    narrative,
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

      const { providerName, modelName } = normalizeModelSelection(job.model);
      const llm = createLlmProvider(providerName, modelName);
      if (!llm.generate) {
        throw new Error(`Provider ${providerName} does not support generation`);
      }

      const requestConfig = parseRequestConfig(job.request_config);
      const result = await llm.generate(job.prompt_text, job.system_instruction || undefined, requestConfig);
      const text = String(result?.text || '').trim();
      if (!text) {
        throw new LlmProviderError('empty_model_response', 'empty_model_response');
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stripJsonFences(text));
      } catch (error) {
        throw new LlmProviderError(
          `json_parse_failed: ${error instanceof Error ? error.message : String(error)}`,
          'json_parse_failed'
        );
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

      await pool.query(
        `
        INSERT INTO ai_decision_reports (region_id, org_name, year, content_json, model_used, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (region_id, year)
        DO UPDATE SET
          org_name = EXCLUDED.org_name,
          content_json = EXCLUDED.content_json,
          model_used = EXCLUDED.model_used,
          updated_at = NOW()
        `,
        [job.region_id, job.org_name, job.year, JSON.stringify(buildStoredNarrativePayload(parsed)), job.model]
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

    if (job.retry_count < job.max_retries) {
      const fallbackJobModel = resolveFallbackJobModel(job.model) || job.model;
      await pool.query(
        `
        UPDATE gov_insight_report_jobs
        SET status = 'queued',
            progress = $1,
            step_code = $2,
            step_name = $3,
            retry_count = retry_count + 1,
            error_code = $4,
            error_message = $5,
            started_at = NULL,
            model = $6
        WHERE id = $7
        `,
        [STEPS.QUEUED.progress, STEPS.QUEUED.code, STEPS.QUEUED.name, code, message, fallbackJobModel, job.id]
      );
      return;
    }

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
