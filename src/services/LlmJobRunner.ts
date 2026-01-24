import pool from '../config/database-llm';
import { LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { createLlmProvider } from './LlmProviderFactory';
import { consistencyCheckService } from './ConsistencyCheckService';
import { materializeService } from './data-center/MaterializeService';
import { ingestionBatchService } from './data-center/IngestionBatchService';
import axios from 'axios';
import { summarizeDiff } from '../utils/jsonDiff';

interface QueuedJob {
  id: number;
  kind: string;
  report_id: number | null;
  version_id: number | null;
  retry_count: number;
  max_retries: number;
  storage_path?: string;
  file_hash?: string;
  comparison_id?: number | null;
  ingestion_batch_id?: number | null;
}

// 5-step progress tracking (Chinese)
const STEPS = {
  RECEIVED: { code: 'RECEIVED', name: '已接收并保存文件', progress: 10 },
  ENQUEUED: { code: 'ENQUEUED', name: '已入库并创建解析任务', progress: 20 },
  PARSING: { code: 'PARSING', name: 'AI 解析中', progress: 50 },
  MATERIALIZE: { code: 'MATERIALIZE', name: '结构化入库', progress: 70 },
  POSTPROCESS: { code: 'POSTPROCESS', name: '结果校验与入库', progress: 80 },
  DONE: { code: 'DONE', name: '完成', progress: 100 },
  QUEUED: { code: 'QUEUED', name: '等待处理', progress: 0 },
  CANCELLED: { code: 'CANCELLED', name: '已取消', progress: 100 },
};

const POLL_INTERVAL_MS = 5000; // 5秒轮询间隔，避免API速率限制
const POST_JOB_COOLDOWN_MS = 3000; // 任务完成后的冷却时间

export class LlmJobRunner {
  private running = false;
  private processing = false;
  private primaryProvider: LlmProvider | null = null;
  private fallbackProvider: LlmProvider | null = null;
  private parsedJsonColumnExists: boolean | null = null;
  private currentAbortController: AbortController | null = null;
  private currentJobId: number | null = null;

  start(): void {
    if (this.running) {
      return;
    }

    // Restart recovery: reset all running jobs to queued
    this.recoverRunningJobs();

    this.running = true;
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  private async processJob(job: QueuedJob): Promise<void> {
    this.currentJobId = job.id;
    try {
      if (job.kind === 'compare') {
        await this.processCompareJob(job);
      } else if (job.kind === 'materialize') {
        await this.processMaterializeJob(job);
      } else if (job.kind === 'checks') {
        await this.processChecksJob(job);
      } else {
        await this.processParseJob(job);
      }
    } catch (error: any) {
      await this.handleJobFailure(job, error);
    } finally {
      this.currentJobId = null;
      this.currentAbortController = null;
    }
  }

  /**
   * Cancel a specific job.
   * If it's currently running, abort it.
   * If it's queued/running but not current (race condition?), update DB.
   */
  public async cancelJob(jobId: number): Promise<boolean> {
    // 1. If it's the current running job, abort it
    if (this.currentJobId === jobId && this.currentAbortController) {
      console.log(`[Job ${jobId}] Cancellation requested. Aborting current process...`);
      this.currentAbortController.abort('User cancelled');
      return true;
    }

    // 2. If valid but not running in memory, update DB directly.
    await pool.query(`
      UPDATE jobs
      SET status = 'cancelled',
          step_code = 'CANCELLED',
          step_name = '已取消',
          progress = 100,
          finished_at = NOW(),
          error_message = '用户手动取消'
      WHERE id = $1 AND status IN ('queued', 'running')`, [jobId]);

    return true;
  }

  private async handleJobFailure(job: QueuedJob, error: any): Promise<void> {
    const { code, message } = this.normalizeError(error);

    // Check for Cancellation
    if (axios.isCancel(error) || error.name === 'AbortError' || message.includes('User cancelled') || message.includes('canceled')) {
      console.log(`[Job ${job.id}] Job was cancelled.`);
      await pool.query(`
        UPDATE jobs 
        SET status = 'cancelled',
            error_message = '用户手动取消',
            progress = 100,
            step_code = 'CANCELLED',
            step_name = '已取消',
            finished_at = NOW()
        WHERE id = $1`, [job.id]);
      return;
    }

    const attempt = job.retry_count + 1;

    console.error(`[Job ${job.id}] Attempt ${attempt} failed:`, error);

    // Check if we can retry
    if (job.retry_count < job.max_retries) {
      // Retry: increment retry_count, reset to queued
      console.log(`[Job ${job.id}] Retrying with attempt ${attempt + 1} (fallback model)...`);

      const errorMsg = `第${attempt}轮失败: ${message}`;
      await pool.query(`
        UPDATE jobs 
        SET status = 'queued',
            retry_count = retry_count + 1,
            attempt = retry_count + 2,
            progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = $4,
            error_message = $5
        WHERE id = $6`,
        [STEPS.QUEUED.progress, STEPS.QUEUED.code, STEPS.QUEUED.name, code, errorMsg, job.id]);
    } else {
      // Final failure: mark as failed
      const finalMessage = `已更换模型重试仍失败。第1轮失败原因: ${code}; 第2轮失败原因: ${message}`;

      await pool.query(`
        UPDATE jobs 
        SET status = 'failed',
            error_code = $1,
            error_message = $2,
            finished_at = NOW(),
            progress = 100,
            step_code = $3,
            step_name = '失败'
        WHERE id = $4`,
        [code, finalMessage, STEPS.DONE.code, job.id]);

      console.error(`[Job ${job.id}] Final failure after ${attempt} attempts`);

      // Generate notification for final failure
      if (job.version_id) {
        await this.generateNotificationIfNeeded(job.version_id);
      }
    }
  }

  private async processParseJob(job: QueuedJob): Promise<void> {
    if (!job.version_id || !job.storage_path) {
      throw new Error('Job missing required version or storage');
    }

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    // Determine which provider to use based on retry count
    const attempt = job.retry_count + 1;
    let provider: LlmProvider;

    if (attempt === 1) {
      // CRITICAL FIX: Prioritize provider/model from the JOBS table (user's actual selection)
      // Only fallback to report_versions if jobs.provider/model are NULL
      let jobConfig: { provider?: string; model?: string } | undefined;
      const result = await pool.query('SELECT provider, model FROM jobs WHERE id = $1 LIMIT 1', [job.id]);
      jobConfig = result.rows[0];

      let pName = jobConfig?.provider;
      let mName = jobConfig?.model;

      // If job doesn't have provider/model, fallback to version config
      if (!pName && !mName) {
        let versionConfig: { provider?: string; model?: string } | undefined;
        const result = await pool.query('SELECT provider, model FROM report_versions WHERE id = $1 LIMIT 1', [job.version_id]);
        versionConfig = result.rows[0];

        // If provider is 'upload' (legacy/default) or 'pending', ignore it and use env default.
        pName =
          versionConfig?.provider && versionConfig.provider !== 'upload' && versionConfig.provider !== 'pending'
            ? versionConfig.provider
            : undefined;

        mName =
          versionConfig?.model && versionConfig.model !== 'pending'
            ? versionConfig.model
            : undefined;
      }

      if (pName || mName) {
        console.log(`[Job ${job.id}] Using config: Provider=${pName}, Model=${mName}`);
      }

      // Create a fresh provider instance for this job if customized, or default
      provider = createLlmProvider(pName, mName);
    } else if (attempt === 2) {
      // Retry Strategy: Use fallback model from env, or default to DeepSeek V3.2
      const fallbackProvider = process.env.LLM_FALLBACK_PROVIDER || 'modelscope';
      const fallbackModel = process.env.LLM_FALLBACK_MODEL || 'deepseek-ai/DeepSeek-V3.2';
      console.log(`[Job ${job.id}] Retry Attempt 2: Switching to fallback model '${fallbackModel}'`);
      provider = createLlmProvider(fallbackProvider, fallbackModel);
    } else {
      // Fallback for subsequent retries (if any)
      provider = this.getProvider(attempt);
    }

    console.log(`[Job ${job.id}] Processing parse job (attempt ${attempt})...`);

    const parseResult = await provider.parse({
      reportId: job.report_id || 0,
      versionId: job.version_id,
      storagePath: job.storage_path,
      fileHash: job.file_hash,
    }, signal);

    // Update progress: POSTPROCESS
    await pool.query(`
      UPDATE jobs 
      SET step_code = $1,
      step_name = $2,
      progress = $3,
      provider = $4,
      model = $5
      WHERE id = $6`,
      [STEPS.POSTPROCESS.code, STEPS.POSTPROCESS.name, STEPS.POSTPROCESS.progress, parseResult.provider, parseResult.model, job.id]);

    const outputJson = this.stringifyOutput(parseResult);

    // Insert parse result
    await pool.query(
      `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [job.version_id, parseResult.provider, parseResult.model, outputJson]);

    if (await this.hasParsedJsonColumn()) {
      await pool.query(
        `UPDATE report_versions
         SET parsed_json = $1,
             provider = $2,
             model = $3,
             prompt_version = 'v1'
         WHERE id = $4`,
        [outputJson, parseResult.provider, parseResult.model, job.version_id]);
    }

    // Success: mark as DONE
    await pool.query(`
      UPDATE jobs 
      SET status = 'succeeded', 
          progress = $1,
          step_code = $2,
          step_name = $3,
          finished_at = NOW() 
      WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);

    // Enqueue materialize job if not already queued/running
    if (job.version_id && job.report_id) {
      let existingMaterializeJob: { id?: number } | undefined;
      const result = await pool.query(
        `SELECT id FROM jobs WHERE report_id = $1 AND version_id = $2 AND kind = 'materialize' AND status IN ('queued', 'running') LIMIT 1`,
        [job.report_id, job.version_id]);
      existingMaterializeJob = result.rows[0];

      if (!existingMaterializeJob?.id) {
        let ingestionBatchId: number | null = null;
        const result = await pool.query(
          `SELECT ingestion_batch_id FROM report_versions WHERE id = $1 LIMIT 1`,
          [job.version_id]
        );
        ingestionBatchId = result.rows[0]?.ingestion_batch_id ?? null;

        await pool.query(
          `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id) 
           VALUES ($1, $2, 'materialize', 'queued', 60, $3, $4, 1, $5)`,
          [job.report_id, job.version_id, STEPS.MATERIALIZE.code, STEPS.MATERIALIZE.name, ingestionBatchId]);
        console.log(`[Job ${job.id}] Enqueued materialize job for version ${job.version_id}`);
      }
    }

    // Check if we need to generate notification (after all jobs complete)
    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);
    }
  }

  /**
   * Restart recovery: reset all 'running' jobs to 'queued' state
   * to avoid permanent stall on server restart
   */
  private recoverRunningJobs(): void {
    this.recoverRunningJobsAsync().catch(err =>
      console.error('[Recovery] Failed to recover running jobs:', err));
  }

  private async recoverRunningJobsAsync(): Promise<void> {
    const result = await pool.query(`SELECT id FROM jobs WHERE status = 'running'`);
    const runningJobs = result.rows;

    if (runningJobs.length > 0) {
      console.log(`[Recovery] Found ${runningJobs.length} running jobs, resetting to queued...`);

      await pool.query(`
        UPDATE jobs 
        SET status = 'queued',
            progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = NULL,
            error_message = NULL
        WHERE status = 'running'`,
        [STEPS.QUEUED.progress, STEPS.QUEUED.code, STEPS.QUEUED.name]);

      console.log(`[Recovery] Reset ${runningJobs.length} jobs to queued`);
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }

    setTimeout(() => {
      this.tick().catch((error) => console.error('LLM job runner tick failed:', error));
    }, POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.processing) {
      this.scheduleNextTick();
      return;
    }

    this.processing = true;

    try {
      const job = await this.claimNextJob();
      if (!job) {
        return;
      }

      await this.processJob(job);

      // 任务完成后添加冷却时间，避免过快调用 API 触发速率限制
      if (POST_JOB_COOLDOWN_MS > 0) {
        console.log(`[JobRunner] Cooling down for ${POST_JOB_COOLDOWN_MS}ms before next job...`);
        await new Promise(resolve => setTimeout(resolve, POST_JOB_COOLDOWN_MS));
      }
    } finally {
      this.processing = false;
      this.scheduleNextTick();
    }
  }

  private async claimNextJob(): Promise<QueuedJob | null> {
    // PostgreSQL: Use two separate queries for atomic claim
    const selectResult = await pool.query(`
        SELECT id FROM jobs 
        WHERE status = 'queued' AND kind != 'pdf_export'
        ORDER BY (CASE kind WHEN 'parse' THEN 0 WHEN 'materialize' THEN 1 WHEN 'checks' THEN 2 WHEN 'compare' THEN 3 ELSE 9 END) ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`);

    if (selectResult.rows.length === 0) {
      return null;
    }

    const jobId = selectResult.rows[0].id;
    const updateResult = await pool.query(`
        UPDATE jobs
        SET status = 'running', 
            started_at = NOW(),
            step_code = $1,
            step_name = $2,
            progress = $3
        WHERE id = $4
        RETURNING id, report_id, version_id, kind, comparison_id, retry_count, max_retries`,
      [STEPS.PARSING.code, STEPS.PARSING.name, STEPS.PARSING.progress, jobId]);

    const updatedJobs = updateResult.rows;

    if (!updatedJobs.length) {
      return null;
    }

    const jobRow = updatedJobs[0] as {
      id: number;
      report_id?: number;
      version_id?: number;
      kind?: string;
      comparison_id?: number;
      retry_count?: number;
      max_retries?: number;
    };

    let storagePath: string | undefined;
    let fileHash: string | undefined;
    if ((jobRow.kind || 'parse') === 'parse' && jobRow.version_id) {
      const result = await pool.query(
        'SELECT storage_path, file_hash FROM report_versions WHERE id = $1 LIMIT 1',
        [jobRow.version_id]);
      const versionRow = result.rows[0];
      storagePath = versionRow?.storage_path;
      fileHash = versionRow?.file_hash;
    }

    return {
      id: jobRow.id,
      report_id: jobRow.report_id ?? null,
      version_id: jobRow.version_id ?? null,
      kind: jobRow.kind || 'parse',
      retry_count: jobRow.retry_count ?? 0,
      storage_path: storagePath,
      file_hash: fileHash,
      comparison_id: jobRow.comparison_id ?? null,
      max_retries: 1, // FORCE FIX: Ensure max_retries is always 1
    } as QueuedJob;
  }

  private async processMaterializeJob(job: QueuedJob): Promise<void> {
    if (!job.version_id || !job.report_id) {
      throw new Error('Materialize job missing version_id or report_id');
    }

    let version: { id?: number; parsed_json?: string } | undefined;

    const result = await pool.query(
      `SELECT id, parsed_json FROM report_versions WHERE id = $1 LIMIT 1`,
      [job.version_id]
    );
    version = result.rows[0];

    if (!version?.id) {
      throw new Error('Version not found');
    }

    if (!version.parsed_json) {
      throw new LlmProviderError('parsed_json is empty, cannot materialize', 'PARSED_JSON_EMPTY');
    }

    const materializeResult = await materializeService.materializeVersion(job.version_id);

    if (!materializeResult.success) {
      throw new Error(`Materialization failed: ${materializeResult.error}`);
    }

    // Update batch stats if applicable
    if (job.ingestion_batch_id) {
      await ingestionBatchService.updateBatchStats(Number(job.ingestion_batch_id));
    }

    await pool.query(
      `UPDATE jobs
         SET status = 'succeeded',
             progress = $1,
             step_code = $2,
             step_name = $3,
             finished_at = NOW()
         WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]
    );

    let existingChecksJob: { id?: number } | undefined;
    const checksResult = await pool.query(
      `SELECT id FROM jobs WHERE report_id = $1 AND version_id = $2 AND kind = 'checks' AND status IN ('queued', 'running') LIMIT 1`,
      [job.report_id, job.version_id]
    );
    existingChecksJob = checksResult.rows[0];

    if (!existingChecksJob?.id) {
      let ingestionBatchId: number | null = null;
      const result = await pool.query(
        `SELECT ingestion_batch_id FROM report_versions WHERE id = $1 LIMIT 1`,
        [job.version_id]
      );
      ingestionBatchId = result.rows[0]?.ingestion_batch_id ?? null;

      await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
           VALUES ($1, $2, 'checks', 'queued', 60, $3, $4, 1, $5)`,
        [job.report_id, job.version_id, STEPS.POSTPROCESS.code, '等待校验', ingestionBatchId]
      );
    }
  }

  private async processChecksJob(job: QueuedJob): Promise<void> {
    if (!job.version_id) {
      throw new Error('Checks job missing version_id');
    }

    // Get parsed_json from report_versions
    let version: { id?: number; parsed_json?: string } | undefined;
    const result = await pool.query(
      `SELECT id, parsed_json FROM report_versions WHERE id = $1 LIMIT 1`,
      [job.version_id]);
    version = result.rows[0];

    if (!version?.id) {
      throw new Error('Version not found');
    }

    if (!version.parsed_json) {
      throw new LlmProviderError('parsed_json is empty, cannot run checks', 'PARSED_JSON_EMPTY');
    }

    // Run consistency checks
    try {
      const { runId, items } = await consistencyCheckService.runAndPersist(job.version_id, version.parsed_json);
      console.log(`[Job ${job.id}] Consistency checks completed: runId=${runId}, items=${items.length}`);
    } catch (error) {
      console.error(`[Job ${job.id}] Consistency check failed:`, error);
      throw error;
    }

    // Check if we need to generate notification (after all jobs complete)
    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);

      // Auto-trigger comparison with previous year's report
      // IMPORTANT: Run this BEFORE marking job as succeeded, so we can see logs/errors if it fails
      try {
        console.log(`[Job ${job.id}] Attempting to trigger auto-comparison...`);
        await this.triggerAutoComparison(job.version_id, job.report_id);
      } catch (err) {
        // Log error but don't fail the check job itself, as checks technically passed
        console.error(`[Job ${job.id}] Auto-comparison trigger failed:`, err);
      }
    }

    await pool.query(`
        UPDATE jobs 
        SET status = 'succeeded', 
            progress = $1,
            step_code = $2,
            step_name = $3,
            finished_at = NOW() 
        WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
  }

  private async processCompareJob(job: QueuedJob): Promise<void> {
    if (!job.comparison_id || !job.report_id) {
      throw new Error('Compare job missing comparison or report reference');
    }

    let comparison: any;
    const result = await pool.query(
      `SELECT id, left_report_id, right_report_id FROM comparisons WHERE id = $1 LIMIT 1`,
      [job.comparison_id]);
    comparison = result.rows[0];

    if (!comparison) {
      throw new Error('comparison_not_found');
    }

    console.log(`[Job ${job.id}] Running comparison ${comparison.id} for reports ${comparison.left_report_id} <-> ${comparison.right_report_id}...`);

    // Get JSON data for both versions
    const leftRes = await pool.query('SELECT parsed_json FROM report_versions WHERE report_id = $1 AND is_active = true LIMIT 1', [comparison.left_report_id]);
    const rightRes = await pool.query('SELECT parsed_json FROM report_versions WHERE report_id = $1 AND is_active = true LIMIT 1', [comparison.right_report_id]);

    const leftJson = leftRes.rows[0]?.parsed_json || {};
    const rightJson = rightRes.rows[0]?.parsed_json || {};

    // 1. Calculate Diff
    const diff = summarizeDiff(leftJson, rightJson);

    // 2. Calculate Similarity (0-100)
    const diffKeys = Object.keys(diff.changed).length;
    const totalKeys = Object.keys(leftJson).length + Object.keys(rightJson).length;
    // Simple similarity metric: (1 - diffs/total) * 100
    // Prevent div/0
    const similarity = totalKeys === 0 ? 100 : Math.max(0, Math.floor(100 * (1 - (diffKeys * 2) / (totalKeys || 1))));

    // 3. Save Results
    await pool.query(
      'INSERT INTO comparison_results (comparison_id, diff_json) VALUES ($1, $2) ON CONFLICT (comparison_id) DO UPDATE SET diff_json = $2, created_at = NOW()',
      [comparison.id, JSON.stringify(diff)]
    );

    await pool.query(
      `UPDATE comparisons SET similarity = $1, check_status = 'completed' WHERE id = $2`,
      [similarity, comparison.id]
    );

    await pool.query(`
      UPDATE jobs 
      SET status = 'succeeded', 
          progress = $1,
          step_code = $2,
          step_name = $3,
          finished_at = NOW() 
      WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
  }

  private async hasParsedJsonColumn(): Promise<boolean> {
    if (this.parsedJsonColumnExists !== null) {
      return this.parsedJsonColumnExists;
    }

    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'report_versions' AND column_name = 'parsed_json'
    `);
    this.parsedJsonColumnExists = result.rows.length > 0;
    return this.parsedJsonColumnExists;
  }

  private stringifyOutput(result: LlmParseResult): string {
    if (typeof result.output === 'string') {
      return result.output;
    }
    return JSON.stringify(result.output, null, 2);
  }

  private getProvider(attempt: number): LlmProvider {
    if (!this.primaryProvider) {
      this.primaryProvider = createLlmProvider();
    }
    return this.primaryProvider;
  }

  private normalizeError(error: any): { code: string; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    let code = 'UNKNOWN_ERROR';
    if (error instanceof LlmProviderError) {
      code = error.code || 'UNKNOWN_ERROR';
    } else if (message.includes('timeout')) {
      code = 'TIMEOUT';
    } else if (message.includes('network')) {
      code = 'NETWORK_ERROR';
    } else if (message.includes('json')) {
      code = 'JSON_PARSE_ERROR';
    }
    return { code, message };
  }

  /**
   * IMPORTANT: Notifications should trigger ONLY when all 3 jobs are done:
   * 1. PARSE (is parsed)
   * 2. MATERIALIZE (is materialized)
   * 3. CHECKS (consistency checks pass)
   *
   * But checks can be long running or fail independently.
   * Current Logic: Trigger when Parsing + Materialization is done.
   *
   * Checks job is subsequent.
   */
  private async generateNotificationIfNeeded(versionId: number): Promise<void> {
    // Check if main parsing job is done
    const parseJobRes = await pool.query(
      `SELECT status FROM jobs WHERE version_id = $1 AND kind = 'parse' ORDER BY created_at DESC LIMIT 1`,
      [versionId]
    );

    if (parseJobRes.rows[0]?.status !== 'succeeded') {
      return; // Not ready
    }

    // Check if materialized job exists and is done
    const matJobRes = await pool.query(
      `SELECT status FROM jobs WHERE version_id = $1 AND kind = 'materialize' ORDER BY created_at DESC LIMIT 1`,
      [versionId]
    );

    // If materialize job exists but not succeeded, wait.
    if (matJobRes.rows.length > 0 && matJobRes.rows[0].status !== 'succeeded') {
      return;
    }
    // If no materialize job (e.g. legacy), we might proceed, but typically we want it.

    // Get report details
    const reportRes = await pool.query(`
        SELECT r.region_id, r.year, r.unit_name, v.file_name, r.id as report_id
        FROM report_versions v
        JOIN reports r ON v.report_id = r.id
        WHERE v.id = $1
    `, [versionId]);

    const report = reportRes.rows[0];
    if (!report) return;

    // Create Notification
    const title = `解析完成: ${report.unit_name} ${report.year}`;
    const content = JSON.stringify({
      reportId: report.report_id,
      versionId: versionId,
      message: `文件 ${report.file_name} 已成功解析并入库。`,
      timestamp: new Date().toISOString()
    });

    await pool.query(`
        INSERT INTO notifications (type, title, content_json, related_version_id, created_at)
        VALUES ('upload_complete', $1, $2, $3, NOW())
    `, [title, content, versionId]);
  }

  /**
   * Auto-trigger a comparison job against the previous year's report
   * This is called after consistency checks are done.
   */
  private async triggerAutoComparison(versionId: number, reportId: number | null): Promise<void> {
    if (!reportId) return;

    // 1. Get current report details (region, year)
    const currentRes = await pool.query('SELECT region_id, year, unit_name FROM reports WHERE id = $1', [reportId]);
    const currentReport = currentRes.rows[0];
    if (!currentReport) {
      console.log(`[AutoCompare] Report ${reportId} not found, skipping.`);
      return;
    }

    const prevYear = currentReport.year - 1;
    console.log(`[AutoCompare] Triggered for Report ${reportId} (${currentReport.unit_name}, ${currentReport.year}). Looking for year ${prevYear}...`);

    // 2. Find previous year's active report for same region
    const prevRes = await pool.query(`
        SELECT id
        FROM reports
        WHERE region_id = $1 AND year = $2 AND active_version_id IS NOT NULL
        LIMIT 1
    `, [currentReport.region_id, prevYear]);

    const prevReport = prevRes.rows[0];
    if (!prevReport) {
      console.log(`[AutoCompare] No active report found for region ${currentReport.region_id} in year ${prevYear}. Skipping comparison.`);
      return;
    }

    console.log(`[AutoCompare] Found previous report ${prevReport.id}. Creating comparison job...`);

    // 3. Create or Update Comparison Record
    // We want year_a = min, year_b = max to keep it ordered
    const yearA = Math.min(prevYear, currentReport.year);
    const yearB = Math.max(prevYear, currentReport.year);
    const reportA = prevYear < currentReport.year ? prevReport.id : reportId;
    const reportB = prevYear < currentReport.year ? reportId : prevReport.id;

    // Upsert comparison
    const compRes = await pool.query(`
        INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id, check_status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        ON CONFLICT (region_id, year_a, year_b)
        DO UPDATE SET left_report_id = $4, right_report_id = $5, check_status = 'pending', updated_at = NOW()
        RETURNING id
    `, [currentReport.region_id, yearA, yearB, reportA, reportB]);

    const comparisonId = compRes.rows[0].id;

    // 4. Enqueue Comparison Job
    // Check if job already exists
    const jobRes = await pool.query(`
        SELECT id FROM jobs
        WHERE comparison_id = $1 AND kind = 'compare' AND status IN ('queued', 'running')
    `, [comparisonId]);

    if (jobRes.rows.length === 0) {
      await pool.query(`
        INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, comparison_id)
        VALUES ($1, $2, 'compare', 'queued', 0, 'QUEUED', '等待比对', $3)
      `, [reportId, versionId, comparisonId]);
      console.log(`[AutoCompare] Enqueued comparison job for comparison ${comparisonId}`);
    }
  }
}

export const llmJobRunner = new LlmJobRunner();
