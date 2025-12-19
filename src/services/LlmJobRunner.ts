import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import { LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { createLlmProvider } from './LlmProviderFactory';
import { summarizeDiff } from '../utils/jsonDiff';

interface QueuedJob {
  id: number;
  kind: string;
  report_id: number | null;
  version_id: number | null;
  storage_path?: string;
  file_hash?: string;
  comparison_id?: number | null;
}

const POLL_INTERVAL_MS = 2000;

export class LlmJobRunner {
  private running = false;
  private processing = false;
  private provider: LlmProvider | null = null;
  private parsedJsonColumnExists: boolean | null = null;

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

    const updatedJobs = querySqlite(`
      UPDATE jobs
      SET status = 'running', started_at = datetime('now')
      WHERE id = (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY (CASE WHEN kind = 'compare' THEN 0 ELSE 1 END) ASC, created_at ASC
        LIMIT 1
      )
      RETURNING id, report_id, version_id, kind, comparison_id;
    `);

    if (!updatedJobs.length) {
      return null;
    }

    const jobRow = updatedJobs[0] as {
      id: number;
      report_id?: number;
      version_id?: number;
      kind?: string;
      comparison_id?: number;
    };

    let storagePath: string | undefined;
    let fileHash: string | undefined;
    if ((jobRow.kind || 'parse') === 'parse' && jobRow.version_id) {
      const versionRow = querySqlite(
        `SELECT storage_path, file_hash FROM report_versions WHERE id = ${sqlValue(jobRow.version_id)} LIMIT 1;`
      )[0];
      storagePath = versionRow?.storage_path;
      fileHash = versionRow?.file_hash;
    }

    return {
      id: jobRow.id,
      report_id: jobRow.report_id ?? null,
      version_id: jobRow.version_id ?? null,
      kind: jobRow.kind || 'parse',
      storage_path: storagePath,
      file_hash: fileHash,
      comparison_id: jobRow.comparison_id ?? null,
    } as QueuedJob;
  }

  private async processJob(job: QueuedJob): Promise<void> {
    try {
      if (job.kind === 'compare') {
        await this.processCompareJob(job);
      } else {
        await this.processParseJob(job);
      }
    } catch (error: any) {
      const { code, message } = this.normalizeError(error);
      querySqlite(
        `UPDATE jobs SET status = 'failed', error_code = ${sqlValue(code)}, error_message = ${sqlValue(message)}, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
      );
      console.error(`LLM job ${job.id} failed:`, error);
    }
  }

  private async processParseJob(job: QueuedJob): Promise<void> {
    if (!job.version_id || !job.storage_path) {
      throw new Error('Job missing required version or storage');
    }

    const provider = this.getProvider();
    const parseResult = await provider.parse({
      reportId: job.report_id || 0,
      versionId: job.version_id,
      storagePath: job.storage_path,
      fileHash: job.file_hash,
    });

    const outputJson = this.stringifyOutput(parseResult);

    querySqlite(
      `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
       VALUES (${sqlValue(job.version_id)}, ${sqlValue(parseResult.provider)}, ${sqlValue(parseResult.model)}, ${sqlValue(outputJson)}, datetime('now'));`
    );

    if (this.hasParsedJsonColumn()) {
      querySqlite(
        `UPDATE report_versions
         SET parsed_json = ${sqlValue(outputJson)},
             provider = ${sqlValue(parseResult.provider)},
             model = ${sqlValue(parseResult.model)},
             prompt_version = 'v1'
         WHERE id = ${sqlValue(job.version_id)};`
      );
    }

    querySqlite(
      `UPDATE jobs SET status = 'succeeded', progress = 100, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
    );
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

    querySqlite(
      `UPDATE jobs SET status = 'succeeded', progress = 100, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
    );
  }

  private getProvider(): LlmProvider {
    if (!this.provider) {
      this.provider = createLlmProvider();
    }

    return this.provider;
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
