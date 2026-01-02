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
  model?: string;
  batchId?: string; // Optional batch ID for grouping batch uploads
}

export interface ReportTextUploadPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  rawText: string;
  model?: string;
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

  // 2. GLM-Flash Specific
  if (input === 'glm-flash') {
    return { provider: 'glm-flash', model: 'glm-4-flash' };
  }

  // 2.5. GLM-4.5-Flash Specific
  if (input === 'glm-4.5-flash') {
    return { provider: 'glm-4.5-flash', model: 'glm-4.5-flash' };
  }

  // 3. Qwen / DeepSeek / other GLM -> ModelScope
  if (
    input.includes('qwen') ||
    input.includes('deepseek') ||
    input.includes('glm')
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

export class ReportUploadService {
  async processUpload(payload: ReportUploadPayload): Promise<ReportUploadResult> {
    ensureStorageDir();
    ensureSqliteMigrations();

    const region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
    if (!region) {
      throw new Error('region_not_found');
    }

    const { provider, model } = resolveProviderAndModel(payload.model);

    const fileHash = await calculateFileHash(payload.tempFilePath);

    const unitName = payload.unitName ? String(payload.unitName).trim() : '';

    const report = querySqlite(
      `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
       ON CONFLICT(region_id, year, unit_name) DO UPDATE SET
         updated_at = ${updatedAtExpression}
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
          ${sqlValue(provider)}, ${sqlValue(model)}, 'v1', '{}', 'v1', 1, NULL
        ) RETURNING id;`
      )[0];

      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
      // Should we update the provider/model if reusing? Probably not, or maybe yes if it's failed?
      // For now, respect existing version.
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    // Always create a new job record for each upload (history mode)
    const newJob = querySqlite(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, batch_id)
       VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0, ${sqlValue(provider)}, ${sqlValue(model)}, ${sqlValue(payload.batchId)}) RETURNING id;`
    )[0];
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
    ensureSqliteMigrations();

    const region = querySqlite(`SELECT id FROM regions WHERE id = ${sqlValue(payload.regionId)} LIMIT 1`)[0];
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

    const report = querySqlite(
      `INSERT INTO reports (region_id, year, unit_name) VALUES (${sqlValue(payload.regionId)}, ${sqlValue(payload.year)}, ${sqlValue(unitName)})
       ON CONFLICT(region_id, year, unit_name) DO UPDATE SET
         updated_at = ${updatedAtExpression}
       RETURNING id;`
    )[0];

    const existingVersion = querySqlite(
      `SELECT * FROM report_versions WHERE report_id = ${sqlValue(report.id)} AND file_hash = ${sqlValue(fileHash)} LIMIT 1;`
    )[0];

    const isHtml = rawText.trim().toLowerCase().startsWith('<') || rawText.includes('</html>');
    const extension = isHtml ? '.html' : '.txt';

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);

    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      querySqlite(`UPDATE report_versions SET is_active = 0 WHERE report_id = ${sqlValue(report.id)} AND is_active = 1;`);

      const parsedJson = {};

      const version = querySqlite(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text
        ) VALUES (
          ${sqlValue(report.id)}, ${sqlValue(`raw-content-${payload.year}${extension}`)}, ${sqlValue(fileHash)}, ${sqlValue(
          Buffer.byteLength(rawText, 'utf8')
        )}, ${sqlValue(storageRelative)}, NULL,
          ${sqlValue(provider)}, ${sqlValue(model)}, 'v1', ${sqlValue(JSON.stringify(parsedJson))}, 'v1', 1, ${sqlValue(rawText)}
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

    // Always create a new job record for each upload (history mode)
    const newJob = querySqlite(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model)
       VALUES (${sqlValue(report.id)}, ${sqlValue(versionId)}, 'parse', 'queued', 0, ${sqlValue(provider)}, ${sqlValue(model)}) RETURNING id;`
    )[0];
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
