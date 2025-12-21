import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { calculateFileHash } from '../utils/fileHash';
import { DATA_DIR, ensureSqliteMigrations, querySqlite, sqlValue, SQLITE_DB_PATH, UPLOADS_DIR } from '../config/sqlite';

export interface ReportUploadPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  tempFilePath: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface ReportTextUploadPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  rawText: string;
}

export interface ReportUploadResult {
  reportId: number;
  versionId: number;
  jobId: number;
  fileHash: string;
  storagePath: string;
  reusedVersion: boolean;
  reusedJob: boolean;
}

const storageDir = UPLOADS_DIR;
const dbClient = (process.env.DB_CLIENT || process.env.DB_DRIVER || '').toLowerCase();
const updatedAtExpression = ['pg', 'postgres', 'postgresql'].includes(dbClient) ? 'NOW()' : "datetime('now')";

function ensureStorageDir(dir: string = storageDir): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export class ReportUploadService {
  async processUpload(payload: ReportUploadPayload): Promise<ReportUploadResult> {
    ensureStorageDir();
    ensureSqliteMigrations();

    const region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
    if (!region) {
      throw new Error('region_not_found');
    }

    const fileHash = await calculateFileHash(payload.tempFilePath);

    const unitName = payload.unitName ? String(payload.unitName).trim() : null;

    const report = querySqlite(
      `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
       ON CONFLICT(region_id, year) DO UPDATE SET
         updated_at = ${updatedAtExpression},
         unit_name = COALESCE(excluded.unit_name, reports.unit_name)
       RETURNING id;`
    )[0];

    const existingVersion = querySqlite(
      `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
    )[0];

    const isHtml = payload.mimeType === 'text/html' || payload.originalName.toLowerCase().endsWith('.html') || payload.originalName.toLowerCase().endsWith('.htm');
    const extension = isHtml ? '.html' : '.pdf';

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);
    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      querySqlite(
        `UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`
      );

      const version = querySqlite(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text
        ) VALUES (
          ${sqlValue(report.id)}, ${sqlValue(payload.originalName)}, ${sqlValue(fileHash)}, ${sqlValue(payload.size)}, ${sqlValue(
          storageRelative
        )}, NULL,
          'upload', 'pending', 'v1', '{}', 'v1', 1, NULL
        ) RETURNING id;`
      )[0];

      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    const job = querySqlite(
      `SELECT * FROM jobs WHERE version_id = ${sqlValue(versionId)} AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1;`
    )[0];

    let jobId: number;
    let reusedJob = false;
    if (job) {
      jobId = job.id;
      reusedJob = true;
    } else {
      const newJob = querySqlite(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress)
         VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0) RETURNING id;`
      )[0];
      jobId = newJob.id;
    }

    const storageAbsoluteDir = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`);
    ensureStorageDir(storageAbsoluteDir);
    const storageAbsolute = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`, `${fileHash}${extension}`);
    if (!fs.existsSync(storageAbsolute)) {
      fs.copyFileSync(payload.tempFilePath, storageAbsolute);
    }

    fs.unlink(payload.tempFilePath, () => undefined);

    return {
      reportId: report.id,
      versionId,
      jobId,
      fileHash,
      storagePath: storageRelative,
      reusedVersion,
      reusedJob,
    };
  }

  async processTextUpload(payload: ReportTextUploadPayload): Promise<ReportUploadResult> {
    console.log('[DEBUG] processTextUpload called with:', { 
        regionId: payload.regionId, 
        year: payload.year, 
        rawTextLength: payload.rawText?.length 
    });
    ensureStorageDir();
    ensureSqliteMigrations();

    const region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
    if (!region) {
      console.error('[DEBUG] Region not found:', payload.regionId);
      throw new Error('region_not_found');
    }

    const rawText = String(payload.rawText || '').trim();
    if (!rawText) {
      throw new Error('raw_text_empty');
    }

    const unitName = payload.unitName ? String(payload.unitName).trim() : null;
    const fileHash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');

    const report = querySqlite(
      `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
       ON CONFLICT(region_id, year) DO UPDATE SET
         updated_at = ${updatedAtExpression},
         unit_name = COALESCE(excluded.unit_name, reports.unit_name)
       RETURNING id;`
    )[0];

    const existingVersion = querySqlite(
      `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
    )[0];

    const isHtml = rawText.trim().toLowerCase().startsWith('<') || rawText.includes('</html>');
    const extension = isHtml ? '.html' : '.txt';
    
    // For AI parsing, we treat both text and HTML as source material that needs parsing
    // Only difference is extension hints to the provider
    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);

    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      querySqlite(`UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`);

      // Initialize with empty JSON, LLM will fill it
      const parsedJson = {};

      const version = querySqlite(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text
        ) VALUES (
          ${sqlValue(report.id)}, ${sqlValue(`raw-content-${payload.year}${extension}`)}, ${sqlValue(fileHash)}, ${sqlValue(
          Buffer.byteLength(rawText, 'utf8')
        )}, ${sqlValue(storageRelative)}, NULL,
          'text', 'pending', 'v1', ${sqlValue(JSON.stringify(parsedJson))}, 'v1', 1, ${sqlValue(rawText)}
        ) RETURNING id;`
      )[0];

      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    // Check for existing active job
    const existingJob = querySqlite(
      `SELECT * FROM jobs WHERE version_id = ${sqlValue(versionId)} AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1;`
    )[0];

    let jobId: number;
    let reusedJob = false;
    if (existingJob) {
      jobId = existingJob.id;
      reusedJob = true;
    } else {
      // Create a PARSE job (not 'text'), so LlmJobRunner picks it up
      const newJob = querySqlite(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress)
         VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0) RETURNING id;`
      )[0];
      jobId = newJob.id;
    }

    const storageAbsoluteDir = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`);
    ensureStorageDir(storageAbsoluteDir);
    const storageAbsolute = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`, `${fileHash}${extension}`);
    if (!fs.existsSync(storageAbsolute)) {
      fs.writeFileSync(storageAbsolute, rawText, { encoding: 'utf8' });
    }

    return {
      reportId: report.id,
      versionId,
      jobId,
      fileHash,
      storagePath: storageRelative,
      reusedVersion,
      reusedJob,
    };
  }
}

export const reportUploadService = new ReportUploadService();
export const SQLITE_PATH_FOR_DOCS = SQLITE_DB_PATH;
