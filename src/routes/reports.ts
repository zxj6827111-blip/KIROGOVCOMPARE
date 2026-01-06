import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { dbBool, dbNowExpression, dbQuery, dbType, ensureDbMigrations, parseDbJson } from '../config/db-llm';
import { PROJECT_ROOT, UPLOADS_TMP_DIR, sqlValue } from '../config/sqlite';
import { reportUploadService } from '../services/ReportUploadService';
import { ValidationIssue } from '../types/models';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIds } from '../utils/dataScope';

const router = express.Router();

const tempDir = UPLOADS_TMP_DIR;
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    const isHtml = file.mimetype === 'text/html' || file.originalname.toLowerCase().endsWith('.html') || file.originalname.toLowerCase().endsWith('.htm');

    if (isPdf || isHtml) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF 或 HTML 文件'));
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
    const batchId = req.body.batch_id; // Extract batch_id from request

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    ensureDbMigrations();

    const allowedRegionIds = getAllowedRegionIds(req.user);
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

    if (!isPdf && !isHtml) {
      return res.status(400).json({ error: '仅支持 PDF 或 HTML 文件' });
    }

    // Fix for garbled filenames (UTF-8 bytes interpreted as Latin-1)
    const fixUtf8 = (str: string) => {
      try {
        // Check if string contains typical Latin-1 range chars that might be UTF-8 bytes
        // E.g. "æ" (0xE6), "å" (0xE5), etc.
        // A simple heuristic: try to decode as Latin-1 then read as UTF-8.
        // If the result looks like valid UTF-8 (and Chinese), usage is high probability correct.
        const fixed = Buffer.from(str, 'latin1').toString('utf8');
        // If the fixed string is significantly shorter (multi-byte chars) 
        // AND contains Chinese characters or other Unicode, it's likely the fix.
        if (fixed.length < str.length && /[^\u0000-\u00ff]/.test(fixed)) {
          return fixed;
        }
        return str;
      } catch (e) {
        return str;
      }
    };

    const originalName = fixUtf8(file.originalname);

    // [New Logic] Check if a report exists and if it is "empty".
    // If so, delete it before uploading, to act as an overwrite and avoid "Report exists" error.
    try {
      const existingReport = (await dbQuery(
        `SELECT id FROM reports WHERE region_id = ${regionId} AND year = ${year} AND unit_name = ${sqlValue(unitName)} LIMIT 1`
      ))[0];

      if (existingReport) {
        // Check active version
        const activeVersion = (await dbQuery(
          `SELECT parsed_json FROM report_versions WHERE report_id = ${existingReport.id} AND is_active = ${dbBool(true)} LIMIT 1`
        ))[0];

        let hasContent = false;
        if (activeVersion && activeVersion.parsed_json && activeVersion.parsed_json !== '{}') {
          // Check content logic...
          // We previously deleted empty reports here, but this is dangerous as it removes
          // failed jobs/reports that simply haven't finished parsing yet or failed.
          // Better to let them exist and just add new versions or fail the upload if exists.
        }
      }
    } catch (e) {
      console.warn('[ReportUpload] Check existing report failed:', e);
    }


    const result = await reportUploadService.processUpload({
      regionId,
      year,
      unitName,
      tempFilePath: file.path,
      originalName,
      mimeType: file.mimetype,
      size: file.size,
      model,
      batchId, // Pass batch_id to service
    });

    // FIX: Always return 201 for successful upload, even if version is reused
    // This allows frontend batch upload to continue processing instead of skipping
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

    if (typeof error?.message === 'string' && error.message.includes('UNIQUE constraint failed')) {
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

router.post('/reports/text', authMiddleware, requirePermission('upload_reports'), express.json({ limit: '10mb' }), async (req: AuthRequest, res) => {
  try {
    const regionId = Number(req.body?.region_id);
    const year = Number(req.body?.year);
    const unitNameRaw = req.body?.unit_name ?? req.body?.unitName;
    const rawTextRaw = req.body?.raw_text ?? req.body?.rawText;

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    if (!year || Number.isNaN(year) || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'year 无效' });
    }

    ensureDbMigrations();

    const allowedRegionIds = getAllowedRegionIds(req.user);
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
  try {
    const reportId = Number(req.params.id);
    const { parsed_json } = req.body;

    if (!reportId || isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID' });
    }

    if (!parsed_json || typeof parsed_json !== 'object') {
      return res.status(400).json({ error: 'Invalid parsed_json format' });
    }

    // 1. Find the latest active version for this report
    const versions = await dbQuery(
      `SELECT id FROM report_versions 
       WHERE report_id = ${dbType === 'postgres' ? '$1' : '?'} 
       AND is_active = ${dbBool(true)} 
       ORDER BY created_at DESC LIMIT 1`,
      [reportId]
    );

    if (versions.length === 0) {
      return res.status(404).json({ error: 'No active version found for this report' });
    }

    const versionId = versions[0].id;
    const jsonStr = JSON.stringify(parsed_json);

    // 2. Update the version's parsed_json
    await dbQuery(
      `UPDATE report_versions 
       SET parsed_json = ${dbType === 'postgres' ? '$1' : '?'}, 
           updated_at = ${dbNowExpression()} 
       WHERE id = ${dbType === 'postgres' ? '$2' : '?'}`,
      [jsonStr, versionId]
    );

    console.log(`[ParsedDataParams] Updated parsed_json for report ${reportId} (version ${versionId})`);

    return res.json({ success: true, version_id: versionId });
  } catch (error) {
    console.error('Error updating parsed data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { region_id, year, unit_name } = req.query;

    if (region_id !== undefined) {
      const regionIdNum = Number(region_id);
      if (!region_id || Number.isNaN(regionIdNum) || !Number.isInteger(regionIdNum) || regionIdNum < 1) {
        return res.status(400).json({ error: 'region_id 无效' });
      }
    }

    if (year !== undefined) {
      const yearNum = Number(year);
      if (!year || Number.isNaN(yearNum) || !Number.isInteger(yearNum)) {
        return res.status(400).json({ error: 'year 无效' });
      }
    }

    ensureDbMigrations();

    const conditions: string[] = [];
    if (region_id !== undefined) {
      conditions.push(`r.region_id = ${sqlValue(Number(region_id))}`);
    }
    if (year !== undefined) {
      conditions.push(`r.year = ${sqlValue(Number(year))}`);
    }
    if (unit_name !== undefined && String(unit_name).trim() !== '') {
      conditions.push(`r.unit_name = ${sqlValue(String(unit_name).trim())}`);
    }

    // [Data Scope Filtering]
    // Check if user has restricted data scope (admin usually has empty scope or full perms)
    // Assuming if dataScope.regions is not empty, we filter.
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      // Calculate all allowed descendant IDs (including children)
      // This ensures that if scope is 'Suqian', reports for 'Shuyang' (child) are also shown.
      const scopeNames = user.dataScope.regions.map((r: string) => `'${r.replace(/'/g, "''")}'`).join(',');

      const idsQuery = `
            WITH RECURSIVE allowed_ids AS (
                SELECT id FROM regions WHERE name IN (${scopeNames})
                UNION ALL
                SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
            )
            SELECT id FROM allowed_ids
      `;
      try {
        const allowedRows = (await dbQuery(idsQuery));
        const allowedIds = allowedRows.map((r: any) => r.id).join(',');

        if (allowedIds.length > 0) {
          conditions.push(`r.region_id IN (${allowedIds})`);
        } else {
          conditions.push('1=0'); // Scope matches no regions
        }
      } catch (e) {
        console.error('Error calculating scope IDs:', e);
        conditions.push('1=0'); // Fail safe
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = (await dbQuery(`
      SELECT
        r.id AS report_id,
        r.region_id,
        r.year,
        r.unit_name,
        rv.id AS active_version_id,
        rv.parsed_json,
        (SELECT j.id FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_id,
        (SELECT j.status FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_status,
        (SELECT j.progress FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_progress,
        (SELECT j.error_code FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_code,
        (SELECT j.error_message FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_message
      FROM reports r
      LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = ${dbBool(true)}
      ${whereClause}
      ORDER BY r.id DESC;
    `));

    return res.json({
      data: rows.map((row) => {
        let hasContent = false;
        const parsed = parseDbJson(row.parsed_json);
        if (parsed) {
          if (Array.isArray(parsed.sections) && parsed.sections.length > 0) {
            hasContent = true;
          } else if (parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0) {
            hasContent = true;
          } else if (parsed.report_type || parsed.basic_info || parsed.year) {
            hasContent = true;
          }
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

// Batch check status endpoint - MUST be before /reports/:id to avoid route conflict
router.get('/reports/batch-check-status', authMiddleware, async (req, res) => {
  try {
    const reportIdsParam = req.query.report_ids;
    if (!reportIdsParam || typeof reportIdsParam !== 'string') {
      return res.status(400).json({ error: 'report_ids query parameter required' });
    }

    let reportIds = reportIdsParam.split(',').map(id => Number(id.trim())).filter(id => !isNaN(id) && id > 0);
    if (reportIds.length === 0) {
      return res.json({});
    }

    ensureDbMigrations();

    const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0) {
        return res.json({});
      }
      const allowedReportRows = (await dbQuery(`
        SELECT id FROM reports
        WHERE id IN (${reportIds.join(',')})
          AND region_id IN (${allowedRegionIds.join(',')});
      `)) as Array<{ id: number }>;
      reportIds = allowedReportRows.map((row) => row.id);
      if (reportIds.length === 0) {
        return res.json({});
      }
    }

    // Get active version_ids for these reports + check parsed_json
    const versionRows = (await dbQuery(`
      SELECT r.id as report_id, rv.id as version_id, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = ${dbBool(true)}
      WHERE r.id IN (${reportIds.join(',')})
    `)) as Array<{ report_id: number; version_id: number; parsed_json: string | null }>;

    const versionMap = new Map(versionRows.map(v => [v.report_id, v.version_id]));

    // Check which versions have actual content
    const contentMap = new Map<number, boolean>();
    for (const v of versionRows) {
      let hasContent = false;
      const parsed = parseDbJson(v.parsed_json);
      if (parsed) {
        // Check for meaningful content:
        // - 'sections' array with at least one entry (new format)
        // - 'tables' object with at least one key (old format)
        // - or other recognized top-level fields
        if (Array.isArray(parsed.sections) && parsed.sections.length > 0) {
          hasContent = true;
        } else if (parsed.tables && typeof parsed.tables === 'object' && Object.keys(parsed.tables).length > 0) {
          hasContent = true;
        } else if (parsed.report_type || parsed.basic_info || parsed.year) {
          hasContent = true;
        }
      }
      contentMap.set(v.report_id, hasContent);
    }

    // Batch query for FAIL items by group
    const versionIds = Array.from(versionMap.values());
    if (versionIds.length === 0) {
      return res.json({});
    }

    const groupCounts = (await dbQuery(`
      SELECT report_version_id, group_key, COUNT(*) as cnt
      FROM report_consistency_items
      WHERE report_version_id IN (${versionIds.join(',')})
        AND auto_status = 'FAIL'
        AND (human_status != 'dismissed' OR human_status IS NULL)
      GROUP BY report_version_id, group_key
    `));
    
    // DEBUG: Log the raw group counts to diagnose "No issues found" bug
    console.log('[BatchCheckStatus] Version IDs:', versionIds);
    // console.log('[BatchCheckStatus] Group counts result:', JSON.stringify(groupCounts));

    // Force cast to avoid Postgres string-count issue
    const typedGroupCounts = groupCounts as Array<{ report_version_id: number; group_key: string; cnt: number | string }>;


    // Build result map: reportId => { total, visual, structure, quality, has_content }
    const result: Record<string, any> = {};

    // Initialize all reports with zero counts and has_content flag
    for (const [reportId, versionId] of versionMap) {
      result[String(reportId)] = {
        total: 0,
        visual: 0,
        structure: 0,
        quality: 0,
        has_content: contentMap.get(reportId) ?? false
      };
    }

    // Fill in actual counts
    const versionToReport = new Map(Array.from(versionMap.entries()).map(([rid, vid]) => [vid, rid]));
    for (const gc of groupCounts) {
      const reportId = versionToReport.get(gc.report_version_id);
      if (reportId) {
        const key = String(reportId);
        const cnt = Number(gc.cnt);
        result[key].total += cnt;
        if (gc.group_key === 'visual') {
          result[key].visual += cnt;
        } else if (['structure', 'table2', 'table3', 'table4', 'text'].includes(gc.group_key)) {
          // Merge structure, tables, and text checks into "Structure/Consistency" (勾稽)
          result[key].structure += cnt;
        } else if (gc.group_key === 'quality') {
          result[key].quality += cnt;
        }
      }
    }

    return res.json(result);
  } catch (error: any) {
    console.error('Error in batch-check-status:', error);
    return res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

router.get('/reports/:id', authMiddleware, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureDbMigrations();

    const report = (await dbQuery(`
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
      LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = ${dbBool(true)}
      WHERE r.id = ${sqlValue(reportId)}
      LIMIT 1;
    `))[0];

    if (!report) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const job = (await dbQuery(`
      SELECT id, status, progress, error_code, error_message
      FROM jobs
      WHERE report_id = ${sqlValue(reportId)}
      ORDER BY id DESC
      LIMIT 1;
    `))[0];

    let parsedJson: any = null;
    if (report?.parsed_json) {
      try {
        parsedJson = parseDbJson(report.parsed_json);
      } catch (error) {
        parsedJson = report.parsed_json;
      }
    }

    return res.json({
      report_id: report.report_id,
      region_id: report.region_id,
      region_name: report.region_name,
      unit_name: report.unit_name,
      year: report.year,
      active_version: report.version_id
        ? {
          version_id: report.version_id,
          file_hash: report.file_hash,
          storage_path: report.storage_path,
          parsed_json: parsedJson,
          provider: report.provider,
          model: report.model,
          prompt_version: report.prompt_version,
          schema_version: report.schema_version,
          text_path: report.text_path,
          created_at: report.created_at,
        }
        : null,
      latest_job: job
        ? {
          job_id: job.id,
          status: job.status,
          progress: job.progress,
          error_code: job.error_code,
          error_message: job.error_message,
        }
        : null,
    });
  } catch (error) {
    console.error('Error fetching report detail:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reports/:id/parse', authMiddleware, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureDbMigrations();

    const report = (await dbQuery(`SELECT id, region_id FROM reports WHERE id = ${sqlValue(reportId)} LIMIT 1;`))[0] as
      | { id?: number; region_id?: number }
      | undefined;
    if (!report?.id) {
      return res.status(404).json({ error: 'report 不存在' });
    }
    const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(report.region_id || 0)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const version = (await dbQuery(
      `SELECT id FROM report_versions WHERE report_id = ${sqlValue(reportId)} AND is_active = ${dbBool(true)} ORDER BY id DESC LIMIT 1;`
    ))[0] as { id?: number } | undefined;

    if (!version?.id) {
      return res.status(404).json({ error: 'report_version 不存在' });
    }

    const existingJob = (await dbQuery(
      `SELECT id FROM jobs WHERE report_id = ${sqlValue(reportId)} AND version_id = ${sqlValue(version.id)} AND kind = 'parse' AND status IN ('queued','running') ORDER BY id DESC LIMIT 1;`
    ))[0] as { id?: number } | undefined;

    if (existingJob?.id) {
      return res.json({ job_id: existingJob.id, reused: true });
    }

    const newJob = (await dbQuery(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress)
       VALUES (${sqlValue(reportId)}, ${sqlValue(version.id)}, 'parse', 'queued', 0)
       RETURNING id;`
    ))[0] as { id?: number } | undefined;

    return res.status(201).json({ job_id: newJob?.id || null, reused: false });
  } catch (error) {
    console.error('Error enqueue parse job:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/reports/:id', authMiddleware, async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureDbMigrations();

    const existing = (await dbQuery(`SELECT id, region_id FROM reports WHERE id = ${sqlValue(reportId)} LIMIT 1;`))[0] as
      | { id?: number; region_id?: number }
      | undefined;

    if (!existing || !existing.id) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
    if (allowedRegionIds) {
      if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(existing.region_id || 0)) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    // Best-effort remove stored files first
    const versions = (await dbQuery(
      `SELECT storage_path, text_path FROM report_versions WHERE report_id = ${sqlValue(reportId)};`
    )) as Array<{ storage_path?: string | null; text_path?: string | null }>;

    const toAbsoluteSafe = (maybeRelative: string) => {
      const absolute = path.isAbsolute(maybeRelative)
        ? path.normalize(maybeRelative)
        : path.resolve(PROJECT_ROOT, maybeRelative);
      const root = path.normalize(PROJECT_ROOT + path.sep);
      const normalized = path.normalize(absolute);
      if (!normalized.startsWith(root)) {
        return null;
      }
      return normalized;
    };

    const unlinkIfExists = async (maybePath?: string | null) => {
      if (!maybePath) return;
      const absolute = toAbsoluteSafe(maybePath);
      if (!absolute) return;
      await fsPromises.unlink(absolute).catch(() => undefined);
    };

    for (const v of versions) {
      await unlinkIfExists(v.storage_path || undefined);
      await unlinkIfExists(v.text_path || undefined);
    }

    // Remove comparisons referencing this report (and their results)
    const comparisonIds = (await dbQuery(
      `SELECT id FROM comparisons WHERE left_report_id = ${sqlValue(reportId)} OR right_report_id = ${sqlValue(reportId)};`
    )) as Array<{ id?: number }>;
    const ids = comparisonIds.map((c) => c.id).filter((id): id is number => typeof id === 'number' && id > 0);
    if (ids.length) {
      const inClause = ids.join(',');
      await dbQuery(`DELETE FROM comparison_results WHERE comparison_id IN (${inClause});`).catch(() => {});
      await dbQuery(`DELETE FROM comparisons WHERE id IN (${inClause});`).catch(() => {});
      await dbQuery(`UPDATE jobs SET comparison_id = NULL WHERE comparison_id IN (${inClause});`).catch(() => {});
    }

    // Attempt to delete consistency check related data (if tables exist)
    try {
      // Get version IDs
      const versions = (await dbQuery(`SELECT id FROM report_versions WHERE report_id = ${sqlValue(reportId)}`)) as Array<{ id: number }>;
      const versionIds = versions.map((v) => v.id);
      
      if (versionIds.length > 0) {
        const vIds = versionIds.join(',');
        
        // Delete related notifications FIRST
        await dbQuery(`DELETE FROM notifications WHERE related_version_id IN (${vIds})`).catch(() => {});
        
        // Delete consistency runs & items
        await dbQuery(`DELETE FROM report_consistency_run_items WHERE run_id IN (SELECT id FROM report_consistency_runs WHERE report_version_id IN (${vIds}))`).catch(() => {});
        await dbQuery(`DELETE FROM report_consistency_runs WHERE report_version_id IN (${vIds})`).catch(() => {});
        await dbQuery(`DELETE FROM report_consistency_items WHERE report_version_id IN (${vIds})`).catch(() => {});
        
        // Delete parses
        await dbQuery(`DELETE FROM report_version_parses WHERE report_version_id IN (${vIds})`).catch(() => {});
      }
    } catch (e) {
      console.warn('Error cleaning up related data:', e);
    }

    // Remove jobs & versions, then report itself
    await dbQuery(`DELETE FROM jobs WHERE report_id = ${sqlValue(reportId)};`).catch(() => {});
    await dbQuery(`DELETE FROM report_versions WHERE report_id = ${sqlValue(reportId)};`).catch(() => {});
    await dbQuery(`DELETE FROM reports WHERE id = ${sqlValue(reportId)};`);

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

