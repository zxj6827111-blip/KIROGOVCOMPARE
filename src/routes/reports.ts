import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { PROJECT_ROOT, UPLOADS_TMP_DIR, ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import { reportUploadService } from '../services/ReportUploadService';

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

router.post('/reports', upload.single('file'), async (req, res) => {
  const tmpFilePath = req.file?.path;
  try {
    const regionId = Number(req.body.region_id);
    const year = Number(req.body.year);
    const unitNameRaw = req.body.unit_name ?? req.body.unitName;
    const unitName = typeof unitNameRaw === 'string' && unitNameRaw.trim() ? unitNameRaw.trim() : null;
    const file = req.file;

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
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

    const result = await reportUploadService.processUpload({
      regionId,
      year,
      unitName,
      tempFilePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
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

router.post('/reports/text', express.json({ limit: '10mb' }), async (req, res) => {
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

router.get('/reports', (req, res) => {
  try {
    const { region_id, year } = req.query;

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

    ensureSqliteMigrations();

    const conditions: string[] = [];
    if (region_id !== undefined) {
      conditions.push(`r.region_id = ${sqlValue(Number(region_id))}`);
    }
    if (year !== undefined) {
      conditions.push(`r.year = ${sqlValue(Number(year))}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = querySqlite(`
      SELECT
        r.id AS report_id,
        r.region_id,
        r.year,
        r.unit_name,
        rv.id AS active_version_id,
        (SELECT j.id FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_id,
        (SELECT j.status FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_status,
        (SELECT j.progress FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_progress,
        (SELECT j.error_code FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_code,
        (SELECT j.error_message FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_error_message
      FROM reports r
      LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1
      ${whereClause}
      ORDER BY r.id DESC;
    `);

    return res.json({
      data: rows.map((row) => ({
        report_id: row.report_id,
        region_id: row.region_id,
        unit_name: row.unit_name,
        year: row.year,
        active_version_id: row.active_version_id || null,
        latest_job: row.job_id
          ? {
              job_id: row.job_id,
              status: row.job_status,
              progress: row.job_progress,
              error_code: row.job_error_code,
              error_message: row.job_error_message,
            }
          : null,
      })),
    });
  } catch (error) {
    console.error('Error listing reports:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports/:id', (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureSqliteMigrations();

    const report = querySqlite(`
      SELECT
        r.id AS report_id,
        r.region_id,
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
      LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1
      WHERE r.id = ${sqlValue(reportId)}
      LIMIT 1;
    `)[0];

    if (!report) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    const job = querySqlite(`
      SELECT id, status, progress, error_code, error_message
      FROM jobs
      WHERE report_id = ${sqlValue(reportId)}
      ORDER BY id DESC
      LIMIT 1;
    `)[0];

    let parsedJson: any = null;
    if (report?.parsed_json) {
      try {
        parsedJson = JSON.parse(report.parsed_json);
      } catch (error) {
        parsedJson = report.parsed_json;
      }
    }

    return res.json({
      report_id: report.report_id,
      region_id: report.region_id,
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

router.post('/reports/:id/parse', (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureSqliteMigrations();

    const report = querySqlite(`SELECT id FROM reports WHERE id = ${sqlValue(reportId)} LIMIT 1;`)[0] as
      | { id?: number }
      | undefined;
    if (!report?.id) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    const version = querySqlite(
      `SELECT id FROM report_versions WHERE report_id = ${sqlValue(reportId)} AND is_active = 1 ORDER BY id DESC LIMIT 1;`
    )[0] as { id?: number } | undefined;

    if (!version?.id) {
      return res.status(404).json({ error: 'report_version 不存在' });
    }

    const existingJob = querySqlite(
      `SELECT id FROM jobs WHERE report_id = ${sqlValue(reportId)} AND version_id = ${sqlValue(version.id)} AND kind = 'parse' AND status IN ('queued','running') ORDER BY id DESC LIMIT 1;`
    )[0] as { id?: number } | undefined;

    if (existingJob?.id) {
      return res.json({ job_id: existingJob.id, reused: true });
    }

    const newJob = querySqlite(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress)
       VALUES (${sqlValue(reportId)}, ${sqlValue(version.id)}, 'parse', 'queued', 0)
       RETURNING id;`
    )[0] as { id?: number } | undefined;

    return res.status(201).json({ job_id: newJob?.id || null, reused: false });
  } catch (error) {
    console.error('Error enqueue parse job:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/reports/:id', async (req, res) => {
  try {
    const reportId = Number(req.params.id);
    if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
      return res.status(400).json({ error: 'report_id 无效' });
    }

    ensureSqliteMigrations();

    const existing = querySqlite(`SELECT id FROM reports WHERE id = ${sqlValue(reportId)} LIMIT 1;`)[0] as
      | { id?: number }
      | undefined;

    if (!existing || !existing.id) {
      return res.status(404).json({ error: 'report 不存在' });
    }

    // Best-effort remove stored files first
    const versions = querySqlite(
      `SELECT storage_path, text_path FROM report_versions WHERE report_id = ${sqlValue(reportId)};`
    ) as Array<{ storage_path?: string | null; text_path?: string | null }>;

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
    const comparisonIds = querySqlite(
      `SELECT id FROM comparisons WHERE left_report_id = ${sqlValue(reportId)} OR right_report_id = ${sqlValue(reportId)};`
    ) as Array<{ id?: number }>;
    const ids = comparisonIds.map((c) => c.id).filter((id): id is number => typeof id === 'number' && id > 0);
    if (ids.length) {
      const inClause = ids.join(',');
      querySqlite(`DELETE FROM comparison_results WHERE comparison_id IN (${inClause});`);
      querySqlite(`DELETE FROM comparisons WHERE id IN (${inClause});`);
      querySqlite(`UPDATE jobs SET comparison_id = NULL WHERE comparison_id IN (${inClause});`);
    }

    // Remove jobs & versions, then report itself
    querySqlite(`DELETE FROM jobs WHERE report_id = ${sqlValue(reportId)};`);
    querySqlite(`DELETE FROM report_versions WHERE report_id = ${sqlValue(reportId)};`);
    querySqlite(`DELETE FROM reports WHERE id = ${sqlValue(reportId)};`);

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
