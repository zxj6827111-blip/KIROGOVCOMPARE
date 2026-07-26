/**
 * Shared AI-parse enqueue service.
 *
 * Single choke point for creating kind='parse' jobs: the single-report
 * re-parse endpoint, batch re-parse, and any future caller all go through
 * enqueueReportParseJob. The structured-import guard lives here (service
 * layer), so bypassing the HTTP routes cannot bypass the guard.
 */
import pool from '../config/database-llm';
import { checkStoragePathExists } from './SourceFileGuardService';
import { hasParsedContent } from '../utils/parsedContent';
import { resolveParseMaxRetries } from '../utils/jobRetryPolicy';

export async function hasAnyFactsForVersion(reportId: number, versionId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT
       EXISTS(
         SELECT 1 FROM fact_active_disclosure
         WHERE report_id = $1 AND version_id = $2
       ) OR EXISTS(
         SELECT 1 FROM fact_application
         WHERE report_id = $1 AND version_id = $2
       ) OR EXISTS(
         SELECT 1 FROM fact_legal_proceeding
         WHERE report_id = $1 AND version_id = $2
       ) AS has_facts`,
    [reportId, versionId]
  );
  return Boolean(result.rows[0]?.has_facts);
}

export async function resolvePreferredVersionId(reportId: number): Promise<number | null> {
  const result = await pool.query(
    `SELECT id
     FROM report_versions
     WHERE report_id = $1
       AND review_status = 'pending_review'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [reportId]
  );
  if (result.rows[0]?.id) {
    return Number(result.rows[0].id);
  }

  const activeRes = await pool.query(
    `SELECT active_version_id
     FROM reports
     WHERE id = $1
     LIMIT 1`,
    [reportId]
  );
  return activeRes.rows[0]?.active_version_id ? Number(activeRes.rows[0].active_version_id) : null;
}

export async function ensureMaterializeJob(
  reportId: number,
  versionId: number,
  ingestionBatchId: number | null
): Promise<{ jobId: number; status: 'queued' | 'running'; reused: boolean }> {
  const existingJobRes = await pool.query(
    `SELECT id, status
     FROM jobs
     WHERE report_id = $1
       AND version_id = $2
       AND kind = 'materialize'
       AND status IN ('queued', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [reportId, versionId]
  );

  const existing = existingJobRes.rows[0];
  if (existing?.id) {
    return {
      jobId: Number(existing.id),
      status: (existing.status === 'running' ? 'running' : 'queued'),
      reused: true,
    };
  }

  const insertRes = await pool.query(
    `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
     VALUES ($1, $2, 'materialize', 'queued', 60, 'MATERIALIZE', '等待结构化', 1, $3)
     RETURNING id`,
    [reportId, versionId, ingestionBatchId]
  );

  return { jobId: Number(insertRes.rows[0].id), status: 'queued', reused: false };
}

export type ParseJobSubmitResult =
  | {
    ok: true;
    reportId: number;
    versionId: number;
    jobId: number;
    status: 'queued' | 'running' | string;
    reused: boolean;
    reason?: string;
  }
  | {
    ok: false;
    statusCode: number;
    error: string;
    message?: string;
    versionId?: number;
    storagePath?: string | null;
    resolvedPath?: string | null;
    fixedStaleJobId?: number;
  };

/**
 * P1 guard: versions ingested from a local structured package must never be
 * re-parsed by the AI pipeline — that would overwrite the imported parsed_json
 * (losing _ingestion provenance) while ingestion_mode still says
 * structured_import. Enforced here in the shared enqueue function so every
 * current and future parse entry point (single, batch, ...) is covered.
 */
export const STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN = 'STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN';
export const STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN_MESSAGE =
  '该报告版本由本地结构化材料包导入，不能使用AI重新解析。请重新上传材料包，或重新执行物化与检查任务。';

export async function enqueueReportParseJob(input: {
  reportId: number;
  allowedRegionIds: number[] | null;
  requestedVersionId?: number | null;
  forceParse?: boolean;
}): Promise<ParseJobSubmitResult> {
  const { reportId, allowedRegionIds, requestedVersionId = null, forceParse = false } = input;

  if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
    return { ok: false, statusCode: 400, error: 'report_id 无效' };
  }

  if (allowedRegionIds && allowedRegionIds.length === 0) {
    return { ok: false, statusCode: 403, error: 'forbidden' };
  }

  const reportRes = await pool.query(
    `SELECT r.id, r.region_id, r.active_version_id
     FROM reports r
     WHERE r.id = $1
     LIMIT 1`,
    [reportId]
  );
  const reportRow = reportRes.rows?.[0];
  if (!reportRow) {
    return { ok: false, statusCode: 404, error: 'report not found' };
  }
  if (allowedRegionIds && !allowedRegionIds.includes(Number(reportRow.region_id))) {
    return { ok: false, statusCode: 403, error: 'forbidden' };
  }

  let versionId: number | null = requestedVersionId ? Number(requestedVersionId) : null;
  if (versionId !== null && (Number.isNaN(versionId) || versionId < 1)) {
    return { ok: false, statusCode: 400, error: 'version_id 无效' };
  }

  if (!versionId) {
    versionId = await resolvePreferredVersionId(reportId);
    if (!versionId) {
      const latestRes = await pool.query(
        `SELECT id FROM report_versions
         WHERE report_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [reportId]
      );
      versionId = latestRes.rows?.[0]?.id ?? null;
    }
  }

  if (!versionId) {
    return { ok: false, statusCode: 404, error: 'report_version not found' };
  }

  const versionRes = await pool.query(
    `SELECT provider, model, ingestion_batch_id, parsed_json, storage_path, ingestion_mode
     FROM report_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId]
  );
  const versionRow = versionRes.rows?.[0];
  if (!versionRow) {
    return { ok: false, statusCode: 404, error: 'report_version not found' };
  }

  // Guard BEFORE any job reuse/creation: structured imports never enter the AI queue.
  if (String(versionRow.ingestion_mode || '') === 'structured_import') {
    return {
      ok: false,
      statusCode: 422,
      error: STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN,
      message: STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN_MESSAGE,
      versionId: Number(versionId),
    };
  }

  const sourceCheck = checkStoragePathExists(versionRow.storage_path ?? null);

  const existingJobRes = await pool.query(
    `SELECT id, status FROM jobs
     WHERE report_id = $1
       AND version_id = $2
       AND kind = 'parse'
       AND status IN ('queued', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [reportId, versionId]
  );
  const existingJob = existingJobRes.rows?.[0];
  if (existingJob?.id) {
    if (existingJob.status === 'queued' && !sourceCheck.ok) {
      await pool.query(
        `UPDATE jobs
         SET status = 'failed',
             error_code = 'SOURCE_FILE_MISSING',
             error_message = $2,
             progress = 100,
             step_code = 'DONE',
             step_name = 'Failed',
             finished_at = NOW()
         WHERE id = $1
           AND status = 'queued'`,
        [existingJob.id, sourceCheck.errorMessage || 'source file missing']
      );
      return {
        ok: false,
        statusCode: 422,
        error: 'SOURCE_FILE_MISSING',
        message: sourceCheck.errorMessage || 'source file missing',
        storagePath: sourceCheck.storagePath,
        resolvedPath: sourceCheck.resolvedPath,
        fixedStaleJobId: Number(existingJob.id),
      };
    }
    return {
      ok: true,
      reportId,
      versionId: Number(versionId),
      jobId: Number(existingJob.id),
      status: existingJob.status,
      reused: true,
    };
  }

  if (!forceParse && hasParsedContent(versionRow.parsed_json)) {
    const hasFacts = await hasAnyFactsForVersion(reportId, Number(versionId));
    if (!hasFacts) {
      const materializeJob = await ensureMaterializeJob(
        reportId,
        Number(versionId),
        versionRow.ingestion_batch_id ?? null
      );
      return {
        ok: true,
        reportId,
        versionId: Number(versionId),
        jobId: materializeJob.jobId,
        status: materializeJob.status,
        reused: materializeJob.reused,
        reason: 'parsed_missing_facts_materialize',
      };
    }

    const latestParseJobRes = await pool.query(
      `SELECT id, status
       FROM jobs
       WHERE report_id = $1
         AND version_id = $2
         AND kind = 'parse'
       ORDER BY id DESC
       LIMIT 1`,
      [reportId, versionId]
    );
    const latestParseJob = latestParseJobRes.rows?.[0];
    if (latestParseJob?.id) {
      return {
        ok: true,
        reportId,
        versionId: Number(versionId),
        jobId: Number(latestParseJob.id),
        status: latestParseJob.status,
        reused: true,
        reason: 'already_parsed',
      };
    }
  }

  if (!sourceCheck.ok) {
    return {
      ok: false,
      statusCode: 422,
      error: 'SOURCE_FILE_MISSING',
      message: sourceCheck.errorMessage || 'source file missing',
      storagePath: sourceCheck.storagePath,
      resolvedPath: sourceCheck.resolvedPath,
    };
  }

  const parseMaxRetries = resolveParseMaxRetries();
  const jobRes = await pool.query(
    `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, max_retries, ingestion_batch_id)
     VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $6, $5)
     RETURNING id`,
    [reportId, versionId, versionRow.provider ?? null, versionRow.model ?? null, versionRow.ingestion_batch_id ?? null, parseMaxRetries]
  );
  const jobId = jobRes.rows[0]?.id;

  return {
    ok: true,
    reportId,
    versionId: Number(versionId),
    jobId: Number(jobId),
    status: 'queued',
    reused: false,
  };
}
