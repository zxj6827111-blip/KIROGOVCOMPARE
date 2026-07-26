/**
 * Minimal downstream recovery for a report_version pipeline.
 *
 * Covers the gap where the parse stage (kind=parse OR kind=structured_import)
 * already succeeded but materialize/checks failed (or were never enqueued due
 * to a crash window). Recovery re-enqueues ONLY the failed downstream job:
 *   - never re-runs structured_import;
 *   - never creates AI parse jobs (no LLM involvement);
 *   - is idempotent and concurrency-safe: the partial unique indexes
 *     uq_jobs_version_materialize_active / uq_jobs_version_checks_active
 *     guarantee at most one active job per kind, and a 23505 race is resolved
 *     by re-querying the winner instead of surfacing HTTP 500.
 *
 * Used by POST /jobs/:version_id/retry and by structured-import package
 * re-upload (reuse of an already-succeeded import heals its downstream).
 */
import pool from '../config/database-llm';

export type DownstreamKind = 'materialize' | 'checks';

export type PipelineRecoveryAction =
  | {
      action: 'none';
      reason: 'no_jobs' | 'jobs_in_progress' | 'upstream_failed' | 'nothing_to_retry';
    }
  | { action: 'requeued'; kind: DownstreamKind; jobId: number; reused: boolean };

type CoreJobRow = {
  id: number;
  report_id: number | null;
  version_id: number | null;
  kind: string;
  status: string;
};

const PARSE_STAGE_KINDS = new Set(['parse', 'structured_import']);
const CORE_KINDS = new Set(['parse', 'structured_import', 'materialize', 'checks']);

function latestOfKinds(jobs: CoreJobRow[], kinds: Set<string> | string): CoreJobRow | null {
  const kindSet = typeof kinds === 'string' ? new Set([kinds]) : kinds;
  const matched = jobs.filter((job) => kindSet.has(String(job.kind || '')));
  return matched.length > 0 ? matched[matched.length - 1] : null;
}

function isFinalFailure(job: CoreJobRow | null): boolean {
  if (!job) return false;
  const status = String(job.status || '').toLowerCase();
  return status === 'failed' || status === 'cancelled';
}

function isSucceeded(job: CoreJobRow | null): boolean {
  return String(job?.status || '').toLowerCase() === 'succeeded';
}

/**
 * Ensure exactly one active downstream job of the given kind for a version.
 * Reuses an active job when present; otherwise inserts a new queued job and
 * resolves 23505 unique-index races by returning the concurrent winner.
 * Historic failed jobs are kept as-is (matches existing job-history design).
 */
export async function ensureDownstreamJob(
  reportId: number,
  versionId: number,
  kind: DownstreamKind
): Promise<{ action: 'requeued'; kind: DownstreamKind; jobId: number; reused: boolean }> {
  const findActive = async (): Promise<number | null> => {
    const active = await pool.query(
      `SELECT id FROM jobs
       WHERE version_id = $1 AND kind = $2 AND status IN ('queued', 'running')
       ORDER BY id DESC LIMIT 1`,
      [versionId, kind]
    );
    return active.rows[0]?.id ? Number(active.rows[0].id) : null;
  };

  const existing = await findActive();
  if (existing) {
    return { action: 'requeued', kind, jobId: existing, reused: true };
  }

  const batchRes = await pool.query(
    `SELECT ingestion_batch_id FROM report_versions WHERE id = $1 LIMIT 1`,
    [versionId]
  );
  const ingestionBatchId = batchRes.rows[0]?.ingestion_batch_id ?? null;

  try {
    const inserted =
      kind === 'materialize'
        ? await pool.query(
            `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
             VALUES ($1, $2, 'materialize', 'queued', 60, 'MATERIALIZE', 'waiting materialize', 1, $3)
             RETURNING id`,
            [reportId, versionId, ingestionBatchId]
          )
        : await pool.query(
            `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
             VALUES ($1, $2, 'checks', 'queued', 60, 'POSTPROCESS', '等待校验', 0, $3)
             RETURNING id`,
            [reportId, versionId, ingestionBatchId]
          );
    return { action: 'requeued', kind, jobId: Number(inserted.rows[0].id), reused: false };
  } catch (error: any) {
    if (error?.code === '23505') {
      // Concurrent request won the unique active-job index; return the winner.
      const winner = await findActive();
      if (winner) {
        return { action: 'requeued', kind, jobId: winner, reused: true };
      }
      throw new Error(
        `pipeline_recovery_conflict: no active ${kind} job found after unique violation (version ${versionId})`
      );
    }
    throw error;
  }
}

/**
 * Analyze the version's core pipeline and requeue the single failed/missing
 * downstream job when the parse stage already succeeded.
 *
 * Returns action:'none' with a reason when nothing was requeued:
 *   - jobs_in_progress: a core job is still queued/running;
 *   - upstream_failed:  parse stage did not succeed (caller may fall back to
 *                       the legacy "recreate failed jobs" behavior);
 *   - nothing_to_retry: the whole core pipeline already succeeded;
 *   - no_jobs:          the version has no jobs at all.
 */
export async function recoverVersionDownstream(versionId: number): Promise<PipelineRecoveryAction> {
  const jobsRes = await pool.query(
    `SELECT id, report_id, version_id, kind, status
     FROM jobs
     WHERE version_id = $1
     ORDER BY id ASC`,
    [versionId]
  );
  const coreJobs: CoreJobRow[] = (jobsRes.rows || []).filter((job: CoreJobRow) =>
    CORE_KINDS.has(String(job.kind || ''))
  );

  if (coreJobs.length === 0) {
    return { action: 'none', reason: 'no_jobs' };
  }

  const activeCore = coreJobs.find((job) =>
    ['queued', 'running'].includes(String(job.status || '').toLowerCase())
  );
  if (activeCore) {
    return { action: 'none', reason: 'jobs_in_progress' };
  }

  const parseStage = latestOfKinds(coreJobs, PARSE_STAGE_KINDS);
  if (!isSucceeded(parseStage)) {
    return { action: 'none', reason: 'upstream_failed' };
  }

  const reportId = Number(parseStage!.report_id || 0);
  const materialize = latestOfKinds(coreJobs, 'materialize');
  const checks = latestOfKinds(coreJobs, 'checks');

  // Materialize failed, or never enqueued (crash window) => requeue materialize.
  if (!materialize || isFinalFailure(materialize)) {
    return ensureDownstreamJob(reportId, versionId, 'materialize');
  }

  if (isSucceeded(materialize)) {
    // Checks failed, or never enqueued after materialize succeeded => requeue checks.
    if (!checks || isFinalFailure(checks)) {
      return ensureDownstreamJob(reportId, versionId, 'checks');
    }
    if (isSucceeded(checks)) {
      return { action: 'none', reason: 'nothing_to_retry' };
    }
  }

  // Defensive: unknown terminal states — do not create anything.
  return { action: 'none', reason: 'nothing_to_retry' };
}
