import fs from 'fs';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT } from '../config/constants';

export type SourceFileErrorCode = 'SOURCE_FILE_MISSING';

export interface SourceFileCheckResult {
  ok: boolean;
  storagePath: string | null;
  resolvedPath: string | null;
  errorCode?: SourceFileErrorCode;
  errorMessage?: string;
}

export interface VersionSourceFileCheckResult extends SourceFileCheckResult {
  versionId: number;
  reportId: number | null;
  fileName: string | null;
}

export function resolveAbsoluteStoragePath(storagePath: string): string {
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }

  const byProjectRoot = path.resolve(PROJECT_ROOT, storagePath);
  if (fs.existsSync(byProjectRoot)) {
    return byProjectRoot;
  }

  return path.resolve(process.cwd(), storagePath);
}

export function checkStoragePathExists(storagePath: string | null | undefined): SourceFileCheckResult {
  const normalized = typeof storagePath === 'string' ? storagePath.trim() : '';
  if (!normalized) {
    return {
      ok: false,
      storagePath: normalized || null,
      resolvedPath: null,
      errorCode: 'SOURCE_FILE_MISSING',
      errorMessage: 'source file path missing',
    };
  }

  const resolvedPath = resolveAbsoluteStoragePath(normalized);
  if (!fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      storagePath: normalized,
      resolvedPath,
      errorCode: 'SOURCE_FILE_MISSING',
      errorMessage: `source file missing: ${resolvedPath}`,
    };
  }

  return {
    ok: true,
    storagePath: normalized,
    resolvedPath,
  };
}

export async function checkVersionSourceFileExists(versionId: number): Promise<VersionSourceFileCheckResult | null> {
  const versionRes = await pool.query(
    `SELECT report_id, file_name, storage_path
     FROM report_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId]
  );
  const row = versionRes.rows[0];
  if (!row) {
    return null;
  }

  const checked = checkStoragePathExists(row.storage_path ?? null);
  return {
    versionId,
    reportId: row.report_id ?? null,
    fileName: row.file_name ?? null,
    ...checked,
  };
}
