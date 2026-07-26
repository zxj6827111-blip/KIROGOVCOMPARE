/**
 * Server-side .kirogov.zip structured package import.
 * Does NOT call any LLM.
 *
 * Lifecycle:
 *   HTTP: validate → stage → publish → DB commit → enqueue structured_import job
 *   Worker: re-verify hashes → write parsed_json → enqueue materialize
 *           (checks enqueued by processMaterializeJob; SI job marked succeeded by runner)
 */
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import pool from '../../config/database-llm';
import { DATA_DIR, PROJECT_ROOT } from '../../config/constants';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  STRUCTURED_PACKAGE_LIMITS,
  STRUCTURED_PACKAGE_SCHEMA_VERSION,
  StructuredPackageError,
  StructuredPackageErrorCode,
} from '../../config/structuredPackage';
import { cleanupExtractDir, safeExtractStructuredPackage } from './ZipSecurityService';
import { loadSourceJsonFromFile } from './PackageSchemaService';
import {
  buildImportedParsedJson,
  hashFileSha256,
  verifyPackageFileHashes,
  verifyPackageMetadata,
} from './PackageHashService';
import {
  buildParseConfigSnapshot,
  parseRunService,
} from '../ParseRunService';
import { hasParsedContent } from '../../utils/parsedContent';
import {
  resolveOrCreateReport,
  ReportUniqueConflictError,
  findReportIdByRegionYear,
} from '../reportIdentity';
import { recoverVersionDownstream } from '../PipelineRecoveryService';

const PROVIDER_PLACEHOLDER = 'structured_import';
const MODEL_PLACEHOLDER = 'none';
const PROMPT_VERSION = 'structured_import_v1';

export interface StructuredImportPayload {
  regionId: number;
  year: number;
  unitName?: string | null;
  tempZipPath: string;
  originalName: string;
  size: number;
  createdBy?: number | null;
}

export interface StructuredImportResult {
  reportId: number;
  versionId: number;
  jobId: number;
  packageSha256: string;
  storagePath: string;
  reusedVersion: boolean;
  reusedJob: boolean;
  ingestionMode: 'structured_import';
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizeUnitName(input?: string | null, fallback: string = ''): string {
  const candidate = typeof input === 'string' ? input.trim() : '';
  if (candidate) return candidate;
  return String(fallback || '').trim();
}

function resolveStorageAbsolute(relativeOrAbsolute: string): string {
  if (path.isAbsolute(relativeOrAbsolute)) return relativeOrAbsolute;
  // Stored paths use the legacy 'data/...' convention. When DATA_DIR is
  // overridden (KIROGOV_DATA_DIR, e.g. isolated E2E), resolve against it;
  // with the default DATA_DIR (<project>/data) this is identical to the
  // PROJECT_ROOT resolution below.
  const normalized = relativeOrAbsolute.replace(/\\/g, '/');
  if (normalized.startsWith('data/')) {
    const fromDataDir = path.resolve(DATA_DIR, normalized.slice('data/'.length));
    if (fs.existsSync(fromDataDir)) return fromDataDir;
  }
  const fromRoot = path.resolve(PROJECT_ROOT, relativeOrAbsolute);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return path.resolve(process.cwd(), relativeOrAbsolute);
}

async function copyFile(src: string, dest: string): Promise<void> {
  ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
}

async function insertArtifact(
  client: { query: typeof pool.query },
  versionId: number,
  artifact: {
    type: 'source_package' | 'source_pdf' | 'source_markdown' | 'source_json';
    originalFilename: string;
    storedFilename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storagePath: string;
    schemaVersion?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO report_version_artifacts (
       report_version_id, artifact_type, original_filename, stored_filename,
       mime_type, size_bytes, sha256, storage_path, schema_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (report_version_id, artifact_type) DO UPDATE SET
       original_filename = EXCLUDED.original_filename,
       stored_filename = EXCLUDED.stored_filename,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       sha256 = EXCLUDED.sha256,
       storage_path = EXCLUDED.storage_path,
       schema_version = EXCLUDED.schema_version`,
    [
      versionId,
      artifact.type,
      artifact.originalFilename,
      artifact.storedFilename,
      artifact.mimeType,
      artifact.sizeBytes,
      artifact.sha256,
      artifact.storagePath,
      artifact.schemaVersion ?? null,
    ]
  );
}

async function findExistingImport(
  packageSha256: string,
  regionId: number,
  year: number
): Promise<{ versionId: number; reportId: number; storagePath: string } | null> {
  const existingPkg = await pool.query(
    `SELECT rv.id AS version_id, rv.report_id, rv.storage_path, rv.package_sha256
     FROM report_versions rv
     JOIN reports r ON r.id = rv.report_id
     WHERE rv.package_sha256 = $1
       AND r.region_id = $2
       AND r.year = $3
     ORDER BY rv.id DESC
     LIMIT 1`,
    [packageSha256, regionId, year]
  );
  if (!existingPkg.rows[0]?.version_id) return null;
  return {
    versionId: Number(existingPkg.rows[0].version_id),
    reportId: Number(existingPkg.rows[0].report_id),
    storagePath: String(existingPkg.rows[0].storage_path || ''),
  };
}

/**
 * Ensure a usable structured_import job for the version.
 * Exported for tests. Concurrency-safe: the partial unique index
 * uq_jobs_version_structured_import_active allows at most one active job per
 * version; a 23505 race is resolved by re-querying the concurrent winner
 * instead of bubbling up as HTTP 500.
 *
 * When an already-succeeded import job is reused, downstream materialize /
 * checks failures are healed (best effort) so re-uploading the same package
 * becomes a natural recovery path.
 */
export async function ensureStructuredImportJob(
  reportId: number,
  versionId: number,
  allowReuseSucceeded = true
): Promise<{ jobId: number; reusedJob: boolean; status: string }> {
  const findReusable = async (): Promise<{ jobId: number; status: string } | null> => {
    const jobRow = await pool.query(
      `SELECT id, status FROM jobs
       WHERE version_id = $1 AND kind = 'structured_import'
       ORDER BY id DESC LIMIT 1`,
      [versionId]
    );
    if (!jobRow.rows[0]?.id) return null;
    const status = String(jobRow.rows[0].status);
    if (status === 'queued' || status === 'running') {
      return { jobId: Number(jobRow.rows[0].id), status };
    }
    if (status === 'succeeded' && allowReuseSucceeded) {
      return { jobId: Number(jobRow.rows[0].id), status };
    }
    // failed/cancelled → caller inserts a fresh queued job
    return null;
  };

  const healDownstreamIfSucceeded = async (status: string): Promise<void> => {
    if (status !== 'succeeded') return;
    try {
      const healed = await recoverVersionDownstream(versionId);
      if (healed.action === 'requeued') {
        console.log(
          `[StructuredImport] Re-upload healed downstream: requeued ${healed.kind} job ${healed.jobId} for version ${versionId}`
        );
      }
    } catch (error: any) {
      // Healing is best-effort; the explicit /jobs/:version_id/retry channel remains.
      console.warn(
        `[StructuredImport] Downstream heal failed for version ${versionId}:`,
        error?.message || error
      );
    }
  };

  const reusable = await findReusable();
  if (reusable) {
    await healDownstreamIfSucceeded(reusable.status);
    return { jobId: reusable.jobId, reusedJob: true, status: reusable.status };
  }

  try {
    const inserted = await pool.query(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, provider, model, max_retries)
       VALUES ($1, $2, 'structured_import', 'queued', 0, 'QUEUED', 'waiting structured import', $3, $4, 1)
       RETURNING id`,
      [reportId, versionId, PROVIDER_PLACEHOLDER, MODEL_PLACEHOLDER]
    );
    return { jobId: Number(inserted.rows[0].id), reusedJob: false, status: 'queued' };
  } catch (error: any) {
    if (error?.code === '23505') {
      // Concurrent request created the active job first — return the winner.
      const winner = await findReusable();
      if (winner) {
        await healDownstreamIfSucceeded(winner.status);
        return { jobId: winner.jobId, reusedJob: true, status: winner.status };
      }
      throw new Error(
        `structured_import job conflict: unique violation but no reusable job found (version ${versionId})`
      );
    }
    throw error;
  }
}

export async function validateStructuredPackageFile(
  zipPath: string,
  expected?: { year?: number | null; organizationName?: string | null }
): Promise<{
  extractDir: string;
  files: Record<string, string>;
  envelope: ReturnType<typeof loadSourceJsonFromFile>;
  hashes: Awaited<ReturnType<typeof verifyPackageFileHashes>>;
}> {
  const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirogov-import-'));
  try {
    const extracted = await safeExtractStructuredPackage(zipPath, extractDir);
    const envelope = loadSourceJsonFromFile(extracted.files['source.json']);
    verifyPackageMetadata(envelope, {
      year: expected?.year,
      organizationName: expected?.organizationName,
    });
    const hashes = await verifyPackageFileHashes({
      zipPath,
      pdfPath: extracted.files['source.pdf'],
      markdownPath: extracted.files['source.md'],
      jsonPath: extracted.files['source.json'],
      envelope,
    });
    return {
      extractDir,
      files: extracted.files as Record<string, string>,
      envelope,
      hashes,
    };
  } catch (error) {
    await cleanupExtractDir(extractDir);
    throw error;
  }
}


/** Remove published package dir when no report_versions row references package_sha256. */
export async function cleanupOrphanPackageDir(
  finalAbs: string,
  packageSha256: string,
  query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>
): Promise<boolean> {
  const ref = await query(
    `SELECT 1 FROM report_versions WHERE package_sha256 = $1 LIMIT 1`,
    [packageSha256]
  );
  if (ref.rows[0]) return false;
  await fsp.rm(finalAbs, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

export async function publishStagingDir(stagingAbs: string, finalAbs: string): Promise<void> {
  ensureDir(path.dirname(finalAbs));
  // Atomic publish: rename whole staging dir -> finalAbs.
  // If finalAbs already exists, peer won; drop our staging only.
  if (fs.existsSync(finalAbs)) {
    await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
    return;
  }
  try {
    await fsp.rename(stagingAbs, finalAbs);
    return;
  } catch (error: any) {
    if (error?.code === 'EEXIST' || fs.existsSync(finalAbs)) {
      await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    // Cross-device: copy into a temp sibling then rename into place
    const tmpFinal = `${finalAbs}.publishing-${process.pid}-${Date.now()}`;
    try {
      await fsp.rm(tmpFinal, { recursive: true, force: true }).catch(() => undefined);
      await fsp.cp(stagingAbs, tmpFinal, { recursive: true });
      if (fs.existsSync(finalAbs)) {
        await fsp.rm(tmpFinal, { recursive: true, force: true }).catch(() => undefined);
        await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
      await fsp.rename(tmpFinal, finalAbs);
      await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
    } catch (inner: any) {
      await fsp.rm(tmpFinal, { recursive: true, force: true }).catch(() => undefined);
      if (fs.existsSync(finalAbs)) {
        await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
        return;
      }
      throw inner;
    }
  }
}
export class StructuredImportService {
  async processImport(payload: StructuredImportPayload): Promise<StructuredImportResult> {
    if (!payload.tempZipPath || !fs.existsSync(payload.tempZipPath)) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID, 'upload file missing');
    }
    if (payload.size > STRUCTURED_PACKAGE_LIMITS.maxZipBytes) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE);
    }

    const regionResult = await pool.query('SELECT id, name FROM regions WHERE id = $1 LIMIT 1', [
      payload.regionId,
    ]);
    const region = regionResult.rows[0];
    if (!region) {
      throw new Error('region_not_found');
    }

    const unitName = normalizeUnitName(payload.unitName, region.name);
    let validated: Awaited<ReturnType<typeof validateStructuredPackageFile>> | null = null;
    let stagingAbs = '';
    let finalAbs = '';
    let published = false;

    try {
      validated = await validateStructuredPackageFile(payload.tempZipPath, {
        year: payload.year,
        organizationName: payload.unitName || undefined,
      });

      const { envelope, hashes, files } = validated;
      const packageSha256 = hashes.packageSha256;

      // Scoped idempotency: same package under same region+year
      const existing = await findExistingImport(packageSha256, payload.regionId, payload.year);
      if (existing) {
        const ensured = await ensureStructuredImportJob(existing.reportId, existing.versionId, true);
        return {
          reportId: existing.reportId,
          versionId: existing.versionId,
          jobId: ensured.jobId,
          packageSha256,
          storagePath: existing.storagePath,
          reusedVersion: true,
          reusedJob: ensured.reusedJob,
          ingestionMode: 'structured_import',
        };
      }

      const relDir = path
        .join('data', 'uploads', String(payload.regionId), String(payload.year), 'packages', packageSha256)
        .replace(/\\/g, '/');
      finalAbs = path.join(
        DATA_DIR,
        'uploads',
        String(payload.regionId),
        String(payload.year),
        'packages',
        packageSha256
      );
      // Isolated staging — never write directly into the final package directory
      const stagingId = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
      stagingAbs = path.join(
        DATA_DIR,
        'uploads',
        String(payload.regionId),
        String(payload.year),
        'packages',
        '.staging',
        stagingId
      );
      ensureDir(stagingAbs);

      const packageStored = 'package.kirogov.zip';
      const pdfStored = 'source.pdf';
      const mdStored = 'source.md';
      const jsonStored = 'source.json';

      const packageRel = `${relDir}/${packageStored}`;
      const pdfRel = `${relDir}/${pdfStored}`;
      const mdRel = `${relDir}/${mdStored}`;
      const jsonRel = `${relDir}/${jsonStored}`;

      // All I/O into staging first (uniform compensation = delete staging only)
      await copyFile(payload.tempZipPath, path.join(stagingAbs, packageStored));
      await copyFile(files['source.pdf'], path.join(stagingAbs, pdfStored));
      await copyFile(files['source.md'], path.join(stagingAbs, mdStored));
      await copyFile(files['source.json'], path.join(stagingAbs, jsonStored));

      const packageStat = await fsp.stat(path.join(stagingAbs, packageStored));
      const pdfStat = await fsp.stat(path.join(stagingAbs, pdfStored));
      const mdStat = await fsp.stat(path.join(stagingAbs, mdStored));
      const jsonStat = await fsp.stat(path.join(stagingAbs, jsonStored));

      const client = await pool.connect();
      let reportId = 0;
      let versionId = 0;
      let jobId = 0;
      try {
        await client.query('BEGIN');
        try {
          reportId = (await resolveOrCreateReport(payload.regionId, payload.year, unitName, client)).id;
        } catch (identityError: any) {
          if (
            identityError instanceof ReportUniqueConflictError ||
            identityError?.code === 'REPORT_UNIQUE_CONFLICT' ||
            identityError?.code === '23505'
          ) {
            await client.query('ROLLBACK');
            const existingId = await findReportIdByRegionYear(payload.regionId, payload.year);
            if (!existingId) throw identityError;
            reportId = existingId;
            await client.query('BEGIN');
          } else {
            throw identityError;
          }
        }

        // Re-check scoped duplicate inside transaction
        const dup = await client.query(
          `SELECT rv.id AS version_id, rv.report_id, rv.storage_path
           FROM report_versions rv
           JOIN reports r ON r.id = rv.report_id
           WHERE rv.package_sha256 = $1 AND r.region_id = $2 AND r.year = $3
           LIMIT 1
           FOR UPDATE OF rv`,
          [packageSha256, payload.regionId, payload.year]
        );
        if (dup.rows[0]?.version_id) {
          await client.query('ROLLBACK');
          // Drop this request's staging only — never touch published finalAbs
          if (stagingAbs) {
            await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
            stagingAbs = '';
          }
          const vId = Number(dup.rows[0].version_id);
          const rId = Number(dup.rows[0].report_id);
          const ensured = await ensureStructuredImportJob(rId, vId, true);
          return {
            reportId: rId,
            versionId: vId,
            jobId: ensured.jobId,
            packageSha256,
            storagePath: String(dup.rows[0].storage_path || ''),
            reusedVersion: true,
            reusedJob: ensured.reusedJob,
            ingestionMode: 'structured_import',
          };
        }

        const insertVersion = await client.query(
          `INSERT INTO report_versions (
            report_id, file_name, file_hash, file_size, storage_path, text_path,
            provider, model, prompt_version, parsed_json, schema_version, is_active,
            version_type, state, review_status, created_by, ingestion_mode, package_sha256
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, '{}', $10, false,
            'structured_import', 'pending_review', 'pending_review', $11, 'structured_import', $12
          )
          RETURNING id`,
          [
            reportId,
            payload.originalName || 'package.kirogov.zip',
            packageSha256,
            packageStat.size,
            pdfRel,
            mdRel,
            PROVIDER_PLACEHOLDER,
            MODEL_PLACEHOLDER,
            PROMPT_VERSION,
            STRUCTURED_PACKAGE_SCHEMA_VERSION,
            payload.createdBy ?? null,
            packageSha256,
          ]
        );
        versionId = Number(insertVersion.rows[0].id);

        await insertArtifact(client, versionId, {
          type: 'source_package',
          originalFilename: payload.originalName || 'package.kirogov.zip',
          storedFilename: packageStored,
          mimeType: 'application/zip',
          sizeBytes: packageStat.size,
          sha256: hashes.packageSha256,
          storagePath: packageRel,
          schemaVersion: STRUCTURED_PACKAGE_SCHEMA_VERSION,
        });
        await insertArtifact(client, versionId, {
          type: 'source_pdf',
          originalFilename: 'source.pdf',
          storedFilename: pdfStored,
          mimeType: 'application/pdf',
          sizeBytes: pdfStat.size,
          sha256: hashes.pdfSha256,
          storagePath: pdfRel,
        });
        await insertArtifact(client, versionId, {
          type: 'source_markdown',
          originalFilename: 'source.md',
          storedFilename: mdStored,
          mimeType: 'text/markdown',
          sizeBytes: mdStat.size,
          sha256: hashes.markdownSha256,
          storagePath: mdRel,
        });
        await insertArtifact(client, versionId, {
          type: 'source_json',
          originalFilename: 'source.json',
          storedFilename: jsonStored,
          mimeType: 'application/json',
          sizeBytes: jsonStat.size,
          sha256: hashes.jsonSha256,
          storagePath: jsonRel,
          schemaVersion: envelope.schema_version,
        });

        const jobInsert = await client.query(
          `INSERT INTO jobs (
             report_id, version_id, kind, status, progress, step_code, step_name,
             provider, model, max_retries
           ) VALUES (
             $1, $2, 'structured_import', 'queued', 0, 'QUEUED', 'waiting structured import',
             $3, $4, 1
           ) RETURNING id`,
          [reportId, versionId, PROVIDER_PLACEHOLDER, MODEL_PLACEHOLDER]
        );
        jobId = Number(jobInsert.rows[0].id);

        // Publish files BEFORE commit so worker never sees DB rows without artifacts.
        // If publish fails, ROLLBACK — no dirty version/job rows.
        await publishStagingDir(stagingAbs, finalAbs);
        published = true;
        stagingAbs = '';

        await client.query('COMMIT');
      } catch (error: any) {
        await client.query('ROLLBACK').catch(() => undefined);
        // If we published then failed commit, remove orphan final dir when no DB row references it.
        if (published && finalAbs) {
          try {
            const removed = await cleanupOrphanPackageDir(finalAbs, packageSha256, (sql, params) =>
              pool.query(sql, params)
            );
            if (removed) published = false;
          } catch {
            /* best-effort orphan cleanup */
          }
        }
        if (stagingAbs) {
          await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
          stagingAbs = '';
        }
        if (error?.code === '23505') {
          const again = await findExistingImport(packageSha256, payload.regionId, payload.year);
          if (again) {
            const ensured = await ensureStructuredImportJob(again.reportId, again.versionId, true);
            return {
              reportId: again.reportId,
              versionId: again.versionId,
              jobId: ensured.jobId,
              packageSha256,
              storagePath: again.storagePath,
              reusedVersion: true,
              reusedJob: ensured.reusedJob,
              ingestionMode: 'structured_import',
            };
          }
          throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.PACKAGE_DUPLICATE);
        }
        if (error instanceof ReportUniqueConflictError || error?.code === 'REPORT_UNIQUE_CONFLICT') {
          // Not a package-content duplicate; distinct code for API clients.
          throw new StructuredPackageError(
            STRUCTURED_PACKAGE_ERROR_CODES.REPORT_IDENTITY_CONFLICT,
            'report already exists for region/year; retry import'
          );
        }
        throw error;
      } finally {
        client.release();
      }

      return {
        reportId,
        versionId,
        jobId,
        packageSha256,
        storagePath: pdfRel,
        reusedVersion: false,
        reusedJob: false,
        ingestionMode: 'structured_import',
      };
    } catch (error) {
      // Only remove staging; never touch a published final package directory
      if (stagingAbs && !published) {
        await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
        stagingAbs = '';
      }
      throw error;
    } finally {
      // Belt-and-suspenders: any leftover staging from early-return races
      if (stagingAbs && !published) {
        await fsp.rm(stagingAbs, { recursive: true, force: true }).catch(() => undefined);
      }
      if (validated?.extractDir) {
        await cleanupExtractDir(validated.extractDir);
      }
    }
  }

  /**
   * Worker: re-verify hashes, write parsed_json, enqueue materialize (checks via processMaterializeJob).
   * Does not mark job succeeded — LlmJobRunner marks structured_import succeeded after enqueueing materialize.
   * Never calls LLM.
   */
  async executeImportJob(job: {
    id: number;
    report_id: number;
    version_id: number;
  }): Promise<void> {
    const versionId = job.version_id;
    const reportId = job.report_id;

    const versionRes = await pool.query(
      `SELECT rv.id, rv.report_id, rv.package_sha256, rv.ingestion_mode, rv.parsed_json,
              a_pkg.storage_path AS package_path, a_pkg.sha256 AS package_sha256_artifact,
              a_pdf.storage_path AS pdf_path, a_pdf.sha256 AS pdf_sha256,
              a_md.storage_path AS md_path, a_md.sha256 AS md_sha256,
              a_json.storage_path AS json_path, a_json.sha256 AS json_sha256
       FROM report_versions rv
       LEFT JOIN report_version_artifacts a_pkg
         ON a_pkg.report_version_id = rv.id AND a_pkg.artifact_type = 'source_package'
       LEFT JOIN report_version_artifacts a_pdf
         ON a_pdf.report_version_id = rv.id AND a_pdf.artifact_type = 'source_pdf'
       LEFT JOIN report_version_artifacts a_md
         ON a_md.report_version_id = rv.id AND a_md.artifact_type = 'source_markdown'
       LEFT JOIN report_version_artifacts a_json
         ON a_json.report_version_id = rv.id AND a_json.artifact_type = 'source_json'
       WHERE rv.id = $1
       LIMIT 1`,
      [versionId]
    );
    const row = versionRes.rows[0];
    if (!row) {
      throw new Error(`report_version ${versionId} not found`);
    }
    if (String(row.ingestion_mode) !== 'structured_import') {
      throw new Error(`version ${versionId} is not structured_import (mode=${row.ingestion_mode})`);
    }

    const requirePath = (rel: string | null | undefined, code: StructuredPackageErrorCode, msg: string): string => {
      if (!rel) {
        throw new StructuredPackageError(code, msg);
      }
      const abs = resolveStorageAbsolute(String(rel));
      if (!fs.existsSync(abs)) {
        throw new StructuredPackageError(code, msg);
      }
      return abs;
    };

    const packageAbs = requirePath(
      row.package_path,
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
      'source package artifact missing'
    );
    const pdfAbs = requirePath(
      row.pdf_path,
      STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_PDF,
      'source.pdf artifact missing'
    );
    const mdAbs = requirePath(
      row.md_path,
      STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_MD,
      'source.md artifact missing'
    );
    const jsonAbs = requirePath(
      row.json_path,
      STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_JSON,
      'source.json artifact missing'
    );

    // Worker re-verify hashes against DB records
    const [actualPkg, actualPdf, actualMd, actualJson] = await Promise.all([
      hashFileSha256(packageAbs),
      hashFileSha256(pdfAbs),
      hashFileSha256(mdAbs),
      hashFileSha256(jsonAbs),
    ]);
    const expectedPkg = String(row.package_sha256 || row.package_sha256_artifact || '').toLowerCase();
    const expectedPdf = String(row.pdf_sha256 || '').toLowerCase();
    const expectedMd = String(row.md_sha256 || '').toLowerCase();
    const expectedJson = String(row.json_sha256 || '').toLowerCase();

    if (expectedPkg && expectedPkg !== actualPkg) {
      throw new StructuredPackageError(
        STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
        'package SHA256 mismatch on worker re-verify'
      );
    }
    if (expectedPdf && expectedPdf !== actualPdf) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH);
    }
    if (expectedMd && expectedMd !== actualMd) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MD_HASH_MISMATCH);
    }
    if (expectedJson && expectedJson !== actualJson) {
      throw new StructuredPackageError(
        STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
        'source.json SHA256 mismatch on worker re-verify'
      );
    }

    const envelope = loadSourceJsonFromFile(jsonAbs);
    // Re-check declared hashes vs files
    if (envelope.source.pdf_sha256.toLowerCase() !== actualPdf) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH);
    }
    if (envelope.source.markdown_sha256.toLowerCase() !== actualMd) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MD_HASH_MISMATCH);
    }

    const packageSha256 = expectedPkg || actualPkg;
    const imported = buildImportedParsedJson(envelope, {
      packageSha256,
      jsonSha256: actualJson,
    });
    if (!hasParsedContent(imported)) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE);
    }

    const config = buildParseConfigSnapshot({
      provider: PROVIDER_PLACEHOLDER,
      model: MODEL_PLACEHOLDER,
      promptVersion: PROMPT_VERSION,
      parserVersion: 'structured_import',
      sourceExtractorVersion: 'package',
      schemaVersion: STRUCTURED_PACKAGE_SCHEMA_VERSION,
      stabilizeMode: 'none',
      ruleGateEnabled: false,
    });

    // Idempotent: skip parse_run write if current accepted parsed_json already present
    let alreadyAccepted = false;
    if (hasParsedContent(row.parsed_json)) {
      const current = await parseRunService.getCurrentParsedResult(versionId).catch(() => null);
      if (current?.parsedJson && hasParsedContent(current.parsedJson)) {
        alreadyAccepted = true;
      }
    }

    if (!alreadyAccepted) {
      const created = await parseRunService.createParseRun({
        reportVersionId: versionId,
        // Critical: leave jobId null so finalize does not set structured_import=succeeded
        jobId: null,
        config,
        attempt: 1,
      });
      await parseRunService.markRunning(created.id);
      await parseRunService.finalizeParseRun({
        parseRunId: created.id,
        finalStatus: 'accepted',
        outputJson: imported,
        repairsJson: ['structured_import'],
        gateResultJson: {
          type: 'structured_import',
          passed: true,
          package_sha256: packageSha256,
        },
        consensusResultJson: null,
        sourceSnapshotsJson: [],
        // Materialize job is enqueued below; checks are enqueued by processMaterializeJob — do not race via queue
        enqueueFollowupJobs: false,
      });
    }

    // Enqueue formal materialize job; existing processMaterializeJob will enqueue checks.
    // This keeps structured_import aligned with the AI pipeline model (no fake 3-stage UI).
    const existingMat = await pool.query(
      `SELECT id FROM jobs
       WHERE report_id = $1 AND version_id = $2 AND kind = 'materialize'
         AND status IN ('queued', 'running', 'succeeded')
       ORDER BY id DESC LIMIT 1`,
      [reportId, versionId]
    );
    if (!existingMat.rows[0]?.id) {
      await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries)
         VALUES ($1, $2, 'materialize', 'queued', 60, 'MATERIALIZE', 'waiting materialize', 1)`,
        [reportId, versionId]
      );
    }
  }
}

export const structuredImportService = new StructuredImportService();
