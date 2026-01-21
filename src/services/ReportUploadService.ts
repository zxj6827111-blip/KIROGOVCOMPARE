import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { calculateFileHash } from '../utils/fileHash';
import { DATA_DIR, UPLOADS_DIR } from '../config/constants';
import pool from '../config/database-llm';
import { v5 as uuidv5, validate as validateUuid } from 'uuid';

const NAMESPACE_uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard namespace

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
    return { provider: defaultProvider, model: defaultModel };
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
  if (process.env.LLM_PROVIDER === 'modelscope') {
    return { provider: 'modelscope', model: modelInput };
  }

  return { provider: defaultProvider, model: modelInput };
}

async function resolveIngestionBatchId(batchUuid?: string, createdBy?: number | null): Promise<number | null> {
  if (!batchUuid) {
    return null;
  }

  let validUuid = batchUuid;
  if (!validateUuid(batchUuid)) {
    // Deterministically convert non-UUID string (e.g. "batch_123") to UUID
    validUuid = uuidv5(batchUuid, NAMESPACE_uuid);
    console.log(`[UUID Fix] Converted legacy batch ID "${batchUuid}" to UUID "${validUuid}"`);
  }

  const existing = await pool.query('SELECT id FROM ingestion_batches WHERE batch_uuid = $1 LIMIT 1', [validUuid]);
  if (existing.rows[0]?.id) {
    return existing.rows[0].id as number;
  }
  const inserted = await pool.query(
    `INSERT INTO ingestion_batches (batch_uuid, created_by, source, status)
     VALUES ($1, $2, 'upload', 'processing')
     RETURNING id`,
    [validUuid, createdBy ?? null]
  );
  return inserted.rows[0]?.id ?? null;
}

export class ReportUploadService {
  async processUpload(payload: ReportUploadPayload): Promise<ReportUploadResult> {
    ensureStorageDir();

    // Check region exists
    const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
    const region = regionResult.rows[0];

    if (!region) {
      throw new Error('region_not_found');
    }

    const { provider, model } = resolveProviderAndModel(payload.model);
    const fileHash = await calculateFileHash(payload.tempFilePath);
    const unitName = payload.unitName ? String(payload.unitName).trim() : '';
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    // Insert or update report
    const reportResult = await pool.query(
      `INSERT INTO reports (region_id, year, unit_name) VALUES ($1, $2, $3)
       ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [payload.regionId, payload.year, unitName]
    );
    const report = reportResult.rows[0];

    // Check existing version
    const versionResult = await pool.query(
      'SELECT * FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1',
      [report.id, fileHash]
    );
    const existingVersion = versionResult.rows[0];

    const isHtml = payload.mimeType === 'text/html' || payload.originalName.toLowerCase().endsWith('.html') || payload.originalName.toLowerCase().endsWith('.htm');
    const isTxt = payload.mimeType === 'text/plain' || payload.originalName.toLowerCase().endsWith('.txt');
    const extension = isHtml ? '.html' : (isTxt ? '.txt' : '.pdf');

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);
    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      // Deactivate old versions (compatibility)
      await pool.query('UPDATE report_versions SET is_active = false WHERE report_id = $1 AND is_active = true', [report.id]);

      // Insert new version
      const insertVersionResult = await pool.query(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
          version_type, parent_version_id, state, ingestion_batch_id
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', '{}', 'v1', true, NULL, 'original_parse', NULL, 'parsed', $8)
        RETURNING id`,
        [report.id, payload.originalName, fileHash, payload.size, storageRelative, provider, model, ingestionBatchId]
      );
      const version = insertVersionResult.rows[0];
      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    // Update active pointer for the report
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

    // Always create a new job record for each upload (history mode)
    const newJobResult = await pool.query(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
       VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5) RETURNING id`,
      [report.id, versionId, provider, model, ingestionBatchId]
    );
    const newJob = newJobResult.rows[0];
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

    // Check region exists
    const regionResult = await pool.query('SELECT id FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
    const region = regionResult.rows[0];

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
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    // Insert or update report
    const reportResult = await pool.query(
      `INSERT INTO reports (region_id, year, unit_name) VALUES ($1, $2, $3)
       ON CONFLICT(region_id, year, unit_name) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [payload.regionId, payload.year, unitName]
    );
    const report = reportResult.rows[0];

    // Check existing version
    const versionResult = await pool.query(
      'SELECT * FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1',
      [report.id, fileHash]
    );
    const existingVersion = versionResult.rows[0];

    const isHtml = rawText.trim().toLowerCase().startsWith('<') || rawText.includes('</html>');
    const extension = isHtml ? '.html' : '.txt';

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);

    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      // Deactivate old versions
      await pool.query('UPDATE report_versions SET is_active = false WHERE report_id = $1 AND is_active = true', [report.id]);

      const parsedJson = {};
      const fileSize = Buffer.byteLength(rawText, 'utf8');
      const fileName = `raw-content-${payload.year}${extension}`;

      // Insert new version
      const insertVersionResult = await pool.query(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
          version_type, parent_version_id, state, ingestion_batch_id
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', $8, 'v1', true, $9, 'original_parse', NULL, 'parsed', $10)
        RETURNING id`,
        [report.id, fileName, fileHash, fileSize, storageRelative, provider, model, JSON.stringify(parsedJson), rawText, ingestionBatchId]
      );
      const version = insertVersionResult.rows[0];
      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

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

    // Always create a new job record for each upload (history mode)
    const newJobResult = await pool.query(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
       VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, $5) RETURNING id`,
      [report.id, versionId, provider, model, ingestionBatchId]
    );
    const newJob = newJobResult.rows[0];
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
