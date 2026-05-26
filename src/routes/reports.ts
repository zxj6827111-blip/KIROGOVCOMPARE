import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_TMP_DIR } from '../config/constants';
import { reportUploadService } from '../services/ReportUploadService';
import { consistencyCheckService } from '../services/ConsistencyCheckService';
import { materializeService } from '../services/data-center/MaterializeService';
import { govInsightStatsService } from '../services/GovInsightStatsService';
import { llmJobRunner } from '../services/LlmJobRunner';
import { parseRunService } from '../services/ParseRunService';
import PdfParseService from '../services/PdfParseService';
import HtmlParseService from '../services/HtmlParseService';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { checkStoragePathExists } from '../services/SourceFileGuardService';
import { hasParsedContent } from '../utils/parsedContent';
import { getReportContentQuality } from '../utils/reportMaintenance';
import { collectReportSectionTitleIssues } from '../utils/sectionTitleQuality';

const router = express.Router();

const tempDir = UPLOADS_TMP_DIR;
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const DEFAULT_REPORT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const configuredReportUploadMaxBytes = Number(process.env.REPORT_UPLOAD_MAX_BYTES);
const REPORT_UPLOAD_MAX_BYTES =
  Number.isFinite(configuredReportUploadMaxBytes) && configuredReportUploadMaxBytes > 0
    ? configuredReportUploadMaxBytes
    : DEFAULT_REPORT_UPLOAD_MAX_BYTES;

const countDynamicSectionTitleIssues = (parsedJson: any, persistedSectionTitleIssueCount = 0): number => {
  const count = collectReportSectionTitleIssues(parsedJson?.sections || []).length;
  if (count === 0) return 0;
  return persistedSectionTitleIssueCount > 0 ? 0 : count;
};

function sanitizeUploadFileName(originalName: string): string {
  const baseName = path.basename(originalName || 'report');
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'report';
}

// Helper to safely parse JSON from DB (Postgres driver usually returns object for JSON columns, but handle strings too)
function parseDbJson(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

let rawTextColumnExistsCache: boolean | null = null;

async function hasRawTextColumn(): Promise<boolean> {
  if (rawTextColumnExistsCache !== null) {
    return rawTextColumnExistsCache;
  }
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'report_versions' AND column_name = 'raw_text'
  `);
  rawTextColumnExistsCache = result.rows.length > 0;
  return rawTextColumnExistsCache;
}

async function hasAnyFactsForVersion(reportId: number, versionId: number): Promise<boolean> {
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

async function resolvePreferredVersionId(reportId: number): Promise<number | null> {
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

async function loadReportVersion(reportId: number, versionId: number) {
  const result = await pool.query(
    `SELECT *
     FROM report_versions
     WHERE report_id = $1
       AND id = $2
     LIMIT 1`,
    [reportId, versionId]
  );
  return result.rows[0] || null;
}

async function authorizeReportAccess(req: AuthRequest, reportId: number) {
  const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
  if (allowedRegionIds && allowedRegionIds.length === 0) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  const reportRes = await pool.query(
    `SELECT id, region_id, active_version_id
     FROM reports
     WHERE id = $1
     LIMIT 1`,
    [reportId]
  );
  const report = reportRes.rows[0];
  if (!report) {
    return { ok: false as const, status: 404, error: 'report not found' };
  }

  if (allowedRegionIds && !allowedRegionIds.includes(Number(report.region_id))) {
    return { ok: false as const, status: 403, error: 'forbidden' };
  }

  return { ok: true as const, report };
}

async function countOpenReviewIssues(versionId: number): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM report_consistency_items
     WHERE report_version_id = $1
       AND auto_status IN ('FAIL', 'UNCERTAIN')
       AND COALESCE(human_status, 'pending') = 'pending'`,
    [versionId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function hasConsistencyRun(versionId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM report_consistency_runs
     WHERE report_version_id = $1
     LIMIT 1`,
    [versionId]
  );
  return result.rows.length > 0;
}

function mapVersionRow(row: any) {
  if (!row) {
    return null;
  }

  const parsedJson = parseDbJson(row.parsed_json);

  return {
    version_id: Number(row.id),
    file_name: row.file_name,
    file_hash: row.file_hash,
    storage_path: row.storage_path,
    text_path: row.text_path,
    parsed_json: parsedJson,
    content_quality: getReportContentQuality({
      report_id: row.report_id,
      region_id: row.region_id ?? '',
      year: row.year ?? '',
      effective_version_id: row.id,
      parsed_json: parsedJson,
      raw_text: typeof row.raw_text === 'string' ? row.raw_text : null,
    }),
    provider: row.provider,
    model: row.model,
    prompt_version: row.prompt_version,
    schema_version: row.schema_version,
    state: row.state,
    review_status: row.review_status || 'published',
    approved_at: row.approved_at || null,
    approved_by: row.approved_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_active: Boolean(row.is_active),
    version_type: row.version_type || null,
    parent_version_id: row.parent_version_id || null,
    open_issue_count: Number(row.open_issue_count || 0),
  };
}

type PublishVersionResult =
  | {
    ok: true;
    warnings?: string[];
  }
  | {
    ok: false;
    status: number;
    error: string;
    open_issue_count?: number;
  };

async function runPostPublishSideEffects(reportId: number, versionId: number): Promise<string[]> {
  const warnings: string[] = [];
  const [statsRefreshResult, autoComparisonResult] = await Promise.allSettled([
    govInsightStatsService.refreshAnnualStats({
      reason: 'manual',
      reportId,
      versionId,
    }),
    llmJobRunner.triggerAutoComparisonForPublishedVersion(versionId, reportId),
  ]);

  if (statsRefreshResult.status === 'rejected') {
    warnings.push('stats_refresh_failed');
    console.warn(`[Publish] Failed to refresh annual stats for report ${reportId}, version ${versionId}:`, statsRefreshResult.reason);
  } else if (!statsRefreshResult.value) {
    warnings.push('stats_refresh_failed');
    console.warn(`[Publish] Annual stats refresh returned false for report ${reportId}, version ${versionId}.`);
  }

  if (autoComparisonResult.status === 'rejected') {
    warnings.push('auto_comparison_failed');
    console.warn(`[Publish] Failed to trigger auto comparison for report ${reportId}, version ${versionId}:`, autoComparisonResult.reason);
  }

  return warnings;
}

async function publishVersionForReport(
  reportId: number,
  versionId: number,
  approvedBy?: number | null
): Promise<PublishVersionResult> {
  const version = await loadReportVersion(reportId, versionId);
  if (!version) {
    return { ok: false, status: 404, error: 'version not found' };
  }

  const checksRun = await hasConsistencyRun(versionId);
  if (!checksRun) {
    return { ok: false, status: 409, error: 'checks_not_run' };
  }

  const openIssueCount = await countOpenReviewIssues(versionId);
  if (openIssueCount > 0) {
    return {
      ok: false,
      status: 409,
      error: 'open_review_issues',
      open_issue_count: openIssueCount,
    };
  }

  let hasFacts = await hasAnyFactsForVersion(reportId, versionId);
  if (!hasFacts) {
    const materializeResult = await materializeService.materializeVersion(versionId);
    hasFacts = materializeResult.success && (materializeResult.factsCreated ?? 0) > 0;
  }
  if (!hasFacts) {
    return { ok: false, status: 409, error: 'materialized_facts_missing' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE report_versions
       SET is_active = false,
           updated_at = NOW()
       WHERE report_id = $1`,
      [reportId]
    );

    await client.query(
      `UPDATE report_versions
       SET review_status = 'history',
           updated_at = NOW()
       WHERE report_id = $1
         AND id != $2
         AND review_status IN ('published', 'pending_review')`,
      [reportId, versionId]
    );

    await client.query(
      `UPDATE report_versions
       SET is_active = true,
           review_status = 'published',
           state = 'published',
           approved_at = NOW(),
           approved_by = $3,
           updated_at = NOW()
       WHERE report_id = $1
         AND id = $2`,
      [reportId, versionId, approvedBy ?? null]
    );

    await client.query(
      `UPDATE reports
       SET active_version_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [versionId, reportId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const warnings = await runPostPublishSideEffects(reportId, versionId);

  return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}

async function ensureMaterializeJob(
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

type ParseJobSubmitResult =
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
    storagePath?: string | null;
    resolvedPath?: string | null;
    fixedStaleJobId?: number;
  };

async function enqueueReportParseJob(input: {
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
  const report = reportRes.rows[0];
  if (!report) {
    return { ok: false, statusCode: 404, error: 'report not found' };
  }

  if (allowedRegionIds && !allowedRegionIds.includes(Number(report.region_id))) {
    return { ok: false, statusCode: 403, error: 'forbidden' };
  }

  let versionId = report.active_version_id as number | null;
  if (requestedVersionId && Number.isInteger(requestedVersionId) && requestedVersionId > 0) {
    const explicitVersion = await loadReportVersion(reportId, requestedVersionId);
    if (!explicitVersion) {
      return { ok: false, statusCode: 404, error: 'target version not found' };
    }
    versionId = requestedVersionId;
  } else {
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
    `SELECT provider, model, ingestion_batch_id, parsed_json, storage_path
     FROM report_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId]
  );
  const versionRow = versionRes.rows?.[0];
  if (!versionRow) {
    return { ok: false, statusCode: 404, error: 'report_version not found' };
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

  const jobRes = await pool.query(
    `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
     VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5)
     RETURNING id`,
    [reportId, versionId, versionRow.provider ?? null, versionRow.model ?? null, versionRow.ingestion_batch_id ?? null]
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

async function rebuildSourceTextFromStorage(storagePath: string, reportId: number): Promise<{ text: string; sourceType: string }> {
  let absolutePath = storagePath;
  if (!path.isAbsolute(absolutePath)) {
    absolutePath = path.join(PROJECT_ROOT, storagePath);
    if (!fs.existsSync(absolutePath)) {
      absolutePath = path.join(process.cwd(), storagePath);
    }
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`source_file_not_found:${absolutePath}`);
  }

  const lowerPath = absolutePath.toLowerCase();
  if (lowerPath.endsWith('.pdf')) {
    const parsed = await PdfParseService.parsePDFToMarkdown(absolutePath, String(reportId));
    if (!parsed.success || !parsed.markdown) {
      throw new Error(parsed.error || 'pdf_markdown_parse_failed');
    }
    return { text: parsed.markdown, sourceType: 'pdf_markdown' };
  }

  if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
    const parsed = await HtmlParseService.parseHtmlToMarkdown(absolutePath);
    if (!parsed.success || !parsed.extracted_text) {
      throw new Error(parsed.error || 'html_markdown_parse_failed');
    }
    return { text: parsed.extracted_text, sourceType: 'html_markdown' };
  }

  const text = await fsPromises.readFile(absolutePath, 'utf8');
  if (lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown')) {
    return { text, sourceType: 'markdown' };
  }
  if (lowerPath.endsWith('.txt')) {
    return { text, sourceType: 'text' };
  }
  if (lowerPath.endsWith('.json')) {
    return { text, sourceType: 'json' };
  }
  return { text, sourceType: 'text' };
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      // Truncate filename if too long to avoid ENAMETOOLONG error
      const MAX_NAME_BYTES = 100;
      let safeName = sanitizeUploadFileName(file.originalname);

      const byteLength = Buffer.byteLength(safeName, 'utf8');
      if (byteLength > MAX_NAME_BYTES) {
        const extMatch = safeName.match(/\.[^.]+$/);
        const ext = extMatch ? extMatch[0] : '';
        const nameWithoutExt = safeName.replace(/\.[^.]+$/, '');

        let truncated = '';
        let currentBytes = 0;
        const maxNamePartBytes = MAX_NAME_BYTES - Buffer.byteLength(ext, 'utf8');

        for (const char of nameWithoutExt) {
          const charBytes = Buffer.byteLength(char, 'utf8');
          if (currentBytes + charBytes > maxNamePartBytes) break;
          truncated += char;
          currentBytes += charBytes;
        }

        safeName = truncated + ext;
        console.log(`[Upload] Truncated filename from ${byteLength} to ${Buffer.byteLength(safeName, 'utf8')} bytes`);
      }

      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    const isHtml = file.mimetype === 'text/html' || file.originalname.toLowerCase().endsWith('.html') || file.originalname.toLowerCase().endsWith('.htm');
    const isTxt = file.mimetype === 'text/plain' || file.originalname.toLowerCase().endsWith('.txt');
    const isMd = file.mimetype === 'text/markdown' || file.mimetype === 'text/x-markdown' || file.originalname.toLowerCase().endsWith('.md') || file.originalname.toLowerCase().endsWith('.markdown');

    if (isPdf || isHtml || isTxt || isMd) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF、HTML、TXT 或 Markdown 文件'));
    }
  },
  limits: {
    fileSize: REPORT_UPLOAD_MAX_BYTES,
    files: 1,
  },
});

const handleReportUpload: express.RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'invalid_upload',
        maxBytes: REPORT_UPLOAD_MAX_BYTES,
      });
    }
    if (error) {
      return res.status(400).json({ error: error.message || 'invalid_upload' });
    }
    next();
  });
};

// Protect upload route
router.post('/reports', authMiddleware, requirePermission('upload_reports'), handleReportUpload, async (req: AuthRequest, res) => {
  const tmpFilePath = req.file?.path;
  try {
    const regionId = Number(req.body.region_id);
    const year = Number(req.body.year);
    const unitNameRaw = req.body.unit_name ?? req.body.unitName;
    const unitName = typeof unitNameRaw === 'string' && unitNameRaw.trim() ? unitNameRaw.trim() : null;
    const file = req.file;
    const model = req.body.model;
    const batchUuid = req.body.batch_uuid ?? req.body.batch_id;

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(regionId)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    if (!year || Number.isNaN(year) || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'year 无效' });
    }

    if (!file) {
      return res.status(400).json({ error: 'file 不能为空' });
    }

    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    const isHtml = file.mimetype === 'text/html' || file.originalname.toLowerCase().endsWith('.html') || file.originalname.toLowerCase().endsWith('.htm');
    const isTxt = file.mimetype === 'text/plain' || file.originalname.toLowerCase().endsWith('.txt');
    const isMd = file.mimetype === 'text/markdown' || file.mimetype === 'text/x-markdown' || file.originalname.toLowerCase().endsWith('.md') || file.originalname.toLowerCase().endsWith('.markdown');

    if (!isPdf && !isHtml && !isTxt && !isMd) {
      return res.status(400).json({ error: '仅支持 PDF、HTML、TXT 或 Markdown 文件' });
    }

    // Fix for garbled filenames
    const fixUtf8 = (str: string) => {
      try {
        const fixed = Buffer.from(str, 'latin1').toString('utf8');
        if (fixed.length < str.length && /[^\u0000-\u00ff]/.test(fixed)) {
          return fixed;
        }
        return str;
      } catch (e) {
        return str;
      }
    };

    const originalName = fixUtf8(file.originalname);

    const result = await reportUploadService.processUpload({
      regionId,
      year,
      unitName,
      tempFilePath: file.path,
      originalName,
      mimeType: file.mimetype,
      size: file.size,
      model,
      batchUuid,
    });

    const statusCode = 201;
    return res.status(statusCode).json({
      report_id: result.reportId,
      version_id: result.versionId,
      job_id: result.jobId,
      file_hash: result.fileHash,
      storage_path: result.storagePath,
      reused_version: result.reusedVersion,
      reused_job: result.reusedJob,
    });
  } catch (error: any) {
    if (error?.message === 'region_not_found') {
      return res.status(404).json({ error: 'region not found' });
    }
    if (error?.message === 'version_not_created') {
      return res.status(500).json({ error: 'report version 创建失败' });
    }

    if (typeof error?.message === 'string' && error.message.includes('unique constraint')) {
      return res.status(409).json({ error: 'record already exists' });
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: `上传错误: ${error.message}` });
    }

    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (tmpFilePath) {
      await fsPromises.unlink(tmpFilePath).catch(() => undefined);
    }
  }
});

// Re-run parse for an existing report (enqueue a parse job)
router.post('/reports/:id/parse', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const forceRaw = req.query.force;
    const versionIdRaw = req.body?.version_id ?? req.query.version_id;
    const requestedVersionId = versionIdRaw !== undefined ? Number(versionIdRaw) : null;
    const forceParse = typeof forceRaw === 'string'
      ? ['1', 'true', 'yes', 'on'].includes(forceRaw.trim().toLowerCase())
      : false;

    const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
    const result = await enqueueReportParseJob({
      reportId,
      allowedRegionIds,
      requestedVersionId,
      forceParse,
    });

    if (!result.ok) {
      const payload: Record<string, unknown> = {
        error: result.error,
      };
      if (result.message) payload.message = result.message;
      if (result.storagePath !== undefined) payload.storage_path = result.storagePath;
      if (result.resolvedPath !== undefined) payload.resolved_path = result.resolvedPath;
      if (result.fixedStaleJobId !== undefined) payload.fixed_stale_job_id = result.fixedStaleJobId;
      return res.status(result.statusCode).json(payload);
    }

    return res.json({
      job_id: result.jobId,
      status: result.status,
      reused: result.reused,
      reason: result.reason,
    });
  } catch (error) {
    console.error('Error re-parsing report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/batch-parse', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportIdsRaw = req.body?.report_ids;
    if (!Array.isArray(reportIdsRaw) || reportIdsRaw.length === 0) {
      return res.status(400).json({ error: 'report_ids is required' });
    }

    const reportIds = Array.from(
      new Set(
        reportIdsRaw
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      )
    );
    if (reportIds.length === 0) {
      return res.status(400).json({ error: 'report_ids is invalid' });
    }
    if (reportIds.length > 200) {
      return res.status(400).json({ error: 'report_ids exceeds limit', limit: 200 });
    }

    const forceParse = req.body?.force === true || req.body?.force === 'true' || req.body?.force === 1 || req.body?.force === '1';
    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    const results = [];

    for (const reportId of reportIds) {
      try {
        const result = await enqueueReportParseJob({
          reportId,
          allowedRegionIds,
          forceParse,
        });

        if (result.ok) {
          results.push({
            report_id: result.reportId,
            version_id: result.versionId,
            job_id: result.jobId,
            status: result.status,
            reused: result.reused,
            reason: result.reason,
          });
        } else {
          results.push({
            report_id: reportId,
            status: 'failed',
            error: result.error,
            message: result.message,
          });
        }
      } catch (error: any) {
        results.push({
          report_id: reportId,
          status: 'failed',
          error: 'internal_server_error',
          message: error?.message || 'parse enqueue failed',
        });
      }
    }

    const submitted = results.filter((item: any) => item.job_id && !item.reused).length;
    const reused = results.filter((item: any) => item.job_id && item.reused).length;
    const failed = results.filter((item: any) => !item.job_id).length;

    return res.json({
      requested: reportIds.length,
      submitted,
      reused,
      failed,
      results,
    });
  } catch (error) {
    console.error('Error batch re-parsing reports:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/:id/parse-history', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionIdRaw = req.query.version_id;
    const requestedVersionId = versionIdRaw !== undefined ? Number(versionIdRaw) : null;
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    const auth = await authorizeReportAccess(req, reportId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const params: any[] = [reportId];
    let versionFilter = '';
    if (requestedVersionId && Number.isInteger(requestedVersionId) && requestedVersionId > 0) {
      const version = await loadReportVersion(reportId, requestedVersionId);
      if (!version) {
        return res.status(404).json({ error: 'target version not found' });
      }
      params.push(requestedVersionId);
      versionFilter = `AND rv.id = $${params.length}`;
    }

    const history = await pool.query(
      `SELECT
         pr.id,
         pr.report_version_id,
         pr.job_id,
         pr.fingerprint,
         pr.provider,
         pr.model,
         pr.prompt_version,
         pr.parser_version,
         pr.source_extractor_version,
         pr.schema_version,
         pr.stabilize_mode,
         pr.rule_gate_enabled,
         pr.source_gate_strategy,
         pr.source_gate_uncertain_threshold,
         pr.source_gate_high_confidence_blocking,
         pr.source_gate_warning_threshold,
         pr.status,
         pr.intended_final_status,
         pr.is_current,
         pr.superseded_by,
         pr.superseded_at,
         pr.restored_from,
         pr.restored_at,
         pr.error_code,
         pr.error_message,
         pr.attempt,
         pr.created_at,
         pr.started_at,
         pr.finished_at,
         pr.accepted_at,
         pr.gate_result_json,
         sgr.status AS source_gate_status,
         sgr.uncertain_count AS source_gate_uncertain_count,
         sgr.warning_count AS source_gate_warning_count,
         sgr.blocker_count AS source_gate_blocker_count
       FROM report_versions rv
       JOIN parse_runs pr ON pr.report_version_id = rv.id
       LEFT JOIN LATERAL (
         SELECT status, uncertain_count, warning_count, blocker_count
         FROM source_gate_results
         WHERE parse_run_id = pr.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) sgr ON TRUE
       WHERE rv.report_id = $1
         ${versionFilter}
       ORDER BY pr.created_at DESC, pr.id DESC`,
      params
    );

    return res.json({ report_id: reportId, parse_runs: history.rows });
  } catch (error) {
    console.error('Error loading parse history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/switch-current-parse', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionId = Number(req.body?.version_id);
    const parseRunId = Number(req.body?.parse_run_id);
    if (!reportId || !versionId || !parseRunId) {
      return res.status(400).json({ error: 'report_id/version_id/parse_run_id 无效' });
    }

    const auth = await authorizeReportAccess(req, reportId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }
    const version = await loadReportVersion(reportId, versionId);
    if (!version) {
      return res.status(404).json({ error: 'target version not found' });
    }

    await parseRunService.switchCurrentParseRun(versionId, parseRunId);
    return res.json({ ok: true, report_id: reportId, version_id: versionId, parse_run_id: parseRunId });
  } catch (error: any) {
    console.error('Error switching current parse:', error);
    const message = String(error?.message || '');
    if (message.includes('parse_run')) {
      return res.status(409).json({ error: message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/restore-superseded-parse', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionId = Number(req.body?.version_id);
    const parseRunId = Number(req.body?.parse_run_id);
    if (!reportId || !versionId || !parseRunId) {
      return res.status(400).json({ error: 'report_id/version_id/parse_run_id 无效' });
    }

    const auth = await authorizeReportAccess(req, reportId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }
    const version = await loadReportVersion(reportId, versionId);
    if (!version) {
      return res.status(404).json({ error: 'target version not found' });
    }

    await parseRunService.restoreSupersededParseRun(versionId, parseRunId);
    return res.json({ ok: true, report_id: reportId, version_id: versionId, parse_run_id: parseRunId });
  } catch (error: any) {
    console.error('Error restoring superseded parse:', error);
    const message = String(error?.message || '');
    if (message.includes('parse_run')) {
      return res.status(409).json({ error: message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/retry-finalize', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const parseRunId = Number(req.body?.parse_run_id);
    if (!reportId || !parseRunId) {
      return res.status(400).json({ error: 'report_id/parse_run_id 无效' });
    }

    const auth = await authorizeReportAccess(req, reportId);
    if (!auth.ok) {
      return res.status(auth.status).json({ error: auth.error });
    }

    const ownership = await pool.query(
      `SELECT pr.report_version_id
       FROM parse_runs pr
       JOIN report_versions rv ON rv.id = pr.report_version_id
       WHERE pr.id = $1
         AND rv.report_id = $2
       LIMIT 1`,
      [parseRunId, reportId]
    );
    if (!ownership.rows[0]) {
      return res.status(404).json({ error: 'parse_run not found' });
    }

    await parseRunService.retryFinalizeParseRun(parseRunId);
    return res.json({ ok: true, report_id: reportId, parse_run_id: parseRunId });
  } catch (error: any) {
    console.error('Error retrying finalize:', error);
    const message = String(error?.message || '');
    if (message.includes('parse_run') || message.includes('final_status')) {
      return res.status(409).json({ error: message });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/text', authMiddleware, requirePermission('upload_reports'), express.json({ limit: '10mb' }), async (req: AuthRequest, res) => {
  try {
    const regionId = Number(req.body?.region_id);
    const year = Number(req.body?.year);
    const unitNameRaw = req.body?.unit_name ?? req.body?.unitName;
    const rawTextRaw = req.body?.raw_text ?? req.body?.rawText;
    const batchUuid = req.body?.batch_uuid ?? req.body?.batch_id;

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    if (!year || Number.isNaN(year) || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'year 无效' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(regionId)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const rawText = typeof rawTextRaw === 'string' ? rawTextRaw : '';
    if (!rawText.trim()) {
      return res.status(400).json({ error: 'raw_text 不能为空' });
    }

    const unitName = typeof unitNameRaw === 'string' && unitNameRaw.trim() ? unitNameRaw.trim() : null;

    const result = await reportUploadService.processTextUpload({
      regionId,
      year,
      unitName,
      rawText,
      model: req.body.model,
      batchUuid,
    });

    const statusCode = result.reusedVersion ? 409 : 201;
    return res.status(statusCode).json({
      report_id: result.reportId,
      version_id: result.versionId,
      job_id: result.jobId,
      file_hash: result.fileHash,
      storage_path: result.storagePath,
      reused_version: result.reusedVersion,
      reused_job: result.reusedJob,
    });
  } catch (error: any) {
    if (error?.message === 'region_not_found') {
      return res.status(404).json({ error: 'region not found' });
    }
    if (error?.message === 'raw_text_empty') {
      return res.status(400).json({ error: 'raw_text 不能为空' });
    }
    if (error?.message === 'version_not_created') {
      return res.status(500).json({ error: 'report version 创建失败' });
    }

    console.error('Text upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/reports/:id/parsed-data', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  const crypto = require('crypto');

  try {
    const reportId = Number(req.params.id);
    const { parsed_json } = req.body;
    const requestedVersionId = req.body?.version_id ? Number(req.body.version_id) : null;

    if (!reportId || isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    if (!parsed_json || typeof parsed_json !== 'object') {
      return res.status(400).json({ error: 'Invalid parsed_json format' });
    }

    // 0. Region scope check
    const reportRes = await pool.query(`SELECT region_id FROM reports WHERE id = $1`, [reportId]);
    if (reportRes.rows.length === 0) {
      return res.status(404).json({ error: 'Report not found' });
    }
    const reportRegionId = reportRes.rows[0].region_id;

    // Check user's dataScope
    const user = req.user;
    if (user?.dataScope?.regions && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const allowedIds = await getAllowedRegionIdsAsync(user);
      if (allowedIds && !allowedIds.includes(reportRegionId)) {
        return res.status(403).json({ error: 'Access denied: report region not in your data scope' });
      }
    }

    const baseVersionId =
      requestedVersionId && Number.isInteger(requestedVersionId) && requestedVersionId > 0
        ? requestedVersionId
        : await resolvePreferredVersionId(reportId);
    if (!baseVersionId) {
      return res.status(404).json({ error: 'No editable version found for this report' });
    }

    const active = await loadReportVersion(reportId, baseVersionId);
    if (!active) {
      return res.status(404).json({ error: 'Base version not found for this report' });
    }

    const oldVersionId = Number(active.id);
    // PostgreSQL text/jsonb cannot store NUL bytes; strip them defensively.
    const jsonStr = JSON.stringify(parsed_json).replace(/\u0000/g, '');

    // 2. Calculate idempotent file_hash
    const editHash = crypto.createHash('sha256').update(jsonStr, 'utf8').digest('hex');
    const newFileHash = crypto.createHash('sha256')
      .update(`${active.file_hash || ''}:manual_edit:${editHash}`, 'utf8')
      .digest('hex');

    // 3. Check if version with this hash already exists
    const existingVersionRes = await pool.query(`
       SELECT id FROM report_versions 
       WHERE report_id = $1 AND file_hash = $2
    `, [reportId, newFileHash]);

    let newVersionId: number | null = null;
    let reused = false;

    if (existingVersionRes.rows.length > 0) {
      // Reuse existing version
      newVersionId = Number(existingVersionRes.rows[0].id);
      reused = true;
      console.log(`[ParsedData] Reused existing version ${newVersionId} for report ${reportId}`);
    } else {
      // Create new version
      const baseFileName = active.file_name || 'report';
      const newFileName = baseFileName.includes('(手工修订)')
        ? baseFileName
        : `${baseFileName.substring(0, 100)} (手工修订)`;

      const insertVersion = async (
        parentVersionId: number | null,
        ingestionBatchId: number | null
      ) => pool.query(
        `INSERT INTO report_versions 
           (report_id, file_name, file_hash, file_size, storage_path, text_path, raw_text,
            provider, model, prompt_version, schema_version, parsed_json, is_active, created_at, updated_at,
            version_type, parent_version_id, state, review_status, ingestion_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), 'manual_correct', $14, 'pending_review', 'pending_review', $15)
           RETURNING id`,
        [
          reportId,
          newFileName,
          newFileHash,
          active.file_size || 0,
          active.storage_path || '',
          active.text_path || '',
          active.raw_text || '',
          active.provider || 'manual',
          active.model || 'manual',
          'manual_edit',
          active.schema_version || 'v1',
          jsonStr,
          false,
          parentVersionId,
          ingestionBatchId
        ]
      );

      let insertRes: any = null;
      try {
        insertRes = await insertVersion(
          Number(oldVersionId),
          active.ingestion_batch_id === null || active.ingestion_batch_id === undefined
            ? null
            : Number(active.ingestion_batch_id)
        );
      } catch (insertError: any) {
        const isForeignKeyViolation = insertError?.code === '23503';
        const constraint = String(insertError?.constraint || '');

        if (isForeignKeyViolation) {
          const parentFallback = constraint.includes('parent_version_id');
          const batchFallback = constraint.includes('ingestion_batch_id');

          console.warn(
            `[ParsedData] FK violation on manual version insert (constraint=${constraint}). ` +
            `Retrying with parent_version_id=${parentFallback ? 'NULL' : oldVersionId}, ` +
            `ingestion_batch_id=${batchFallback ? 'NULL' : (active.ingestion_batch_id ?? null)}`
          );

          insertRes = await insertVersion(
            parentFallback ? null : Number(oldVersionId),
            batchFallback ? null : (
              active.ingestion_batch_id === null || active.ingestion_batch_id === undefined
                ? null
                : Number(active.ingestion_batch_id)
            )
          );
        } else if (insertError?.code === '23505') {
          // Concurrent insert of same hash: fallback to reuse.
          const concurrentExistingRes = await pool.query(
            `SELECT id FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1`,
            [reportId, newFileHash]
          );
          if (concurrentExistingRes.rows.length > 0) {
            newVersionId = Number(concurrentExistingRes.rows[0].id);
            reused = true;
            console.warn(`[ParsedData] Detected concurrent insert, reusing version ${newVersionId}`);
          } else {
            throw insertError;
          }
        } else {
          throw insertError;
        }
      }

      if (!reused) {
        if (!insertRes?.rows?.[0]?.id) {
          throw new Error('manual_version_insert_failed');
        }
        newVersionId = Number(insertRes.rows[0].id);
        console.log(`[ParsedData] Created new version ${newVersionId} for report ${reportId} (old: ${oldVersionId})`);
      }
    }

    if (!newVersionId || Number.isNaN(Number(newVersionId))) {
      throw new Error('manual_version_resolve_failed');
    }

    let resolvedReviewStatus = 'pending_review';
    if (reused) {
      const reusedVersion = await loadReportVersion(reportId, Number(newVersionId));
      resolvedReviewStatus = reusedVersion?.review_status || 'pending_review';
    }

    const materializeResult = await materializeService.materializeVersion(newVersionId);
    if (!materializeResult.success) {
      throw new Error(`manual_materialize_failed:${materializeResult.error || 'unknown'}`);
    }
    if ((materializeResult.factsCreated ?? 0) <= 0) {
      throw new Error('manual_materialize_empty_facts');
    }

    return res.json({
      success: true,
      old_version_id: oldVersionId,
      new_version_id: newVersionId,
      reused,
      review_status: resolvedReviewStatus,
      facts_created: materializeResult.factsCreated,
      cells_created: materializeResult.cellsCreated,
    });
  } catch (error: any) {
    console.error('Error updating parsed data:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return res.status(500).json({
      error: isProduction ? 'Internal server error' : `Internal server error: ${error?.message || 'unknown'}`,
      ...(isProduction ? {} : { code: error?.code, constraint: error?.constraint })
    });
  }
});

router.get('/reports', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { region_id, year, unit_name, dedupe } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    const dedupeByRegionYear = dedupe === undefined
      ? true
      : !['0', 'false', 'no', 'off'].includes(String(dedupe).trim().toLowerCase());

    if (region_id !== undefined) {
      const regionIdNum = Number(region_id);
      if (!region_id || Number.isNaN(regionIdNum) || !Number.isInteger(regionIdNum) || regionIdNum < 1) {
        return res.status(400).json({ error: 'region_id 无效' });
      }
      conditions.push(`r.region_id = $${paramIndex++}`);
      params.push(regionIdNum);
    }

    if (year !== undefined) {
      const yearNum = Number(year);
      if (!year || Number.isNaN(yearNum) || !Number.isInteger(yearNum)) {
        return res.status(400).json({ error: 'year 无效' });
      }
      conditions.push(`r.year = $${paramIndex++}`);
      params.push(yearNum);
    }

    if (unit_name !== undefined && String(unit_name).trim() !== '') {
      conditions.push(`r.unit_name = $${paramIndex++}`);
      params.push(String(unit_name).trim());
    }

    // [Data Scope Filtering]
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const idsQuery = `
            WITH RECURSIVE allowed_ids AS (
                SELECT id FROM regions WHERE name = ANY($1::text[])
                UNION ALL
                SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
            )
            SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(idsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((r: any) => r.id);

        if (allowedIds.length > 0) {
          conditions.push(`r.region_id = ANY($${paramIndex++}::int[])`);
          params.push(allowedIds);
        } else {
          conditions.push('1=0');
        }
      } catch (e) {
        console.error('Error calculating scope IDs:', e);
        conditions.push('1=0');
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const dedupeParamRef = `$${paramIndex++}`;
    params.push(dedupeByRegionYear);

    const query = `
      WITH ranked_reports AS (
        SELECT
          r.*,
          ROW_NUMBER() OVER (
            PARTITION BY r.region_id, r.year
            ORDER BY (r.active_version_id IS NOT NULL) DESC, r.updated_at DESC, r.id DESC
          ) AS rn
        FROM reports r
        ${whereClause}
      )
      SELECT
        r.id AS report_id,
        r.region_id,
        r.year,
        r.unit_name,
        rv.id AS active_version_id,
        CASE
          WHEN rv.parsed_json IS NULL THEN false
          WHEN rv.parsed_json::text IN ('{}', 'null', '\"\"') THEN false
          ELSE true
        END AS has_content_db,
        (SELECT j.id FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_id,
        (SELECT j.status FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_status,
        (SELECT j.progress FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_progress,
        (SELECT j.error_code FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_code,
        (SELECT j.error_message FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_message
      FROM ranked_reports r
      LEFT JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE (${dedupeParamRef}::boolean = false OR r.rn = 1)
      ORDER BY r.id DESC;
    `;

    const result = await pool.query(query, params);

    return res.json({
      data: result.rows.map((row) => {
        // PostgreSQL may return boolean as: true/false, 't'/'f', 1/0, or 'true'/'false'
        const hasContentDb = row.has_content_db;
        let hasContent: boolean;
        if (hasContentDb === true || hasContentDb === 't' || hasContentDb === 1 || hasContentDb === 'true') {
          hasContent = true;
        } else {
          hasContent = false;
        }

        return {
          report_id: row.report_id,
          region_id: row.region_id,
          unit_name: row.unit_name,
          year: row.year,
          active_version_id: row.active_version_id || null,
          has_content: hasContent,
          latest_job: row.job_id
            ? {
              job_id: row.job_id,
              status: row.job_status,
              progress: row.job_progress,
              error_code: row.job_error_code,
              error_message: row.job_error_message,
            }
            : null,
        };
      }),
    });
  } catch (error) {
    console.error('Error listing reports:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

async function buildBatchCheckStatus(reportIds: number[], user: AuthRequest['user']) {
  let filteredIds = reportIds.filter((id) => Number.isFinite(id) && id > 0);
  if (filteredIds.length === 0) {
    return {};
  }

  const allowedRegionIds = await getAllowedRegionIdsAsync(user);
  if (allowedRegionIds) {
    if (allowedRegionIds.length === 0) {
      return {};
    }
    const allowedRes = await pool.query(`
        SELECT id FROM reports
        WHERE id = ANY($1::int[])
          AND region_id = ANY($2::int[]);
      `, [filteredIds, allowedRegionIds]);
    filteredIds = allowedRes.rows.map((row: any) => row.id);
    if (filteredIds.length === 0) {
      return {};
    }
  }

  // Keep the list-card status aligned with ReportDetail:
  // prefer the latest pending-review version, otherwise fall back to active_version_id.
  const versionRes = await pool.query(`
      SELECT
        r.id as report_id,
        COALESCE(pending_rv.id, active_rv.id) as version_id,
        COALESCE(pending_rv.review_status, active_rv.review_status) as review_status,

        CASE
          WHEN COALESCE(pending_rv.parsed_json, active_rv.parsed_json) IS NULL THEN false
          WHEN COALESCE(pending_rv.parsed_json, active_rv.parsed_json)::text IN ('{}', 'null', '\"\"') THEN false
          ELSE true
        END AS has_content_db,
        COALESCE(pending_rv.check_total, active_rv.check_total) as check_total,
        COALESCE(pending_rv.check_visual, active_rv.check_visual) as check_visual,
        COALESCE(pending_rv.check_structure, active_rv.check_structure) as check_structure,
        COALESCE(pending_rv.check_quality, active_rv.check_quality) as check_quality,
        COALESCE(pending_rv.checks_updated_at, active_rv.checks_updated_at) as checks_updated_at,
        COALESCE(pending_rv.parsed_json, active_rv.parsed_json) as parsed_json,
        COALESCE(section_title_issues.count, 0) as section_title_issue_count
      FROM reports r
      LEFT JOIN report_versions active_rv ON active_rv.id = r.active_version_id
      LEFT JOIN LATERAL (
        SELECT
          rv.id,
          rv.review_status,
          rv.parsed_json,
          rv.check_total,
          rv.check_visual,
          rv.check_structure,
          rv.check_quality,
          rv.checks_updated_at
        FROM report_versions rv
        WHERE rv.report_id = r.id
          AND rv.review_status = 'pending_review'
        ORDER BY rv.created_at DESC, rv.id DESC
        LIMIT 1
      ) pending_rv ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS count
        FROM report_consistency_items rci
        WHERE rci.report_version_id = COALESCE(pending_rv.id, active_rv.id)
          AND rci.group_key = 'quality'
          AND rci.check_key = 'section_title_misnumbered'
          AND rci.auto_status = 'FAIL'
          AND COALESCE(rci.human_status, 'pending') != 'dismissed'
      ) section_title_issues ON true
      WHERE r.id = ANY($1::int[])
    `, [filteredIds]);

  const versionRows = versionRes.rows;
  const versionMap = new Map(versionRows.map((v: any) => [v.report_id, v.version_id]));

  // Check which versions have actual content
  const contentMap = new Map<number, boolean>();
  for (const v of versionRows) {
    // PostgreSQL may return boolean as: true/false, 't'/'f', 1/0, or 'true'/'false'
    const hasContentDb = v.has_content_db;
    const reportIdNum = Number(v.report_id); // Ensure consistent key type for Map
    if (hasContentDb === true || hasContentDb === 't' || hasContentDb === 1 || hasContentDb === 'true') {
      contentMap.set(reportIdNum, true);
    } else {
      contentMap.set(reportIdNum, false);
    }
  }

  const exactCountsMap = new Map<number, any>();
  const allVersionIds = versionRows
    .map((row: any) => Number(row.version_id))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  if (allVersionIds.length > 0) {
    const exactCountsRes = await pool.query(`
      SELECT
        report_version_id,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS total,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND group_key IN ('table2','table3','table4','text','hierarchy')
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS consistency,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND group_key = 'visual'
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS visual,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND group_key = 'quality'
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS quality,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND group_key IN ('visual','structure','quality')
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS quality_review,
        COUNT(*) FILTER (
          WHERE auto_status = 'FAIL'
            AND group_key IN ('structure','table2','table3','table4','text','hierarchy')
            AND (human_status != 'dismissed' OR human_status IS NULL)
        ) AS structure
      FROM report_consistency_items
      WHERE report_version_id = ANY($1::int[])
      GROUP BY report_version_id
    `, [allVersionIds]);
    for (const row of exactCountsRes.rows || []) {
      exactCountsMap.set(Number(row.report_version_id), row);
    }
  }

  const result: Record<string, any> = {};

  const missingVersionIds: number[] = [];
  for (const row of versionRows) {
    const reportId = Number(row.report_id);
    const versionId = Number(row.version_id);
    const checked = Boolean(versionId) && !!row.checks_updated_at;
    const sectionTitleIssueCount = countDynamicSectionTitleIssues(row.parsed_json, Number(row.section_title_issue_count || 0));
    const exactCounts = exactCountsMap.get(versionId);
    const baseTotal = Number(exactCounts?.total ?? row.check_total ?? 0);
    const baseQuality = Number(exactCounts?.quality ?? row.check_quality ?? 0);
    const baseQualityReview = Number(
      exactCounts?.quality_review ?? (Number(row.check_visual || 0) + Number(row.check_quality || 0))
    );
    if (versionId && !checked) {
      missingVersionIds.push(versionId);
    }
    result[String(reportId)] = {
      has_content: contentMap.get(reportId) ?? false,
      version_id: Number.isFinite(versionId) && versionId > 0 ? versionId : null,
      review_status: row.review_status || null,
      checked: checked || sectionTitleIssueCount > 0,
      total: checked ? baseTotal + sectionTitleIssueCount : (sectionTitleIssueCount > 0 ? sectionTitleIssueCount : null),
      visual: checked ? Number(exactCounts?.visual ?? row.check_visual ?? 0) : null,
      structure: checked ? Number(exactCounts?.structure ?? row.check_structure ?? 0) : null,
      quality: checked ? baseQuality + sectionTitleIssueCount : (sectionTitleIssueCount > 0 ? sectionTitleIssueCount : null),
      consistency: checked ? Number(exactCounts?.consistency ?? row.check_structure ?? 0) : null,
      quality_review: checked ? baseQualityReview + sectionTitleIssueCount : (sectionTitleIssueCount > 0 ? sectionTitleIssueCount : null)
    };
  }

  // Backfill cached stats for versions that have checks but no cached counts yet
  if (missingVersionIds.length > 0) {
    const countsRes = await pool.query(`
      WITH counts AS (
        SELECT
          report_version_id,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS total,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND group_key IN ('table2','table3','table4','text','hierarchy')
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS consistency,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND group_key = 'visual'
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS visual,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND group_key = 'quality'
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS quality,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND group_key IN ('visual','structure','quality')
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS quality_review,
          COUNT(*) FILTER (
            WHERE auto_status = 'FAIL'
              AND group_key IN ('structure','table2','table3','table4','text','hierarchy')
              AND (human_status != 'dismissed' OR human_status IS NULL)
          ) AS structure
        FROM report_consistency_items
        WHERE report_version_id = ANY($1::int[])
        GROUP BY report_version_id
      )
      UPDATE report_versions rv
      SET check_total = counts.total,
          check_visual = counts.visual,
          check_structure = counts.structure,
          check_quality = counts.quality,
          checks_updated_at = NOW()
      FROM counts
      WHERE rv.id = counts.report_version_id
      RETURNING counts.*
    `, [missingVersionIds]);

    const countsMap = new Map<number, any>();
    for (const row of countsRes.rows || []) {
      countsMap.set(Number(row.report_version_id), row);
    }

    for (const row of versionRows) {
      const versionId = Number(row.version_id);
      const reportId = Number(row.report_id);
      if (!row.checks_updated_at && countsMap.has(versionId)) {
        const counts = countsMap.get(versionId);
        const total = Number(counts.total || 0);
        const consistency = Number(counts.consistency || 0);
        const visual = Number(counts.visual || 0);
        const structure = Number(counts.structure || 0);
        const quality = Number(counts.quality || 0);
        const qualityReview = Number(counts.quality_review || 0);
        const sectionTitleIssueCount = countDynamicSectionTitleIssues(row.parsed_json, Number(row.section_title_issue_count || 0));

        result[String(reportId)] = {
          has_content: contentMap.get(reportId) ?? false,
          version_id: Number.isFinite(versionId) && versionId > 0 ? versionId : null,
          review_status: row.review_status || null,
          checked: true,
          total: total + sectionTitleIssueCount,
          visual,
          structure,
          quality: quality + sectionTitleIssueCount,
          consistency,
          quality_review: qualityReview + sectionTitleIssueCount
        };
      }
    }
  }

  return result;
}

// Batch check status endpoint (GET for backward compatibility)
router.get('/reports/batch-check-status', authMiddleware, async (req, res) => {
  try {
    const reportIdsParam = req.query.report_ids;
    if (!reportIdsParam || typeof reportIdsParam !== 'string') {
      return res.status(400).json({ error: 'report_ids query parameter required' });
    }

    const reportIds = reportIdsParam.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
    const result = await buildBatchCheckStatus(reportIds, (req as AuthRequest).user);
    return res.json(result);
  } catch (error: any) {
    console.error('Error in batch-check-status:', error);
    return res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

// Batch check status endpoint (POST to avoid 414 URI too long)
router.post('/reports/batch-check-status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const reportIdsRaw = req.body?.report_ids;
    if (!Array.isArray(reportIdsRaw) || reportIdsRaw.length === 0) {
      return res.status(400).json({ error: 'report_ids is required' });
    }
    const reportIds = reportIdsRaw.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id) && id > 0);
    const result = await buildBatchCheckStatus(reportIds, req.user);
    return res.json(result);
  } catch (error: any) {
    console.error('Error in batch-check-status POST:', error);
    return res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

// Batch run consistency checks for reports
router.post('/reports/batch-checks/run', authMiddleware, async (req, res) => {
  try {
    const reportIdsRaw = req.body?.report_ids;
    if (!Array.isArray(reportIdsRaw) || reportIdsRaw.length === 0) {
      return res.status(400).json({ error: 'report_ids is required' });
    }

    let reportIds = reportIdsRaw.map((id: any) => Number(id)).filter((id: number) => !Number.isNaN(id) && id > 0);
    if (reportIds.length === 0) {
      return res.status(400).json({ error: 'report_ids is invalid' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0) {
        return res.json({ processed: 0, skipped: reportIds.length, failed: 0, results: [] });
      }
      const allowedRes = await pool.query(`
        SELECT id FROM reports
        WHERE id = ANY($1::int[])
          AND region_id = ANY($2::int[]);
      `, [reportIds, allowedRegionIds]);
      reportIds = allowedRes.rows.map((row: any) => row.id);
      if (reportIds.length === 0) {
        return res.json({ processed: 0, skipped: 0, failed: 0, results: [] });
      }
    }

    const versionRes = await pool.query(`
      SELECT r.id as report_id, rv.id as version_id, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.id = ANY($1::int[])
    `, [reportIds]);

    const versionRows = versionRes.rows || [];
    const foundIds = new Set(versionRows.map((row: any) => Number(row.report_id)));
    const results: Array<{ report_id: number; status: string; reason?: string }> = [];

    for (const row of versionRows) {
      const reportId = Number(row.report_id);
      const versionId = Number(row.version_id);
      const parsed = parseDbJson(row.parsed_json);
      if (!parsed) {
        results.push({ report_id: reportId, status: 'skipped', reason: 'no_parsed_json' });
        continue;
      }

      try {
        await consistencyCheckService.runAndPersist(versionId, parsed);
        results.push({ report_id: reportId, status: 'ok' });
      } catch (error: any) {
        results.push({ report_id: reportId, status: 'failed', reason: error?.message || 'run_failed' });
      }
    }

    for (const reportId of reportIds) {
      if (!foundIds.has(Number(reportId))) {
        results.push({ report_id: Number(reportId), status: 'skipped', reason: 'no_active_version' });
      }
    }

    const processed = results.filter(r => r.status === 'ok').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return res.json({ processed, skipped, failed, results });
  } catch (error: any) {
    console.error('Error in batch-checks/run:', error);
    return res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

router.get('/reports/:id/versions', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id invalid' });
    }

    const reportRes = await pool.query(`SELECT region_id FROM reports WHERE id = $1 LIMIT 1`, [reportId]);
    const report = reportRes.rows[0];
    if (!report) {
      return res.status(404).json({ error: 'report not found' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const versionsRes = await pool.query(
      `WITH issue_counts AS (
         SELECT
           report_version_id,
           COUNT(*) FILTER (
             WHERE auto_status IN ('FAIL', 'UNCERTAIN')
               AND COALESCE(human_status, 'pending') = 'pending'
           ) AS open_issue_count
         FROM report_consistency_items
         WHERE report_version_id IN (
           SELECT id FROM report_versions WHERE report_id = $1
         )
         GROUP BY report_version_id
       )
       SELECT
         rv.*,
         COALESCE(ic.open_issue_count, 0) AS open_issue_count
       FROM report_versions rv
       LEFT JOIN issue_counts ic ON ic.report_version_id = rv.id
       WHERE rv.report_id = $1
       ORDER BY rv.created_at DESC, rv.id DESC`,
      [reportId]
    );

    return res.json({
      data: versionsRes.rows.map((row: any) => ({
        id: Number(row.id),
        file_name: row.file_name,
        provider: row.provider,
        model: row.model,
        prompt_version: row.prompt_version,
        schema_version: row.schema_version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_active: Boolean(row.is_active),
        review_status: row.review_status || 'published',
        state: row.state || null,
        approved_at: row.approved_at || null,
        approved_by: row.approved_by || null,
        open_issue_count: Number(row.open_issue_count || 0),
      })),
    });
  } catch (error) {
    console.error('Error listing report versions:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/versions/:versionId/publish', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!reportId || !versionId || Number.isNaN(reportId) || Number.isNaN(versionId)) {
      return res.status(400).json({ error: 'invalid_report_or_version' });
    }

    const reportRes = await pool.query(`SELECT region_id FROM reports WHERE id = $1 LIMIT 1`, [reportId]);
    const report = reportRes.rows[0];
    if (!report) {
      return res.status(404).json({ error: 'report not found' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const publishResult = await publishVersionForReport(reportId, versionId, req.user?.id ?? null);
    if (!publishResult.ok) {
      return res.status(publishResult.status ?? 500).json({
        error: publishResult.error,
        open_issue_count: (publishResult as any).open_issue_count ?? undefined,
      });
    }

    return res.json({
      success: true,
      report_id: reportId,
      version_id: versionId,
      warnings: publishResult.warnings,
    });
  } catch (error) {
    console.error('Error publishing report version:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/versions/:versionId/activate', authMiddleware, requirePermission('upload_reports'), async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    const versionId = Number(req.params.versionId);
    if (!reportId || !versionId || Number.isNaN(reportId) || Number.isNaN(versionId)) {
      return res.status(400).json({ error: 'invalid_report_or_version' });
    }

    const reportRes = await pool.query(`SELECT region_id FROM reports WHERE id = $1 LIMIT 1`, [reportId]);
    const report = reportRes.rows[0];
    if (!report) {
      return res.status(404).json({ error: 'report not found' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const publishResult = await publishVersionForReport(reportId, versionId, req.user?.id ?? null);
    if (!publishResult.ok) {
      return res.status(publishResult.status ?? 500).json({
        error: publishResult.error,
        open_issue_count: (publishResult as any).open_issue_count ?? undefined,
      });
    }

    return res.json({
      success: true,
      report_id: reportId,
      version_id: versionId,
      warnings: publishResult.warnings,
    });
  } catch (error) {
    console.error('Error activating report version:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/:id/source-text', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    const requestedVersionId = typeof req.query.version_id === 'string'
      ? Number(req.query.version_id)
      : null;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const full = req.query.full === '1' || req.query.full === 'true';
    const limitRaw = req.query.limit;
    let requestedLimit: number | null = null;
    if (typeof limitRaw === 'string' && limitRaw.trim() !== '') {
      const parsedLimit = Number(limitRaw);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ error: 'limit invalid, must be a positive integer' });
      }
      requestedLimit = Math.min(Math.floor(parsedLimit), 2_000_000);
    }

    const rawColumnExists = await hasRawTextColumn();
    const sourceSql = rawColumnExists ? 'rv.raw_text' : 'NULL::text AS raw_text';
    const versionId =
      requestedVersionId && Number.isInteger(requestedVersionId) && requestedVersionId > 0
        ? requestedVersionId
        : await resolvePreferredVersionId(reportId);
    if (!versionId) {
      return res.status(404).json({ error: 'report_version not found' });
    }
    const detailRes = await pool.query(
      `SELECT
         r.id AS report_id,
         r.region_id,
         rv.id AS version_id,
         rv.storage_path,
         ${sourceSql}
       FROM reports r
       JOIN report_versions rv ON rv.report_id = r.id
       WHERE r.id = $1
         AND rv.id = $2
       LIMIT 1`,
      [reportId, versionId]
    );

    const row = detailRes.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'report not found' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(row.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    if (!row.version_id) {
      return res.status(404).json({ error: 'version not found' });
    }

    let sourceText = typeof row.raw_text === 'string' ? row.raw_text : '';
    let sourceType = sourceText ? 'db_raw_text' : 'none';

    if (refresh || !sourceText) {
      if (!row.storage_path) {
        return res.status(404).json({ error: 'source_file_path missing' });
      }

      const rebuilt = await rebuildSourceTextFromStorage(String(row.storage_path), reportId);
      sourceText = rebuilt.text;
      sourceType = rebuilt.sourceType;

      if (rawColumnExists) {
        await pool.query(
          `UPDATE report_versions
           SET raw_text = $1
           WHERE id = $2`,
          [sourceText, row.version_id]
        );
      }
    }

    if (!sourceText) {
      return res.status(404).json({ error: 'source_text missing' });
    }

    const totalLength = sourceText.length;
    const effectiveLimit = full ? totalLength : (requestedLimit ?? 4000);
    const content = full ? sourceText : sourceText.slice(0, effectiveLimit);
    const returnedLength = content.length;
    const truncated = returnedLength < totalLength;

    return res.json({
      report_id: reportId,
      version_id: row.version_id,
      source_type: sourceType,
      total_length: totalLength,
      returned_length: returnedLength,
      truncated,
      content,
    });
  } catch (error: any) {
    console.error('Error reading source text:', error);
    return res.status(500).json({ error: 'internal_server_error', message: error?.message || 'unknown_error' });
  }
});

router.get('/reports/:id', authMiddleware, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    const reportRes = await pool.query(`
      SELECT
        r.id AS report_id,
        r.region_id,
        reg.name AS region_name,
        r.year,
        r.unit_name
      FROM reports r
      LEFT JOIN regions reg ON reg.id = r.region_id
      WHERE r.id = $1
      LIMIT 1;
    `, [reportId]);
    const report = reportRes.rows[0];

    if (!report) {
      return res.status(404).json({ error: 'report not found' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const jobRes = await pool.query(`
      SELECT id, status, progress, error_code, error_message
      FROM jobs
      WHERE report_id = $1
      ORDER BY id DESC
      LIMIT 1;
    `, [reportId]);
    const job = jobRes.rows[0];

    const activeVersionRes = await pool.query(
      `WITH issue_counts AS (
         SELECT
           report_version_id,
           COUNT(*) FILTER (
             WHERE auto_status IN ('FAIL', 'UNCERTAIN')
               AND COALESCE(human_status, 'pending') = 'pending'
           ) AS open_issue_count
         FROM report_consistency_items
         WHERE report_version_id = (
           SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1
         )
         GROUP BY report_version_id
       )
       SELECT rv.*, COALESCE(ic.open_issue_count, 0) AS open_issue_count
       FROM report_versions rv
       LEFT JOIN issue_counts ic ON ic.report_version_id = rv.id
       WHERE rv.id = (
         SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1
       )
       LIMIT 1`,
      [reportId]
    );
    const pendingVersionRes = await pool.query(
      `WITH pending_version AS (
         SELECT *
         FROM report_versions
         WHERE report_id = $1
           AND review_status = 'pending_review'
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ),
       issue_counts AS (
         SELECT
           report_version_id,
           COUNT(*) FILTER (
             WHERE auto_status IN ('FAIL', 'UNCERTAIN')
               AND COALESCE(human_status, 'pending') = 'pending'
           ) AS open_issue_count
         FROM report_consistency_items
         WHERE report_version_id IN (SELECT id FROM pending_version)
         GROUP BY report_version_id
       )
       SELECT pv.*, COALESCE(ic.open_issue_count, 0) AS open_issue_count
       FROM pending_version pv
       LEFT JOIN issue_counts ic ON ic.report_version_id = pv.id`,
      [reportId]
    );

    return res.json({
      report_id: report.report_id,
      region_id: report.region_id,
      region_name: report.region_name,
      year: report.year,
      unit_name: report.unit_name,
      active_version: mapVersionRow(activeVersionRes.rows[0]),
      pending_review_version: mapVersionRow(pendingVersionRes.rows[0]),
      latest_job: job
        ? {
          job_id: job.id,
          status: job.status,
          progress: job.progress,
          error: job.error_message || job.error_code || null,
        }
        : null,
    });
  } catch (error) {
    console.error('Error fetching report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/reports/:id', authMiddleware, requirePermission('delete_reports'), async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    const reportRes = await pool.query(`SELECT region_id FROM reports WHERE id = $1`, [reportId]);
    if (reportRes.rows.length === 0) {
      return res.status(404).json({ error: 'report not found' });
    }
    const reportRegionId = reportRes.rows[0].region_id;

    const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(reportRegionId)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    // Manual Cascading Delete to handle missing DB constraints
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Get all version IDs to clean up version-specific non-cascading data (like cells)
      const verRes = await client.query('SELECT id FROM report_versions WHERE report_id = $1', [reportId]);
      const versionIds = verRes.rows.map(r => r.id);

      if (versionIds.length > 0) {
        // Delete cells (no cascade in schema)
        await client.query('DELETE FROM cells WHERE version_id = ANY($1::int[])', [versionIds]);
        // Delete notifications referencing these versions
        await client.query('DELETE FROM notifications WHERE related_version_id = ANY($1::int[])', [versionIds]);
      }

      // 2. Delete Comparisons (involving this report)
      // comparison_results cascades from comparisons, so just delete comparisons
      await client.query('DELETE FROM comparisons WHERE left_report_id = $1 OR right_report_id = $1', [reportId]);

      // 3. Delete Facts & Quality Issues (referencing report_id, no cascade)
      await client.query('DELETE FROM fact_active_disclosure WHERE report_id = $1', [reportId]);
      await client.query('DELETE FROM fact_application WHERE report_id = $1', [reportId]);
      await client.query('DELETE FROM fact_legal_proceeding WHERE report_id = $1', [reportId]);
      await client.query('DELETE FROM quality_issues WHERE report_id = $1', [reportId]);

      // 4. Delete Derived Metrics
      await client.query('DELETE FROM derived_unit_year_metrics WHERE report_id = $1', [reportId]);

      // 5. Delete Jobs (already has cascade usually, but safe to force)
      await client.query('DELETE FROM jobs WHERE report_id = $1', [reportId]);

      // 6. Delete Report (cascades to versions -> consistency runs, parses)
      await client.query('DELETE FROM reports WHERE id = $1', [reportId]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Error deleting report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
