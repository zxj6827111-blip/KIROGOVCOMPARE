import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { calculateFileHash } from '../utils/fileHash';
import { DATA_DIR, UPLOADS_DIR } from '../config/constants';
import pool from '../config/database-llm';
import { uuidv5, validateUuid } from '../utils/uuid';
import { checkStoragePathExists } from './SourceFileGuardService';
import { hasParsedContent } from '../utils/parsedContent';
import { resolveUnifiedLlmConfig } from '../utils/aiEnv';
import { aiModelConfigService } from './AiModelConfigService';

const NAMESPACE_uuid = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // Standard namespace
const REPORT_UPLOAD_DEBUG = process.env.REPORT_UPLOAD_DEBUG === '1';

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
  sourceUrl?: string | null;
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

async function resolveProviderAndModel(modelInput?: string): Promise<{ provider: string; model: string }> {
  try {
    const resolved = await aiModelConfigService.resolveCredentialForModel('upload_parse', modelInput);
    if (resolved.provider && resolved.model) {
      return { provider: resolved.provider, model: resolved.model };
    }
  } catch (error) {
    console.warn('[ReportUpload] resolve from AI model catalog failed, fallback to env:', error);
  }

  const config = resolveUnifiedLlmConfig({
    model: modelInput,
    providerEnvKeys: ['LLM_PARSE_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['LLM_PARSE_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  });
  return { provider: config.provider, model: config.model };
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

function normalizeUnitName(input?: string | null, fallback: string = ''): string {
  const candidate = typeof input === 'string' ? input.trim() : '';
  if (candidate) {
    return candidate;
  }
  return String(fallback || '').trim();
}

async function resolveOrCreateReport(regionId: number, year: number, unitName: string): Promise<{ id: number }> {
  const existingResult = await pool.query(
    `SELECT id, unit_name
     FROM reports
     WHERE region_id = $1 AND year = $2
     ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [regionId, year]
  );

  const existing = existingResult.rows[0];
  if (existing?.id) {
    await pool.query(
      `UPDATE reports
       SET updated_at = NOW(),
           unit_name = CASE
             WHEN (unit_name IS NULL OR BTRIM(unit_name) = '') AND $2 <> '' THEN $2
             ELSE unit_name
           END
       WHERE id = $1`,
      [existing.id, unitName]
    );
    return { id: Number(existing.id) };
  }

  try {
    const insertResult = await pool.query(
      `INSERT INTO reports (region_id, year, unit_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [regionId, year, unitName]
    );
    return { id: Number(insertResult.rows[0].id) };
  } catch (error: any) {
    if (error?.code === '23505') {
      const concurrentResult = await pool.query(
        `SELECT id
         FROM reports
         WHERE region_id = $1 AND year = $2
         ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC
         LIMIT 1`,
        [regionId, year]
      );
      const concurrent = concurrentResult.rows[0];
      if (concurrent?.id) {
        return { id: Number(concurrent.id) };
      }
    }
    throw error;
  }
}

async function ensureParseJob(
  reportId: number,
  versionId: number,
  provider: string,
  model: string,
  ingestionBatchId: number | null,
  storagePath: string | null
): Promise<{ jobId: number; reused: boolean }> {
  const sourceCheck = checkStoragePathExists(storagePath);
  if (!sourceCheck.ok) {
    const error = new Error(sourceCheck.errorMessage || 'source file missing');
    (error as any).code = sourceCheck.errorCode || 'SOURCE_FILE_MISSING';
    throw error;
  }

  const runningJobResult = await pool.query(
    `SELECT id
     FROM jobs
     WHERE report_id = $1
       AND version_id = $2
       AND kind = 'parse'
       AND status IN ('queued', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [reportId, versionId]
  );
  const runningJob = runningJobResult.rows[0];
  if (runningJob?.id) {
    return { jobId: Number(runningJob.id), reused: true };
  }

  const newJobResult = await pool.query(
    `INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, max_retries, ingestion_batch_id)
     VALUES ($1, $2, 'parse', 'queued', 0, $3, $4, 0, $5)
     RETURNING id`,
    [reportId, versionId, provider, model, ingestionBatchId]
  );
  return { jobId: Number(newJobResult.rows[0].id), reused: false };
}

async function findLatestParseJobId(reportId: number, versionId: number): Promise<number | null> {
  const parseJobResult = await pool.query(
    `SELECT id
     FROM jobs
     WHERE report_id = $1
       AND version_id = $2
       AND kind = 'parse'
     ORDER BY id DESC
     LIMIT 1`,
    [reportId, versionId]
  );
  return parseJobResult.rows[0]?.id ? Number(parseJobResult.rows[0].id) : null;
}

export class ReportUploadService {
  async processUpload(payload: ReportUploadPayload): Promise<ReportUploadResult> {
    ensureStorageDir();

    // Check region exists
    const regionResult = await pool.query('SELECT id, name FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
    const region = regionResult.rows[0];

    if (!region) {
      throw new Error('region_not_found');
    }

    const { provider, model } = await resolveProviderAndModel(payload.model);
    const fileHash = await calculateFileHash(payload.tempFilePath);
    const unitName = normalizeUnitName(payload.unitName, region.name);
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    const report = await resolveOrCreateReport(payload.regionId, payload.year, unitName);

    // Check existing version
    const versionResult = await pool.query(
      'SELECT * FROM report_versions WHERE report_id = $1 AND file_hash = $2 LIMIT 1',
      [report.id, fileHash]
    );
    const existingVersion = versionResult.rows[0];

    const lowerName = payload.originalName.toLowerCase();
    const hasHtmlExt = lowerName.endsWith('.html') || lowerName.endsWith('.htm');
    const hasMdExt = lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
    const hasTxtExt = lowerName.endsWith('.txt');
    const isHtml = payload.mimeType === 'text/html' || hasHtmlExt;
    const isMd = payload.mimeType === 'text/markdown' || payload.mimeType === 'text/x-markdown' || hasMdExt;
    // Browsers may upload .md as text/plain. Keep .md precedence over .txt.
    const isTxt = !isMd && (payload.mimeType === 'text/plain' || hasTxtExt);

    let extension = '.pdf';
    if (isHtml) extension = '.html';
    else if (isTxt) extension = '.txt';
    else if (isMd) extension = '.md';

    const storageRelativeDir = path.join('data', 'uploads', `${payload.regionId}`, `${payload.year}`);
    const storageRelative = path.join(storageRelativeDir, `${fileHash}${extension}`);
    let versionId = existingVersion?.id as number | undefined;
    let reusedVersion = false;

    if (!existingVersion) {
      // Insert a new candidate version. It remains pending review until explicitly published.
      const insertVersionResult = await pool.query(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
          version_type, parent_version_id, state, review_status, ingestion_batch_id, source_url
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', '{}', 'v1', false, NULL, 'original_parse', NULL, 'pending_review', 'pending_review', $8, $9)
        RETURNING id`,
        [report.id, payload.originalName, fileHash, payload.size, storageRelative, provider, model, ingestionBatchId, payload.sourceUrl || null]
      );
      const version = insertVersionResult.rows[0];
      versionId = version?.id;
    } else {
      reusedVersion = true;
      versionId = existingVersion.id;
      if (payload.sourceUrl && !existingVersion.source_url) {
        await pool.query(
          `UPDATE report_versions
           SET source_url = $1,
               updated_at = NOW()
           WHERE id = $2
             AND (source_url IS NULL OR BTRIM(source_url) = '')`,
          [payload.sourceUrl, versionId]
        );
      }
    }

    if (!versionId) {
      throw new Error('version_not_created');
    }

    // Do not promote candidate versions to active here. Publishing is explicit.

    let jobId: number | null = null;
    let reusedJob = false;

    const storageAbsoluteDir = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`);
    ensureStorageDir(storageAbsoluteDir);
    const storageAbsolute = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`, `${fileHash}${extension}`);
    if (!fs.existsSync(storageAbsolute)) {
      fs.copyFileSync(payload.tempFilePath, storageAbsolute);
    }

    if (existingVersion && hasParsedContent(existingVersion.parsed_json)) {
      const latestParseJobId = await findLatestParseJobId(report.id, versionId);
      if (latestParseJobId) {
        jobId = latestParseJobId;
        reusedJob = true;
      }
    }

    if (!jobId) {
      const ensured = await ensureParseJob(report.id, versionId, provider, model, ingestionBatchId, storageRelative);
      jobId = ensured.jobId;
      reusedJob = ensured.reused;
    }

    fs.unlink(payload.tempFilePath, () => undefined);

    return {
      reportId: report.id,
      versionId,
      jobId: Number(jobId),
      fileHash,
      storagePath: storageRelative,
      reusedVersion,
      reusedJob,
    };
  }

  async processTextUpload(payload: ReportTextUploadPayload): Promise<ReportUploadResult> {
    if (REPORT_UPLOAD_DEBUG) {
      console.log('[DEBUG] processTextUpload called with:', {
        regionId: payload.regionId,
        year: payload.year,
        rawTextLength: payload.rawText?.length,
        model: payload.model
      });
    }
    ensureStorageDir();

    // Check region exists
    const regionResult = await pool.query('SELECT id, name FROM regions WHERE id = $1 LIMIT 1', [payload.regionId]);
    const region = regionResult.rows[0];

    if (!region) {
      if (REPORT_UPLOAD_DEBUG) {
        console.error('[DEBUG] Region not found:', payload.regionId);
      }
      throw new Error('region_not_found');
    }

    const { provider, model } = await resolveProviderAndModel(payload.model);
    const rawText = String(payload.rawText || '').trim();
    if (!rawText) {
      throw new Error('raw_text_empty');
    }

    const unitName = normalizeUnitName(payload.unitName, region.name);
    const fileHash = crypto.createHash('sha256').update(rawText, 'utf8').digest('hex');
    const ingestionBatchId = await resolveIngestionBatchId(payload.batchUuid, null);

    const report = await resolveOrCreateReport(payload.regionId, payload.year, unitName);

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
      const parsedJson = {};
      const fileSize = Buffer.byteLength(rawText, 'utf8');
      const fileName = `raw-content-${payload.year}${extension}`;

      // Insert a new candidate version. It remains pending review until explicitly published.
      const insertVersionResult = await pool.query(
        `INSERT INTO report_versions (
          report_id, file_name, file_hash, file_size, storage_path, text_path,
          provider, model, prompt_version, parsed_json, schema_version, is_active, raw_text,
          version_type, parent_version_id, state, review_status, ingestion_batch_id
        ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'v1', $8, 'v1', false, $9, 'original_parse', NULL, 'pending_review', 'pending_review', $10)
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

    // Do not promote candidate versions to active here. Publishing is explicit.

    let jobId: number | null = null;
    let reusedJob = false;

    const storageAbsoluteDir = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`);
    ensureStorageDir(storageAbsoluteDir);
    const storageAbsolute = path.join(DATA_DIR, 'uploads', `${payload.regionId}`, `${payload.year}`, `${fileHash}${extension}`);
    if (!fs.existsSync(storageAbsolute)) {
      fs.writeFileSync(storageAbsolute, rawText, { encoding: 'utf8' });
    }

    if (existingVersion && hasParsedContent(existingVersion.parsed_json)) {
      const latestParseJobId = await findLatestParseJobId(report.id, versionId);
      if (latestParseJobId) {
        jobId = latestParseJobId;
        reusedJob = true;
      }
    }

    if (!jobId) {
      const ensured = await ensureParseJob(report.id, versionId, provider, model, ingestionBatchId, storageRelative);
      jobId = ensured.jobId;
      reusedJob = ensured.reused;
    }

    return {
      reportId: report.id,
      versionId,
      jobId: Number(jobId),
      fileHash,
      storagePath: storageRelative,
      reusedVersion,
      reusedJob,
    };
  }
}

export const reportUploadService = new ReportUploadService();
