import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import pool, { dbType } from '../config/database-llm';
import { LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { createLlmProvider } from './LlmProviderFactory';
import { summarizeDiff } from '../utils/jsonDiff';
import { consistencyCheckService } from './ConsistencyCheckService';
import axios from 'axios';

// Database helper: get the correct datetime expression
function getNowExpression(): string {
  return dbType === 'postgres' ? 'NOW()' : "datetime('now')";
}

// Database helper: execute query for both PostgreSQL and SQLite
async function dbQuery(sql: string, params?: any[]): Promise<any[]> {
  if (dbType === 'postgres') {
    const result = await pool.query(sql, params);
    return result.rows;
  } else {
    return querySqlite(sql);
  }
}

// Database helper: execute update/insert (returns affected rows for PostgreSQL)
async function dbExecute(sql: string, params?: any[]): Promise<any[]> {
  if (dbType === 'postgres') {
    const result = await pool.query(sql, params);
    return result.rows;
  } else {
    return querySqlite(sql);
  }
}

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
}

// 5-step progress tracking (Chinese)
const STEPS = {
  RECEIVED: { code: 'RECEIVED', name: '已接收并保存文件', progress: 10 },
  ENQUEUED: { code: 'ENQUEUED', name: '已入库并创建解析任务', progress: 20 },
  PARSING: { code: 'PARSING', name: 'AI 解析中', progress: 50 },
  POSTPROCESS: { code: 'POSTPROCESS', name: '结果校验与入库', progress: 80 },
  DONE: { code: 'DONE', name: '完成', progress: 100 },
  QUEUED: { code: 'QUEUED', name: '等待处理', progress: 0 },
  CANCELLED: { code: 'CANCELLED', name: '已取消', progress: 100 },
};

const POLL_INTERVAL_MS = 2000;

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
    if (dbType === 'postgres') {
      await pool.query(`
        UPDATE jobs
        SET status = 'cancelled',
            step_code = 'CANCELLED',
            step_name = '已取消',
            progress = 100,
            finished_at = NOW(),
            error_message = '用户手动取消'
        WHERE id = $1 AND status IN ('queued', 'running')`, [jobId]);
    } else {
      querySqlite(`
        UPDATE jobs
        SET status = 'cancelled',
            step_code = 'CANCELLED',
            step_name = '已取消',
            progress = 100,
            finished_at = datetime('now'),
            error_message = '用户手动取消'
        WHERE id = ${sqlValue(jobId)} AND status IN ('queued', 'running');`);
    }

    return true;
  }

  private async handleJobFailure(job: QueuedJob, error: any): Promise<void> {
    const { code, message } = this.normalizeError(error);

    // Check for Cancellation
    if (axios.isCancel(error) || error.name === 'AbortError' || message.includes('User cancelled') || message.includes('canceled')) {
      console.log(`[Job ${job.id}] Job was cancelled.`);
      if (dbType === 'postgres') {
        await pool.query(`
          UPDATE jobs 
          SET status = 'cancelled',
              error_message = '用户手动取消',
              progress = 100,
              step_code = 'CANCELLED',
              step_name = '已取消',
              finished_at = NOW()
          WHERE id = $1`, [job.id]);
      } else {
        querySqlite(`
          UPDATE jobs 
          SET status = 'cancelled',
              error_message = '用户手动取消',
              progress = 100,
              step_code = 'CANCELLED',
              step_name = '已取消',
              finished_at = datetime('now')
          WHERE id = ${sqlValue(job.id)};`);
      }
      return;
    }

    const attempt = job.retry_count + 1;

    console.error(`[Job ${job.id}] Attempt ${attempt} failed:`, error);

    // Check if we can retry
    if (job.retry_count < job.max_retries) {
      // Retry: increment retry_count, reset to queued
      console.log(`[Job ${job.id}] Retrying with attempt ${attempt + 1} (fallback model)...`);

      const errorMsg = `第${attempt}轮失败: ${message}`;
      if (dbType === 'postgres') {
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
        querySqlite(`
          UPDATE jobs 
          SET status = 'queued',
              retry_count = retry_count + 1,
              attempt = retry_count + 2,
              progress = ${STEPS.QUEUED.progress},
              step_code = ${sqlValue(STEPS.QUEUED.code)},
              step_name = ${sqlValue(STEPS.QUEUED.name)},
              error_code = ${sqlValue(code)},
              error_message = ${sqlValue(errorMsg)}
          WHERE id = ${sqlValue(job.id)};`);
      }
    } else {
      // Final failure: mark as failed
      const finalMessage = `已更换模型重试仍失败。第1轮失败原因: ${code}; 第2轮失败原因: ${message}`;

      if (dbType === 'postgres') {
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
      } else {
        querySqlite(`
          UPDATE jobs 
          SET status = 'failed',
              error_code = ${sqlValue(code)},
              error_message = ${sqlValue(finalMessage)},
              finished_at = datetime('now'),
              progress = 100,
              step_code = ${sqlValue(STEPS.DONE.code)},
              step_name = ${sqlValue('失败')}
          WHERE id = ${sqlValue(job.id)};`);
      }

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
      if (dbType === 'postgres') {
        const result = await pool.query('SELECT provider, model FROM jobs WHERE id = $1 LIMIT 1', [job.id]);
        jobConfig = result.rows[0];
      } else {
        jobConfig = querySqlite(`SELECT provider, model FROM jobs WHERE id = ${sqlValue(job.id)} LIMIT 1;`)[0] as { provider?: string; model?: string } | undefined;
      }

      let pName = jobConfig?.provider;
      let mName = jobConfig?.model;

      // If job doesn't have provider/model, fallback to version config
      if (!pName && !mName) {
        let versionConfig: { provider?: string; model?: string } | undefined;
        if (dbType === 'postgres') {
          const result = await pool.query('SELECT provider, model FROM report_versions WHERE id = $1 LIMIT 1', [job.version_id]);
          versionConfig = result.rows[0];
        } else {
          versionConfig = querySqlite(`SELECT provider, model FROM report_versions WHERE id = ${sqlValue(job.version_id)} LIMIT 1;`)[0] as { provider?: string; model?: string } | undefined;
        }

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
    if (dbType === 'postgres') {
      await pool.query(`
        UPDATE jobs 
        SET step_code = $1,
        step_name = $2,
        progress = $3,
        provider = $4,
        model = $5
        WHERE id = $6`,
        [STEPS.POSTPROCESS.code, STEPS.POSTPROCESS.name, STEPS.POSTPROCESS.progress, parseResult.provider, parseResult.model, job.id]);
    } else {
      querySqlite(`
        UPDATE jobs 
        SET step_code = ${sqlValue(STEPS.POSTPROCESS.code)},
        step_name = ${sqlValue(STEPS.POSTPROCESS.name)},
        progress = ${STEPS.POSTPROCESS.progress},
        provider = ${sqlValue(parseResult.provider)},
        model = ${sqlValue(parseResult.model)}
        WHERE id = ${sqlValue(job.id)};`);
    }

    const outputJson = this.stringifyOutput(parseResult);

    // Insert parse result
    if (dbType === 'postgres') {
      await pool.query(
        `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [job.version_id, parseResult.provider, parseResult.model, outputJson]);
    } else {
      querySqlite(
        `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
         VALUES (${sqlValue(job.version_id)}, ${sqlValue(parseResult.provider)}, ${sqlValue(parseResult.model)}, ${sqlValue(outputJson)}, datetime('now'));`);
    }

    if (this.hasParsedJsonColumn()) {
      if (dbType === 'postgres') {
        await pool.query(
          `UPDATE report_versions
           SET parsed_json = $1,
               provider = $2,
               model = $3,
               prompt_version = 'v1'
           WHERE id = $4`,
          [outputJson, parseResult.provider, parseResult.model, job.version_id]);
      } else {
        querySqlite(
          `UPDATE report_versions
           SET parsed_json = ${sqlValue(outputJson)},
               provider = ${sqlValue(parseResult.provider)},
               model = ${sqlValue(parseResult.model)},
               prompt_version = 'v1'
           WHERE id = ${sqlValue(job.version_id)};`);
      }
    }

    // Success: mark as DONE
    if (dbType === 'postgres') {
      await pool.query(`
        UPDATE jobs 
        SET status = 'succeeded', 
            progress = $1,
            step_code = $2,
            step_name = $3,
            finished_at = NOW() 
        WHERE id = $4`,
        [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
    } else {
      querySqlite(`
        UPDATE jobs 
        SET status = 'succeeded', 
            progress = ${STEPS.DONE.progress},
            step_code = ${sqlValue(STEPS.DONE.code)},
            step_name = ${sqlValue(STEPS.DONE.name)},
            finished_at = datetime('now') 
        WHERE id = ${sqlValue(job.id)};`);
    }

    // Enqueue checks job if not already queued/running
    if (job.version_id && job.report_id) {
      const existingChecksJob = querySqlite(
        `SELECT id FROM jobs WHERE report_id = ${sqlValue(job.report_id)} AND version_id = ${sqlValue(job.version_id)} AND kind = 'checks' AND status IN ('queued', 'running') LIMIT 1;`
      )[0] as { id?: number } | undefined;

      if (!existingChecksJob?.id) {
        querySqlite(
          `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries) 
           VALUES (${sqlValue(job.report_id)}, ${sqlValue(job.version_id)}, 'checks', 'queued', 60, ${sqlValue(STEPS.POSTPROCESS.code)}, ${sqlValue('等待校验')}, 1);`
        );
        console.log(`[Job ${job.id}] Enqueued checks job for version ${job.version_id}`);
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
    // ensureSqliteMigrations() is already called in index-llm.ts

    const runningJobs = querySqlite(
      `SELECT id FROM jobs WHERE status = 'running';`
    );

    if (runningJobs.length > 0) {
      console.log(`[Recovery] Found ${runningJobs.length} running jobs, resetting to queued...`);

      querySqlite(`
        UPDATE jobs 
        SET status = 'queued',
            progress = ${STEPS.QUEUED.progress},
            step_code = ${sqlValue(STEPS.QUEUED.code)},
            step_name = ${sqlValue(STEPS.QUEUED.name)},
            error_code = NULL,
            error_message = NULL
        WHERE status = 'running';
      `);

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
    } finally {
      this.processing = false;
      this.scheduleNextTick();
    }
  }

  private async claimNextJob(): Promise<QueuedJob | null> {
    // Ensure migrations for SQLite only
    if (dbType === 'sqlite') {
      ensureSqliteMigrations();
    }

    let updatedJobs: any[];
    if (dbType === 'postgres') {
      // PostgreSQL: Use two separate queries for atomic claim
      const selectResult = await pool.query(`
        SELECT id FROM jobs 
        WHERE status = 'queued' AND kind != 'pdf_export'
        ORDER BY (CASE kind WHEN 'parse' THEN 0 WHEN 'checks' THEN 1 WHEN 'compare' THEN 2 ELSE 9 END) ASC, created_at ASC
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
      
      updatedJobs = updateResult.rows;
    } else {
      updatedJobs = querySqlite(`
        UPDATE jobs
        SET status = 'running', 
            started_at = datetime('now'),
            step_code = ${sqlValue(STEPS.PARSING.code)},
            step_name = ${sqlValue(STEPS.PARSING.name)},
            progress = ${STEPS.PARSING.progress}
        WHERE id = (
          SELECT id
          FROM jobs
          WHERE status = 'queued' AND kind != 'pdf_export'
          ORDER BY (CASE kind WHEN 'parse' THEN 0 WHEN 'checks' THEN 1 WHEN 'compare' THEN 2 ELSE 9 END) ASC, created_at ASC
          LIMIT 1
        )
        RETURNING id, report_id, version_id, kind, comparison_id, retry_count, max_retries;`);
    }

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
      let versionRow: any;
      if (dbType === 'postgres') {
        const result = await pool.query(
          'SELECT storage_path, file_hash FROM report_versions WHERE id = $1 LIMIT 1',
          [jobRow.version_id]);
        versionRow = result.rows[0];
      } else {
        versionRow = querySqlite(
          `SELECT storage_path, file_hash FROM report_versions WHERE id = ${sqlValue(jobRow.version_id)} LIMIT 1;`)[0];
      }
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

  private async processChecksJob(job: QueuedJob): Promise<void> {
    if (!job.version_id) {
      throw new Error('Checks job missing version_id');
    }

    // Get parsed_json from report_versions
    const version = querySqlite(`
      SELECT id, parsed_json FROM report_versions WHERE id = ${sqlValue(job.version_id)} LIMIT 1;
    `)[0] as { id?: number; parsed_json?: string } | undefined;

    if (!version?.id) {
      throw new Error('Version not found');
    }

    if (!version.parsed_json) {
      throw new LlmProviderError('parsed_json is empty, cannot run checks', 'PARSED_JSON_EMPTY');
    }

    // Run consistency checks
    try {
      const { runId, items } = consistencyCheckService.runAndPersist(job.version_id, version.parsed_json);
      console.log(`[Job ${job.id}] Consistency checks completed: runId=${runId}, items=${items.length}`);
    } catch (error) {
      console.error('[Job ${job.id}] Consistency check failed:', error);
      throw error;
    }

    querySqlite(`
      UPDATE jobs 
      SET status = 'succeeded', 
          progress = ${STEPS.DONE.progress},
          step_code = ${sqlValue(STEPS.DONE.code)},
          step_name = ${sqlValue(STEPS.DONE.name)},
          finished_at = datetime('now') 
      WHERE id = ${sqlValue(job.id)};
    `);

    // Check if we need to generate notification (after all jobs complete)
    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);
    }
  }

  private async processCompareJob(job: QueuedJob): Promise<void> {
    if (!job.comparison_id || !job.report_id) {
      throw new Error('Compare job missing comparison or report reference');
    }

    const comparison = querySqlite(`
      SELECT id, left_report_id, right_report_id
      FROM comparisons
      WHERE id = ${sqlValue(job.comparison_id)}
      LIMIT 1;
    `)[0];

    if (!comparison) {
      throw new Error('comparison_not_found');
    }

    const leftVersion = querySqlite(`
      SELECT id as version_id, parsed_json
      FROM report_versions
      WHERE report_id = ${sqlValue(comparison.left_report_id)} AND is_active = 1
      LIMIT 1;
    `)[0];
    const rightVersion = querySqlite(`
      SELECT id as version_id, parsed_json
      FROM report_versions
      WHERE report_id = ${sqlValue(comparison.right_report_id)} AND is_active = 1
      LIMIT 1;
    `)[0];

    const parseJson = (value: any): any => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') return value;
      try {
        return JSON.parse(value);
      } catch (error) {
        return null;
      }
    };

    const leftParsed = parseJson(leftVersion?.parsed_json);
    const rightParsed = parseJson(rightVersion?.parsed_json);

    if (!leftVersion?.version_id || !rightVersion?.version_id || !leftParsed || !rightParsed) {
      const error = new LlmProviderError('Parse result not ready for comparison', 'PARSE_NOT_READY');
      throw error;
    }

    const diffResult = summarizeDiff(leftParsed, rightParsed);
    const diffJson = JSON.stringify(diffResult);

    querySqlite(`
      INSERT INTO comparison_results (comparison_id, diff_json, created_at)
      VALUES (${sqlValue(job.comparison_id)}, ${sqlValue(diffJson)}, datetime('now'))
      ON CONFLICT(comparison_id) DO UPDATE SET diff_json = excluded.diff_json, created_at = excluded.created_at;
    `);

    querySqlite(`
      UPDATE jobs 
      SET status = 'succeeded', 
          progress = ${STEPS.DONE.progress},
          step_code = ${sqlValue(STEPS.DONE.code)},
          step_name = ${sqlValue(STEPS.DONE.name)},
          finished_at = datetime('now') 
      WHERE id = ${sqlValue(job.id)};
    `);
  }

  /**
   * Generate notification when all jobs for a version are complete
   */
  private async generateNotificationIfNeeded(versionId: number): Promise<void> {
    // Check if all jobs for this version are complete
    const versionJobs = querySqlite(`
      SELECT id, status, kind, error_message
      FROM jobs
      WHERE version_id = ${sqlValue(versionId)}
      ORDER BY created_at ASC;
    `) as Array<{ id: number; status: string; kind: string; error_message?: string }>;

    if (versionJobs.length === 0) {
      return;
    }

    // Check if any job is still running or queued
    const hasIncomplete = versionJobs.some(j => j.status === 'queued' || j.status === 'running');
    if (hasIncomplete) {
      return; // Not all jobs complete yet
    }

    // All jobs complete: determine success/failure
    const hasFailure = versionJobs.some(j => j.status === 'failed');

    // Get version details
    const version = querySqlite(`
      SELECT rv.id, rv.report_id, r.region_id, r.year, r.unit_name
      FROM report_versions rv
      JOIN reports r ON rv.report_id = r.id
      WHERE rv.id = ${sqlValue(versionId)}
      LIMIT 1;
    `)[0] as { id: number; report_id: number; region_id: number; year: number; unit_name: string } | undefined;

    if (!version) {
      return;
    }

    // Check if notification already exists
    const existingNotification = querySqlite(`
      SELECT id FROM notifications WHERE related_version_id = ${sqlValue(versionId)} LIMIT 1;
    `)[0];

    if (existingNotification) {
      return; // Already notified
    }

    // Build notification content
    const successCount = hasFailure ? 0 : 1;
    const failList: Array<{ region_id: number; year: number; unit_name: string; reason: string }> = [];

    if (hasFailure) {
      const failedJob = versionJobs.find(j => j.status === 'failed');
      failList.push({
        region_id: version.region_id,
        year: version.year,
        unit_name: version.unit_name,
        reason: failedJob?.error_message || '未知错误',
      });
    }

    const contentJson = JSON.stringify({
      uploaded_count: 1,
      success_count: successCount,
      fail_list: failList,
      task_link: `/jobs/${versionId}`,
    });

    const title = hasFailure ? '上传任务失败' : '上传任务成功';

    querySqlite(`
      INSERT INTO notifications (type, title, content_json, related_version_id, created_at)
      VALUES ('upload_complete', ${sqlValue(title)}, ${sqlValue(contentJson)}, ${sqlValue(versionId)}, datetime('now'));
    `);

    console.log(`[Notification] Generated for version ${versionId}: ${title}`);
  }

  /**
   * Get the appropriate provider based on attempt number
   * attempt=1: use PRIMARY model
   * attempt=2: use FALLBACK model
   */
  private getProvider(attempt: number): LlmProvider {
    if (attempt === 1) {
      if (!this.primaryProvider) {
        this.primaryProvider = createLlmProvider();
      }
      return this.primaryProvider;
    } else {
      if (!this.fallbackProvider) {
        this.fallbackProvider = this.createFallbackProvider();
      }
      return this.fallbackProvider;
    }
  }

  private createFallbackProvider(): LlmProvider {
    // Read fallback config from env
    const fallbackProviderName = process.env.LLM_FALLBACK_PROVIDER?.toLowerCase().trim();
    const fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim() || 'deepseek-ai/DeepSeek-V3.2';

    if (!fallbackProviderName || !fallbackModel) {
      console.warn('[Warning] LLM_FALLBACK_PROVIDER or LLM_FALLBACK_MODEL not configured, using primary provider as fallback');
      return createLlmProvider();
    }

    // Support gemini, modelscope, or stub
    if (fallbackProviderName === 'gemini') {
      const GeminiLlmProvider = require('./GeminiLlmProvider').GeminiLlmProvider;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new LlmProviderError('GEMINI_API_KEY required for fallback provider', 'missing_gemini_key');
      }
      return new GeminiLlmProvider(apiKey, fallbackModel);
    }

    if (fallbackProviderName === 'modelscope') {
      const ModelScopeLlmProvider = require('./ModelScopeLlmProvider').ModelScopeLlmProvider;
      const apiKey = process.env.MODELSCOPE_API_KEY;
      if (!apiKey) {
        throw new LlmProviderError('MODELSCOPE_API_KEY required for fallback provider', 'missing_modelscope_key');
      }
      return new ModelScopeLlmProvider(apiKey, fallbackModel);
    }

    // Default: use primary provider
    console.warn(`[Warning] Unsupported fallback provider: ${fallbackProviderName}, using primary provider`);
    return createLlmProvider();
  }

  private stringifyOutput(parseResult: LlmParseResult): string {
    const output = parseResult?.output ?? parseResult;
    try {
      return JSON.stringify(output);
    } catch (error) {
      throw new LlmProviderError('Failed to serialize LLM output', 'llm_output_serialization_error');
    }
  }

  private hasParsedJsonColumn(): boolean {
    if (this.parsedJsonColumnExists !== null) {
      return this.parsedJsonColumnExists;
    }

    const columns = querySqlite('PRAGMA table_info(report_versions);') as Array<{ name?: string }>;
    this.parsedJsonColumnExists = columns.some((column) => column.name === 'parsed_json');
    return this.parsedJsonColumnExists;
  }

  private normalizeError(error: unknown): { code: string; message: string } {
    if (error instanceof LlmProviderError) {
      return { code: error.code || 'LLM_PROVIDER_ERROR', message: error.message };
    }

    const message = typeof (error as any)?.message === 'string' ? (error as any).message : 'unknown_error';
    if ((error as any)?.code) {
      return { code: String((error as any).code), message };
    }
    return { code: 'LLM_JOB_ERROR', message };
  }
}

export const llmJobRunner = new LlmJobRunner();
