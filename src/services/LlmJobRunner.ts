import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import { stubLlmProvider } from './StubLlmProvider';

interface QueuedJob {
  id: number;
  report_id: number;
  version_id: number;
  storage_path: string;
  file_hash: string;
}

const POLL_INTERVAL_MS = 2000;

export class LlmJobRunner {
  private running = false;
  private processing = false;

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
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
      const job = this.claimNextJob();
      if (!job) {
        return;
      }

      await this.processJob(job);
    } finally {
      this.processing = false;
      this.scheduleNextTick();
    }
  }

  private claimNextJob(): QueuedJob | null {
    ensureSqliteMigrations();

    const rows = querySqlite(`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT 1
      ),
      updated AS (
        UPDATE jobs
        SET status = 'running', started_at = datetime('now')
        WHERE id IN (SELECT id FROM next_job)
        RETURNING *
      )
      SELECT updated.id, updated.report_id, updated.version_id, rv.storage_path, rv.file_hash
      FROM updated
      LEFT JOIN report_versions rv ON rv.id = updated.version_id;
    `);

    if (!rows.length) {
      return null;
    }

    return rows[0] as QueuedJob;
  }

  private async processJob(job: QueuedJob): Promise<void> {
    try {
      if (!job.version_id || !job.storage_path) {
        throw new Error('Job missing required version or storage');
      }

      const parseResult = await stubLlmProvider.parse({
        reportId: job.report_id,
        versionId: job.version_id,
        storagePath: job.storage_path,
        fileHash: job.file_hash,
      });

      const outputJson = JSON.stringify(parseResult);

      querySqlite(
        `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
         VALUES (${sqlValue(job.version_id)}, ${sqlValue(parseResult.provider)}, ${sqlValue(parseResult.model)}, ${sqlValue(outputJson)}, datetime('now'));`
      );

      querySqlite(
        `UPDATE report_versions SET parsed_json = ${sqlValue(outputJson)} WHERE id = ${sqlValue(job.version_id)};`
      );

      querySqlite(
        `UPDATE jobs SET status = 'succeeded', progress = 100, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
      );
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : 'unknown_error';
      querySqlite(
        `UPDATE jobs SET status = 'failed', error_message = ${sqlValue(message)}, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
      );
      console.error(`LLM job ${job.id} failed:`, error);
    }
  }
}

export const llmJobRunner = new LlmJobRunner();
