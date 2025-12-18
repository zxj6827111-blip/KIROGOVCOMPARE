import fs from 'fs';
import path from 'path';
import { calculateFileHash } from '../utils/fileHash';
import { ensureSqliteMigrations, querySqlite, sqlValue, SQLITE_DB_PATH } from '../config/sqlite';

export interface ReportUploadPayload {
  regionId: number;
  year: number;
  tempFilePath: string;
  originalName: string;
  mimeType: string;
  size: number;
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

const storageDir = path.join(process.cwd(), 'data', 'uploads');
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

    const report = querySqlite(
      `INSERT INTO reports (region_id, year) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)})
       ON CONFLICT(region_id, year) DO UPDATE SET updated_at = ${updatedAtExpression}
       RETURNING id;`
    )[0];

    const existingVersion = querySqlite(
      `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
    )[0];

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}.pdf`);
    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      querySqlite(
        `UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`
      );

      const version = querySqlite(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active
        ) VALUES (
          ${sqlValue(report.id)}, ${sqlValue(payload.originalName)}, ${sqlValue(fileHash)}, ${sqlValue(payload.size)}, ${sqlValue(
          storageRelative
        )}, NULL,
          'upload', 'pending', 'v1', '{}', 'v1', 1
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

    const storageAbsoluteDir = path.join(process.cwd(), storageRelativeDir);
    ensureStorageDir(storageAbsoluteDir);
    const storageAbsolute = path.join(process.cwd(), storageRelative);
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
}

export const reportUploadService = new ReportUploadService();
export const SQLITE_PATH_FOR_DOCS = SQLITE_DB_PATH;
