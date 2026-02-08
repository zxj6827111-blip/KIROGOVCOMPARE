import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_TMP_DIR } from '../config/constants';
import { reportUploadService } from '../services/ReportUploadService';
import { consistencyCheckService } from '../services/ConsistencyCheckService';
import PdfParseService from '../services/PdfParseService';
import HtmlParseService from '../services/HtmlParseService';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();

const tempDir = UPLOADS_TMP_DIR;
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
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

function hasParsedContent(parsed: any): boolean {
  if (!parsed) return false;
  if (typeof parsed === 'string') return parsed.trim().length > 0;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed !== 'object') return false;
  if (Array.isArray(parsed.sections) && parsed.sections.length > 0) return true;
  if (parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0) return true;
  if (parsed.report_type || parsed.basic_info || parsed.year) return true;
  // Fallback: any non-empty object counts as content
  return Object.keys(parsed).length > 0;
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
      let safeName = file.originalname;

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
});

// Protect upload route
router.post('/reports', authMiddleware, requirePermission('upload_reports'), upload.single('file'), async (req: AuthRequest, res) => {
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
      return res.status(404).json({ error: 'region 不存在' });
    }
    if (error?.message === 'version_not_created') {
      return res.status(500).json({ error: 'report version 创建失败' });
    }

    if (typeof error?.message === 'string' && error.message.includes('unique constraint')) {
      return res.status(409).json({ error: '记录已存在' });
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
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    // Data scope check
    const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0) {
        return res.status(403).json({ error: 'forbidden' });
      }
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
      return res.status(404).json({ error: 'report 不存在' });
    }

    if (allowedRegionIds && !allowedRegionIds.includes(report.region_id)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    let versionId = report.active_version_id as number | null;
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

    if (!versionId) {
      return res.status(404).json({ error: 'report_version 不存在' });
    }

    const versionRes = await pool.query(
      `SELECT provider, model, ingestion_batch_id
       FROM report_versions
       WHERE id = $1
       LIMIT 1`,
      [versionId]
    );
    const versionRow = versionRes.rows?.[0] || {};

    // If a parse job is already queued/running, return it
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
      return res.json({ job_id: existingJob.id, status: existingJob.status, reused: true });
    }

    const jobRes = await pool.query(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
       VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5)
       RETURNING id`,
      [reportId, versionId, versionRow.provider ?? null, versionRow.model ?? null, versionRow.ingestion_batch_id ?? null]
    );
    const jobId = jobRes.rows[0]?.id;

    return res.json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Error re-parsing report:', error);
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
      return res.status(404).json({ error: 'region 不存在' });
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

    // 1. Find the current active version
    const activeVersionRes = await pool.query(`
       SELECT rv.*
       FROM reports r
       JOIN report_versions rv ON rv.id = r.active_version_id
       WHERE r.id = $1
       LIMIT 1
    `, [reportId]);

    if (activeVersionRes.rows.length === 0) {
      return res.status(404).json({ error: 'No active version found for this report' });
    }

    const active = activeVersionRes.rows[0];
    const oldVersionId = active.id;
    const jsonStr = JSON.stringify(parsed_json);

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

    let newVersionId: number;
    let reused = false;

    if (existingVersionRes.rows.length > 0) {
      // Reuse existing version
      newVersionId = existingVersionRes.rows[0].id;
      reused = true;

      await pool.query(`
         UPDATE reports
         SET active_version_id = $1, updated_at = NOW()
         WHERE id = $2
      `, [newVersionId, reportId]);

      await pool.query(`
         UPDATE report_versions
         SET is_active = false, updated_at = NOW()
         WHERE report_id = $1 AND id != $2
      `, [reportId, newVersionId]);

      await pool.query(`
         UPDATE report_versions
         SET is_active = true, updated_at = NOW()
         WHERE id = $1
      `, [newVersionId]);

      console.log(`[ParsedData] Reused existing version ${newVersionId} for report ${reportId}`);
    } else {
      // Create new version
      const baseFileName = active.file_name || 'report';
      const newFileName = baseFileName.includes('(手工修订)')
        ? baseFileName
        : `${baseFileName.substring(0, 100)} (手工修订)`;

      const insertRes = await pool.query(
        `INSERT INTO report_versions 
           (report_id, file_name, file_hash, file_size, storage_path, text_path, raw_text,
            provider, model, prompt_version, schema_version, parsed_json, is_active, created_at, updated_at,
            version_type, parent_version_id, state, ingestion_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), 'manual_correct', $14, 'manual_corrected', $15)
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
          oldVersionId,
          active.ingestion_batch_id ?? null
        ]
      );
      newVersionId = insertRes.rows[0].id;

      console.log(`[ParsedData] Created new version ${newVersionId} for report ${reportId} (old: ${oldVersionId})`);
    }

    await pool.query(`
       UPDATE reports
       SET active_version_id = $1, updated_at = NOW()
       WHERE id = $2
    `, [newVersionId, reportId]);

    await pool.query(`
       UPDATE report_versions
       SET is_active = false, updated_at = NOW()
       WHERE report_id = $1 AND id != $2
    `, [reportId, newVersionId]);

    await pool.query(`
       UPDATE report_versions
       SET is_active = true, updated_at = NOW()
       WHERE id = $1
    `, [newVersionId]);

    return res.json({
      success: true,
      old_version_id: oldVersionId,
      new_version_id: newVersionId,
      reused
    });
  } catch (error) {
    console.error('Error updating parsed data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { region_id, year, unit_name } = req.query;

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

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

    const query = `
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
      FROM reports r
      LEFT JOIN report_versions rv ON rv.id = r.active_version_id
      ${whereClause}
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

  // Get active version_ids for these reports + parsed_json + cached check stats
  const versionRes = await pool.query(`
      SELECT
        r.id as report_id,
        rv.id as version_id,

        CASE
          WHEN rv.parsed_json IS NULL THEN false
          WHEN rv.parsed_json::text IN ('{}', 'null', '\"\"') THEN false
          ELSE true
        END AS has_content_db,
        rv.check_total,
        rv.check_visual,
        rv.check_structure,
        rv.check_quality,
        rv.checks_updated_at
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
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

  const result: Record<string, any> = {};

  const missingVersionIds: number[] = [];
  for (const row of versionRows) {
    const reportId = Number(row.report_id);
    const checked = !!row.checks_updated_at;
    if (!checked) {
      missingVersionIds.push(Number(row.version_id));
    }
    result[String(reportId)] = {
      has_content: contentMap.get(reportId) ?? false,
      checked,
      total: checked ? Number(row.check_total || 0) : null,
      visual: checked ? Number(row.check_visual || 0) : null,
      structure: checked ? Number(row.check_structure || 0) : null,
      quality: checked ? Number(row.check_quality || 0) : null
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
              AND group_key IN ('structure','table2','table3','table4','text')
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
        const visual = Number(counts.visual || 0);
        const structure = Number(counts.structure || 0);
        const quality = Number(counts.quality || 0);

        result[String(reportId)] = {
          has_content: contentMap.get(reportId) ?? false,
          checked: true,
          total,
          visual,
          structure,
          quality
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

router.get('/reports/:id/source-text', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const full = req.query.full === '1' || req.query.full === 'true';
    const limitRaw = req.query.limit;
    let requestedLimit: number | null = null;
    if (typeof limitRaw === 'string' && limitRaw.trim() !== '') {
      const parsedLimit = Number(limitRaw);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ error: 'limit 无效，必须是正整数' });
      }
      requestedLimit = Math.min(Math.floor(parsedLimit), 2_000_000);
    }

    const rawColumnExists = await hasRawTextColumn();
    const sourceSql = rawColumnExists ? 'rv.raw_text' : 'NULL::text AS raw_text';
    const detailRes = await pool.query(
      `SELECT
         r.id AS report_id,
         r.region_id,
         rv.id AS version_id,
         rv.storage_path,
         ${sourceSql}
       FROM reports r
       LEFT JOIN report_versions rv ON rv.id = r.active_version_id
       WHERE r.id = $1
       LIMIT 1`,
      [reportId]
    );

    const row = detailRes.rows[0];
    if (!row) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(row.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    if (!row.version_id) {
      return res.status(404).json({ error: 'active_version 不存在' });
    }

    let sourceText = typeof row.raw_text === 'string' ? row.raw_text : '';
    let sourceType = sourceText ? 'db_raw_text' : 'none';

    if (refresh || !sourceText) {
      if (!row.storage_path) {
        return res.status(404).json({ error: 'source_file_path 不存在' });
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
      return res.status(404).json({ error: 'source_text 不存在' });
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
        r.unit_name,
        rv.id AS version_id,
        rv.file_hash,
        rv.storage_path,
        rv.parsed_json,
        rv.provider,
        rv.model,
        rv.prompt_version,
        rv.schema_version,
        rv.text_path,
        rv.created_at
      FROM reports r
      LEFT JOIN regions reg ON reg.id = r.region_id
      LEFT JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.id = $1
      LIMIT 1;
    `, [reportId]);
    const report = reportRes.rows[0];

    if (!report) {
      return res.status(404).json({ error: 'report 不存在' });
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

    let parsedJson: any = null;
    if (report?.parsed_json) {
      parsedJson = parseDbJson(report.parsed_json);
    }

    return res.json({
      report_id: report.report_id,
      region_id: report.region_id,
      region_name: report.region_name,
      year: report.year,
      unit_name: report.unit_name,
      active_version: report.version_id ? {
        version_id: report.version_id,
        file_hash: report.file_hash,
        storage_path: report.storage_path,
        text_path: report.text_path,
        parsed_json: parsedJson,
        provider: report.provider,
        model: report.model,
        prompt_version: report.prompt_version,
        schema_version: report.schema_version,
        created_at: report.created_at,
      } : null,
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
      return res.status(404).json({ error: 'report 不存在' });
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
