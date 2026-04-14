import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_DIR } from '../config/constants';
import { checkStoragePathExists } from '../services/SourceFileGuardService';

type ActiveVersionRow = {
  report_id: number;
  version_id: number;
  region_id: number | null;
  region_name: string | null;
  year: number | null;
  file_name: string | null;
  file_hash: string | null;
  storage_path: string;
};

type ResolveMode =
  | 'storage_path'
  | 'file_hash_unique'
  | 'storage_basename_hash_unique'
  | 'ambiguous_hash_matches'
  | 'missing';

type RepairDetail = {
  report_id: number;
  version_id: number;
  region_id: number | null;
  region_name: string | null;
  year: number | null;
  file_name: string | null;
  file_hash: string | null;
  old_storage_path: string;
  old_resolved_path: string | null;
  status: 'ok' | 'repairable' | 'repaired' | 'ambiguous' | 'unresolved' | 'update_failed';
  resolve_mode: ResolveMode;
  candidate_count: number;
  candidate_storage_path: string;
  candidate_resolved_path: string;
  reason: string;
};

type ResolveResult = {
  mode: ResolveMode;
  absPath: string | null;
  candidateCount: number;
  reason: string;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function normalizePathForDb(absPath: string): string {
  const relative = path.relative(PROJECT_ROOT, absPath);
  return relative.replace(/\\/g, '/');
}

function buildUploadHashIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  if (!fs.existsSync(rootDir)) {
    return index;
  }

  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const matched = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(entry.name);
      if (!matched) {
        continue;
      }

      const hash = matched[1].toLowerCase();
      const list = index.get(hash) || [];
      list.push(fullPath);
      index.set(hash, list);
    }
  }

  return index;
}

function pickHashCandidates(row: ActiveVersionRow): Array<{ hash: string; mode: ResolveMode }> {
  const candidates: Array<{ hash: string; mode: ResolveMode }> = [];

  const fileHash = String(row.file_hash || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(fileHash)) {
    candidates.push({ hash: fileHash, mode: 'file_hash_unique' });
  }

  const baseName = path.basename(String(row.storage_path || ''));
  const baseMatch = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(baseName);
  if (baseMatch) {
    const hash = baseMatch[1].toLowerCase();
    if (!candidates.some((item) => item.hash === hash)) {
      candidates.push({ hash, mode: 'storage_basename_hash_unique' });
    }
  }

  return candidates;
}

function resolveMissingSource(
  row: ActiveVersionRow,
  hashIndex: Map<string, string[]>
): ResolveResult {
  const checked = checkStoragePathExists(row.storage_path);
  if (checked.ok) {
    return {
      mode: 'storage_path',
      absPath: checked.resolvedPath,
      candidateCount: 1,
      reason: 'storage_path_exists',
    };
  }

  for (const candidate of pickHashCandidates(row)) {
    const matches = Array.from(
      new Set(
        (hashIndex.get(candidate.hash) || [])
          .filter((item) => fs.existsSync(item))
          .map((item) => path.resolve(item))
      )
    );

    if (matches.length === 1) {
      return {
        mode: candidate.mode,
        absPath: matches[0],
        candidateCount: 1,
        reason: candidate.mode,
      };
    }

    if (matches.length > 1) {
      return {
        mode: 'ambiguous_hash_matches',
        absPath: null,
        candidateCount: matches.length,
        reason: `${candidate.mode}: ${matches.length} matches`,
      };
    }
  }

  return {
    mode: 'missing',
    absPath: null,
    candidateCount: 0,
    reason: checked.errorMessage || 'missing_source_file',
  };
}

async function loadActiveVersions(limit: number): Promise<ActiveVersionRow[]> {
  const result = await pool.query(
    `SELECT
       r.id::int AS report_id,
       rv.id::int AS version_id,
       r.region_id::int AS region_id,
       reg.name AS region_name,
       r.year::int AS year,
       rv.file_name,
       rv.file_hash,
       rv.storage_path
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
     LEFT JOIN regions reg ON reg.id = r.region_id
     WHERE r.active_version_id IS NOT NULL
     ORDER BY r.id ASC
     LIMIT $1`,
    [limit]
  );
  return result.rows as ActiveVersionRow[];
}

async function main(): Promise<void> {
  const apply = hasFlag('apply');
  const limit = toInt(parseArg('limit'), 100000);
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);
  await fsp.mkdir(outDir, { recursive: true });

  const rows = await loadActiveVersions(limit);
  const hashIndex = buildUploadHashIndex(UPLOADS_DIR);
  const details: RepairDetail[] = [];

  const summary = {
    scanned_active_versions: rows.length,
    missing_before: 0,
    ok_already: 0,
    repairable_by_file_hash_unique: 0,
    repairable_by_storage_basename_hash_unique: 0,
    repaired: 0,
    update_failed: 0,
    ambiguous_hash_matches: 0,
    unresolved_missing: 0,
    apply,
  };

  for (const row of rows) {
    const checked = checkStoragePathExists(row.storage_path);
    const baseDetail: Omit<RepairDetail, 'status' | 'resolve_mode' | 'candidate_count' | 'candidate_storage_path' | 'candidate_resolved_path' | 'reason'> = {
      report_id: row.report_id,
      version_id: row.version_id,
      region_id: row.region_id,
      region_name: row.region_name,
      year: row.year,
      file_name: row.file_name,
      file_hash: row.file_hash,
      old_storage_path: row.storage_path,
      old_resolved_path: checked.resolvedPath,
    };

    if (checked.ok) {
      summary.ok_already += 1;
      details.push({
        ...baseDetail,
        status: 'ok',
        resolve_mode: 'storage_path',
        candidate_count: 1,
        candidate_storage_path: row.storage_path,
        candidate_resolved_path: checked.resolvedPath || '',
        reason: 'storage_path_exists',
      });
      continue;
    }

    summary.missing_before += 1;
    const resolved = resolveMissingSource(row, hashIndex);
    const nextStoragePath = resolved.absPath ? normalizePathForDb(resolved.absPath) : '';

    if (resolved.mode === 'file_hash_unique') {
      summary.repairable_by_file_hash_unique += 1;
    } else if (resolved.mode === 'storage_basename_hash_unique') {
      summary.repairable_by_storage_basename_hash_unique += 1;
    } else if (resolved.mode === 'ambiguous_hash_matches') {
      summary.ambiguous_hash_matches += 1;
    } else if (resolved.mode === 'missing') {
      summary.unresolved_missing += 1;
    }

    if (!resolved.absPath) {
      details.push({
        ...baseDetail,
        status: resolved.mode === 'ambiguous_hash_matches' ? 'ambiguous' : 'unresolved',
        resolve_mode: resolved.mode,
        candidate_count: resolved.candidateCount,
        candidate_storage_path: '',
        candidate_resolved_path: '',
        reason: resolved.reason,
      });
      continue;
    }

    if (!apply) {
      details.push({
        ...baseDetail,
        status: 'repairable',
        resolve_mode: resolved.mode,
        candidate_count: resolved.candidateCount,
        candidate_storage_path: nextStoragePath,
        candidate_resolved_path: resolved.absPath,
        reason: resolved.reason,
      });
      continue;
    }

    try {
      await pool.query(
        `UPDATE report_versions
         SET storage_path = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextStoragePath, row.version_id]
      );
      summary.repaired += 1;
      details.push({
        ...baseDetail,
        status: 'repaired',
        resolve_mode: resolved.mode,
        candidate_count: resolved.candidateCount,
        candidate_storage_path: nextStoragePath,
        candidate_resolved_path: resolved.absPath,
        reason: resolved.reason,
      });
    } catch (error: any) {
      summary.update_failed += 1;
      details.push({
        ...baseDetail,
        status: 'update_failed',
        resolve_mode: resolved.mode,
        candidate_count: resolved.candidateCount,
        candidate_storage_path: nextStoragePath,
        candidate_resolved_path: resolved.absPath,
        reason: error?.message || 'update_failed',
      });
    }
  }

  const timestamp = buildTimestamp();
  const summaryPath = path.join(outDir, `missing_active_sources_repair_summary_${timestamp}.json`);
  const detailJsonPath = path.join(outDir, `missing_active_sources_repair_details_${timestamp}.json`);
  const detailCsvPath = path.join(outDir, `missing_active_sources_repair_details_${timestamp}.csv`);

  const csvHeaders = [
    'report_id',
    'version_id',
    'region_id',
    'region_name',
    'year',
    'file_name',
    'file_hash',
    'old_storage_path',
    'old_resolved_path',
    'status',
    'resolve_mode',
    'candidate_count',
    'candidate_storage_path',
    'candidate_resolved_path',
    'reason',
  ];

  await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fsp.writeFile(detailJsonPath, `${JSON.stringify(details, null, 2)}\n`, 'utf8');
  await fsp.writeFile(detailCsvPath, toCsv(details, csvHeaders), 'utf8');

  console.log(
    JSON.stringify(
      {
        summary,
        outputs: {
          summary_json: summaryPath,
          details_json: detailJsonPath,
          details_csv: detailCsvPath,
        },
        sample: details.filter((item) => item.status !== 'ok').slice(0, 20),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[repair-missing-active-sources] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
