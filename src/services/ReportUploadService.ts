import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { calculateFileHash } from '../utils/fileHash';
import { DATA_DIR, ensureSqliteMigrations, querySqlite, sqlValue, SQLITE_DB_PATH, UPLOADS_DIR } from '../config/sqlite';
import pool, { dbType } from '../config/database-llm';

export interface ReportUploadPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  tempFilePath: string;
  originalName: string;
  mimeType: string;
  size: number;
  model?: string;
  batchUuid?: string; // Optional batch UUID for grouping batch uploads
}

export interface ReportTextUploadPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  rawText: string;
  model?: string;
  batchUuid?: string;
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

// Database helper functions for dual-database support
async function dbQuery(sql: string, params?: any[]): Promise<any[]> {
  if (dbType === 'postgres') {
    const result = await pool.query(sql, params);
    return result.rows;
  } else {
    // For SQLite, we need to interpolate params into the SQL
    // This is a simplified version - in production you'd want proper parameter binding
    return querySqlite(sql);
  }
}

// Get the correct timestamp expression for the current database
function getUpdatedAtExpression(): string {
  return dbType === 'postgres' ? 'NOW()' : "datetime('now')";
}

function ensureStorageDir(dir: string = storageDir): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveProviderAndModel(modelInput?: string): { provider: string; model: string } {
  // Default from env
  const defaultProvider = process.env.LLM_PROVIDER || 'stub';
  const defaultModel = process.env.LLM_MODEL || 'default';

  if (!modelInput) {
    return { provider: defaultProvider, model: defaultModel }; // 'pending' status will be set by job runner? No, we set explicit provider here.
  }

  const input = modelInput.toLowerCase().trim();

  // 1. Explicit Gemini prefix
  if (input.startsWith('gemini/')) {
    return { provider: 'gemini', model: input.replace('gemini/', '') };
  }

  // 2. Qwen / DeepSeek -> ModelScope
  if (
    input.includes('qwen') ||
    input.includes('deepseek') ||
    input.includes('mimo')
  ) {
    return { provider: 'modelscope', model: modelInput }; // Keep original case for model ID if needed
  }

  // 3. Fallback or generic
  // If no prefix but valid provider name, one might pass provider only? 
  // For now, assume if it looks specific, we map to modelscope or gemini? 
  // Let's rely on the frontend sending valid codes. 

  // If unknown, fallback to env or treat as modelscope if configured?
  // Let's fallback to modelscope if LLM_PROVIDER is modelscope, else gemini.
  if (process.env.LLM_PROVIDER === 'modelscope') {
    return { provider: 'modelscope', model: modelInput };
  }

  return { provider: defaultProvider, model: modelInput };
}

async function resolveIngestionBatchId(batchUuid?: string, createdBy?: number | null): Promise<number | null> {
  if (!batchUuid) {
    return null;
  }

  if (dbType === 'postgres') {
    const existing = await pool.query('SELECT id FROM ingestion_batches WHERE batch_uuid = $1 LIMIT 1', [batchUuid]);
    if (existing.rows[0]?.id) {
      return existing.rows[0].id as number;
    }
    const inserted = await pool.query(
      `INSERT INTO ingestion_batches (batch_uuid, created_by, source, status)
       VALUES ($1, $2, 'upload', 'processing')
       RETURNING id`,
      [batchUuid, createdBy ?? null]
    );
    return inserted.rows[0]?.id ?? null;
  }

  const existing = querySqlite(
    `SELECT id FROM ingestion_batches WHERE batch_uuid = ${sqlValue(batchUuid)} LIMIT 1;`
  )[0];
  if (existing?.id) {
    return existing.id as number;
  }
  querySqlite(
    `INSERT INTO ingestion_batches (batch_uuid, created_by, source, status)
     VALUES (${sqlValue(batchUuid)}, ${sqlValue(createdBy ?? null)}, 'upload', 'processing');`
  );
  const inserted = querySqlite(
    `SELECT id FROM ingestion_batches WHERE batch_uuid = ${sqlValue(batchUuid)} LIMIT 1;`
  )[0];
  return inserted?.id ?? null;
}

export class ReportUploadService {
  async processUpload(payload: ReportUploadPayload): Promise<ReportUploadResult> {
    ensureStorageDir();

    // Truncate originalName to avoid DB column size limit (VARCHAR(255))
    // We reserve space for timestamp prefix (14 chars) and extension
    let safeName = payload.originalName;
    if (Buffer.byteLength(safeName, 'utf8') > 200) {
      const extMatch = safeName.match(/\.[^.]+$/);
      const ext = extMatch ? extMatch[0] : '';
      const nameWithoutExt = safeName.replace(/\.[^.]+$/, '');

      let truncated = '';
      let currentBytes = 0;
      const maxBytes = 200; // Safe limit

      for (const char of nameWithoutExt) {
        const charBytes = Buffer.byteLength(char, 'utf8');
        if (currentBytes + charBytes > maxBytes) break;
        truncated += char;
        currentBytes += charBytes;
      }
      safeName = truncated + ext;
      console.log(`[ReportUpload] Truncated filename to ${safeName}`);
    }
    const finalPayload = { ...payload, originalName: safeName };

    // Only run SQLite migrations if using SQLite
    if (dbType === 'sqlite') {
      ensureSqliteMigrations();
    }

    // Check region exists
    let region: any;
    if (dbType === 'postgres') {
      const result = await pool.query('SELECT id FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
      region = result.rows[0];
    } else {
      region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
    }
    if (!region) {
      throw new Error('region_not_found');
    }

    const { provider, model } = resolveProviderAndModel(payload.model);
    const fileHash = await calculateFileHash(payload.tempFilePath);
    const unitName = payload.unitName ? String(payload.unitName).trim() : '';
    const updatedAtExpr = getUpdatedAtExpression();
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    // Insert or update report
    let report: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        `INSERT INTO reports (region_id, year, unit_name) VALUES ($1, $2, $3)
         ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [payload.regionId, payload.year, unitName]
      );
      report = result.rows[0];
    } else {
      report = querySqlite(
        `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
         ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = ${updatedAtExpr}
         RETURNING id;`
      )[0];
    }

    // Check existing version
    let existingVersion: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        'SELECT * FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1',
        [report.id, fileHash]
      );
      existingVersion = result.rows[0];
    } else {
      existingVersion = querySqlite(
        `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
      )[0];
    }

    const isHtml = payload.mimeType === 'text/html' || safeName.toLowerCase().endsWith('.html') || safeName.toLowerCase().endsWith('.htm');
    const isTxt = payload.mimeType === 'text/plain' || safeName.toLowerCase().endsWith('.txt');
    const extension = isHtml ? '.html' : (isTxt ? '.txt' : '.pdf');

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);
    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      // Deactivate old versions (compatibility)
      if (dbType === 'postgres') {
        await pool.query('UPDATE report_versions SET is_active = false WHERE report_id = $1 AND is_active = true', [report.id]);
      } else {
        querySqlite(`UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`);
      }

      // Insert new version
      let version: any;
      if (dbType === 'postgres') {
        const result = await pool.query(
          `INSERT INTO report_versions (
            report_id, file_name, file_hash, file_size, storage_path, text_path,
            provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
            version_type, parent_version_id, state, ingestion_batch_id
          ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', '{}', 'v1', true, NULL, 'original_parse', NULL, 'parsed', $8)
          RETURNING id`,
          [report.id, safeName, fileHash, payload.size, storageRelative, provider, model, ingestionBatchId]
        );
        version = result.rows[0];
      } else {
        version = querySqlite(
          `INSERT INTO report_versions (
            report_id, file_name, file_hash, file_size, storage_path, text_path,
            provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
            version_type, parent_version_id, state, ingestion_batch_id
          ) VALUES (
            ${sqlValue(report.id)}, ${sqlValue(safeName)}, ${sqlValue(fileHash)}, ${sqlValue(payload.size)}, ${sqlValue(storageRelative)}, NULL,
            ${sqlValue(provider)}, ${sqlValue(model)}, 'v1', '{}', 'v1', 1, NULL,
            'original_parse', NULL, 'parsed', ${sqlValue(ingestionBatchId)}
          ) RETURNING id;`
        )[0];
      }
      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    // Update active pointer for the report
    if (dbType === 'postgres') {
      await pool.query(
        `UPDATE reports SET active_version_id = $1, updated_at = NOW() WHERE id = $2`,
        [versionId, report.id]
      );
      await pool.query(
        `UPDATE report_versions SET is_active = false WHERE report_id = $1 AND id != $2`,
        [report.id, versionId]
      );
      await pool.query(
        `UPDATE report_versions SET is_active = true WHERE id = $1`,
        [versionId]
      );
    } else {
      querySqlite(
        `UPDATE reports SET active_version_id = ${sqlValue(versionId)}, updated_at = ${updatedAtExpr} WHERE id = ${sqlValue(report.id)};`
      );
      querySqlite(
        `UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND id != ${sqlValue(versionId)};`
      );
      querySqlite(
        `UPDATE report_versions SET is_active = 1 WHERE id = ${sqlValue(versionId)};`
      );
    }

    // Always create a new job record for each upload (history mode)
    let newJob: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
         VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5) RETURNING id`,
        [report.id, versionId, provider, model, ingestionBatchId]
      );
      newJob = result.rows[0];
    } else {
      newJob = querySqlite(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
         VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0, ${sqlValue(provider)}, ${sqlValue(model)}, ${sqlValue(ingestionBatchId)}) RETURNING id;`
      )[0];
    }
    const jobId = newJob.id;
    const reusedJob = false;

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
      rawTextLength: payload.rawText?.length,
      model: payload.model
    });
    ensureStorageDir();

    // Only run SQLite migrations if using SQLite
    if (dbType === 'sqlite') {
      ensureSqliteMigrations();
    }

    // Check region exists
    let region: any;
    if (dbType === 'postgres') {
      const result = await pool.query('SELECT id FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
      region = result.rows[0];
    } else {
      region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
    }
    if (!region) {
      console.error('[DEBUG] Region not found:', payload.regionId);
      throw new Error('region_not_found');
    }

    const { provider, model } = resolveProviderAndModel(payload.model);
    const rawText = String(payload.rawText || '').trim();
    if (!rawText) {
      throw new Error('raw_text_empty');
    }

    const unitName = payload.unitName ? String(payload.unitName).trim() : '';
    const fileHash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');
    const updatedAtExpr = getUpdatedAtExpression();
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    // Insert or update report
    let report: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        `INSERT INTO reports (region_id, year, unit_name) VALUES ($1, $2, $3)
         ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [payload.regionId, payload.year, unitName]
      );
      report = result.rows[0];
    } else {
      report = querySqlite(
        `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
         ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = ${updatedAtExpr}
         RETURNING id;`
      )[0];
    }

    // Check existing version
    let existingVersion: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        'SELECT * FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1',
        [report.id, fileHash]
      );
      existingVersion = result.rows[0];
    } else {
      existingVersion = querySqlite(
        `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
      )[0];
    }

    const isHtml = rawText.trim().toLowerCase().startsWith('<') || rawText.includes('</html>');
    const extension = isHtml ? '.html' : '.txt';

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);

    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      // Deactivate old versions
      if (dbType === 'postgres') {
        await pool.query('UPDATE report_versions SET is_active = false WHERE report_id = $1 AND is_active = true', [report.id]);
      } else {
        querySqlite(`UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`);
      }

      const parsedJson = {};
      const fileSize = Buffer.byteLength(rawText, 'utf8');
      const fileName = `raw-content-${payload.year}${extension}`;

      // Insert new version
      let version: any;
      if (dbType === 'postgres') {
        const result = await pool.query(
          `INSERT INTO report_versions (
            report_id, file_name, file_hash, file_size, storage_path, text_path,
            provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
            version_type, parent_version_id, state, ingestion_batch_id
          ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', $8, 'v1', true, $9, 'original_parse', NULL, 'parsed', $10)
          RETURNING id`,
          [report.id, fileName, fileHash, fileSize, storageRelative, provider, model, JSON.stringify(parsedJson), rawText, ingestionBatchId]
        );
        version = result.rows[0];
      } else {
        version = querySqlite(
          `INSERT INTO report_versions (
            report_id, file_name, file_hash, file_size, storage_path, text_path,
            provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
            version_type, parent_version_id, state, ingestion_batch_id
          ) VALUES (
            ${sqlValue(report.id)}, ${sqlValue(fileName)}, ${sqlValue(fileHash)}, ${sqlValue(fileSize)}, ${sqlValue(storageRelative)}, NULL,
            ${sqlValue(provider)}, ${sqlValue(model)}, 'v1', ${sqlValue(JSON.stringify(parsedJson))}, 'v1', 1, ${sqlValue(rawText)},
            'original_parse', NULL, 'parsed', ${sqlValue(ingestionBatchId)}
          ) RETURNING id;`
        )[0];
      }
      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    if (dbType === 'postgres') {
      await pool.query(
        `UPDATE reports SET active_version_id = $1, updated_at = NOW() WHERE id = $2`,
        [versionId, report.id]
      );
      await pool.query(
        `UPDATE report_versions SET is_active = false WHERE report_id = $1 AND id != $2`,
        [report.id, versionId]
      );
      await pool.query(
        `UPDATE report_versions SET is_active = true WHERE id = $1`,
        [versionId]
      );
    } else {
      querySqlite(
        `UPDATE reports SET active_version_id = ${sqlValue(versionId)}, updated_at = ${updatedAtExpr} WHERE id = ${sqlValue(report.id)};`
      );
      querySqlite(
        `UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND id != ${sqlValue(versionId)};`
      );
      querySqlite(
        `UPDATE report_versions SET is_active = 1 WHERE id = ${sqlValue(versionId)};`
      );
    }

    // Always create a new job record for each upload (history mode)
    let newJob: any;
    if (dbType === 'postgres') {
      const result = await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
         VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5) RETURNING id`,
        [report.id, versionId, provider, model, ingestionBatchId]
      );
      newJob = result.rows[0];
    } else {
      newJob = querySqlite(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
         VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0, ${sqlValue(provider)}, ${sqlValue(model)}, ${sqlValue(ingestionBatchId)}) RETURNING id;`
      )[0];
    }
    const jobId = newJob.id;
    const reusedJob = false;

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
