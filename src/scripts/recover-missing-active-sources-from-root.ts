import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT, UPLOADS_DIR } from '../config/constants';
import { checkStoragePathExists, resolveAbsoluteStoragePath } from '../services/SourceFileGuardService';

type MissingActiveRow = {
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
  | 'already_present'
  | 'exact_basename_unique'
  | 'hash_same_ext_unique'
  | 'hash_ext_mismatch_unique'
  | 'ambiguous'
  | 'missing';

type RecoveryDetail = {
  report_id: number;
  version_id: number;
  region_id: number | null;
  region_name: string | null;
  year: number | null;
  file_name: string | null;
  file_hash: string | null;
  storage_path: string;
  expected_abs_path: string;
  status: 'ok' | 'recoverable' | 'copied' | 'ext_mismatch' | 'ambiguous' | 'unresolved' | 'copy_failed';
  resolve_mode: ResolveMode;
  candidate_count: number;
  candidate_path: string;
  candidate_paths: string[];
  reason: string;
};

type CandidateFile = {
  absPath: string;
  fileName: string;
  ext: string;
  hashStem: string | null;
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function collectArgs(name: string): string[] {
  const prefix = `--${name}=`;
  return process.argv
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length).trim())
    .filter(Boolean);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
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

function normalizeHash(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function pickHashCandidates(row: MissingActiveRow): string[] {
  const hashes = new Set<string>();
  const fileHash = normalizeHash(row.file_hash);
  if (fileHash) {
    hashes.add(fileHash);
  }
  const baseName = path.basename(String(row.storage_path || ''));
  const matched = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(baseName);
  if (matched?.[1]) {
    hashes.add(matched[1].toLowerCase());
  }
  return Array.from(hashes);
}

function shouldSkipDir(name: string): boolean {
  return /^(node_modules|\.git|dist|output|tmp|coverage)$/i.test(name);
}

async function loadMissingActiveVersions(): Promise<MissingActiveRow[]> {
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
     ORDER BY r.id ASC`
  );

  return (result.rows as MissingActiveRow[]).filter((row) => !checkStoragePathExists(row.storage_path).ok);
}

function buildIndexes(searchRoots: string[]): {
  basenameIndex: Map<string, CandidateFile[]>;
  hashIndex: Map<string, CandidateFile[]>;
} {
  const basenameIndex = new Map<string, CandidateFile[]>();
  const hashIndex = new Map<string, CandidateFile[]>();

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }

    const stack = [root];
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
          if (!shouldSkipDir(entry.name)) {
            stack.push(fullPath);
          }
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const candidate: CandidateFile = {
          absPath: path.resolve(fullPath),
          fileName: entry.name,
          ext: path.extname(entry.name).toLowerCase(),
          hashStem: null,
        };

        const basenameKey = entry.name.toLowerCase();
        const basenameList = basenameIndex.get(basenameKey) || [];
        basenameList.push(candidate);
        basenameIndex.set(basenameKey, basenameList);

        const hashMatch = /^([0-9a-f]{64})\.[^\\/]+$/i.exec(entry.name);
        if (hashMatch?.[1]) {
          candidate.hashStem = hashMatch[1].toLowerCase();
          const hashList = hashIndex.get(candidate.hashStem) || [];
          hashList.push(candidate);
          hashIndex.set(candidate.hashStem, hashList);
        }
      }
    }
  }

  return { basenameIndex, hashIndex };
}

function uniqueCandidates(candidates: CandidateFile[]): CandidateFile[] {
  const mapping = new Map<string, CandidateFile>();
  for (const candidate of candidates) {
    mapping.set(candidate.absPath.toLowerCase(), candidate);
  }
  return Array.from(mapping.values());
}

function resolveCandidate(
  row: MissingActiveRow,
  basenameIndex: Map<string, CandidateFile[]>,
  hashIndex: Map<string, CandidateFile[]>
): { mode: ResolveMode; candidates: CandidateFile[]; reason: string } {
  const expectedBaseName = path.basename(String(row.storage_path || '')).toLowerCase();
  const expectedExt = path.extname(expectedBaseName).toLowerCase();

  const exactMatches = uniqueCandidates(basenameIndex.get(expectedBaseName) || []);
  if (exactMatches.length === 1) {
    return {
      mode: 'exact_basename_unique',
      candidates: exactMatches,
      reason: 'exact_basename_unique',
    };
  }
  if (exactMatches.length > 1) {
    return {
      mode: 'ambiguous',
      candidates: exactMatches,
      reason: `exact_basename_ambiguous:${exactMatches.length}`,
    };
  }

  const hashMatches = uniqueCandidates(
    pickHashCandidates(row).flatMap((hash) => hashIndex.get(hash) || [])
  );
  const sameExtMatches = hashMatches.filter((candidate) => candidate.ext === expectedExt);
  if (sameExtMatches.length === 1) {
    return {
      mode: 'hash_same_ext_unique',
      candidates: sameExtMatches,
      reason: 'hash_same_ext_unique',
    };
  }
  if (sameExtMatches.length > 1) {
    return {
      mode: 'ambiguous',
      candidates: sameExtMatches,
      reason: `hash_same_ext_ambiguous:${sameExtMatches.length}`,
    };
  }
  if (hashMatches.length === 1) {
    return {
      mode: 'hash_ext_mismatch_unique',
      candidates: hashMatches,
      reason: 'hash_ext_mismatch_unique',
    };
  }
  if (hashMatches.length > 1) {
    return {
      mode: 'ambiguous',
      candidates: hashMatches,
      reason: `hash_ambiguous:${hashMatches.length}`,
    };
  }

  return {
    mode: 'missing',
    candidates: [],
    reason: 'no_candidate_found_in_search_roots',
  };
}

async function main(): Promise<void> {
  const copy = hasFlag('copy');
  const allowExtMismatch = hasFlag('allow-ext-mismatch');
  const outDir = path.isAbsolute(parseArg('out-dir') || '')
    ? (parseArg('out-dir') as string)
    : path.resolve(process.cwd(), parseArg('out-dir') || 'tmp');
  const extraRoots = collectArgs('search-root');
  const searchRoots = Array.from(
    new Set(
      [UPLOADS_DIR, ...extraRoots]
        .map((item) => (path.isAbsolute(item) ? item : path.resolve(PROJECT_ROOT, item)))
        .filter(Boolean)
    )
  );

  await fsp.mkdir(outDir, { recursive: true });

  const rows = await loadMissingActiveVersions();
  const { basenameIndex, hashIndex } = buildIndexes(searchRoots);
  const details: RecoveryDetail[] = [];

  const summary = {
    scanned_missing_active_versions: rows.length,
    search_roots: searchRoots,
    already_present: 0,
    recoverable_exact_basename_unique: 0,
    recoverable_hash_same_ext_unique: 0,
    recoverable_hash_ext_mismatch_unique: 0,
    ambiguous: 0,
    unresolved: 0,
    copied: 0,
    copy_failed: 0,
    copy,
    allow_ext_mismatch: allowExtMismatch,
  };

  for (const row of rows) {
    const checked = checkStoragePathExists(row.storage_path);
    const expectedAbsPath = resolveAbsoluteStoragePath(row.storage_path);

    if (checked.ok) {
      summary.already_present += 1;
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        region_id: row.region_id,
        region_name: row.region_name,
        year: row.year,
        file_name: row.file_name,
        file_hash: row.file_hash,
        storage_path: row.storage_path,
        expected_abs_path: expectedAbsPath,
        status: 'ok',
        resolve_mode: 'already_present',
        candidate_count: 1,
        candidate_path: checked.resolvedPath || '',
        candidate_paths: checked.resolvedPath ? [checked.resolvedPath] : [],
        reason: 'already_present',
      });
      continue;
    }

    const resolved = resolveCandidate(row, basenameIndex, hashIndex);
    const primaryCandidate = resolved.candidates[0]?.absPath || '';

    if (resolved.mode === 'exact_basename_unique') {
      summary.recoverable_exact_basename_unique += 1;
    } else if (resolved.mode === 'hash_same_ext_unique') {
      summary.recoverable_hash_same_ext_unique += 1;
    } else if (resolved.mode === 'hash_ext_mismatch_unique') {
      summary.recoverable_hash_ext_mismatch_unique += 1;
    } else if (resolved.mode === 'ambiguous') {
      summary.ambiguous += 1;
    } else if (resolved.mode === 'missing') {
      summary.unresolved += 1;
    }

    const safeToCopy =
      resolved.mode === 'exact_basename_unique' ||
      resolved.mode === 'hash_same_ext_unique' ||
      (allowExtMismatch && resolved.mode === 'hash_ext_mismatch_unique');

    if (!copy || !safeToCopy || resolved.candidates.length !== 1) {
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        region_id: row.region_id,
        region_name: row.region_name,
        year: row.year,
        file_name: row.file_name,
        file_hash: row.file_hash,
        storage_path: row.storage_path,
        expected_abs_path: expectedAbsPath,
        status:
          resolved.mode === 'hash_ext_mismatch_unique' && !allowExtMismatch
            ? 'ext_mismatch'
            : resolved.mode === 'ambiguous'
              ? 'ambiguous'
              : resolved.mode === 'missing'
                ? 'unresolved'
                : 'recoverable',
        resolve_mode: resolved.mode,
        candidate_count: resolved.candidates.length,
        candidate_path: primaryCandidate,
        candidate_paths: resolved.candidates.map((item) => item.absPath),
        reason: resolved.reason,
      });
      continue;
    }

    try {
      await fsp.mkdir(path.dirname(expectedAbsPath), { recursive: true });
      await fsp.copyFile(primaryCandidate, expectedAbsPath);
      summary.copied += 1;
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        region_id: row.region_id,
        region_name: row.region_name,
        year: row.year,
        file_name: row.file_name,
        file_hash: row.file_hash,
        storage_path: row.storage_path,
        expected_abs_path: expectedAbsPath,
        status: 'copied',
        resolve_mode: resolved.mode,
        candidate_count: 1,
        candidate_path: primaryCandidate,
        candidate_paths: [primaryCandidate],
        reason: resolved.reason,
      });
    } catch (error: any) {
      summary.copy_failed += 1;
      details.push({
        report_id: row.report_id,
        version_id: row.version_id,
        region_id: row.region_id,
        region_name: row.region_name,
        year: row.year,
        file_name: row.file_name,
        file_hash: row.file_hash,
        storage_path: row.storage_path,
        expected_abs_path: expectedAbsPath,
        status: 'copy_failed',
        resolve_mode: resolved.mode,
        candidate_count: 1,
        candidate_path: primaryCandidate,
        candidate_paths: [primaryCandidate],
        reason: error?.message || 'copy_failed',
      });
    }
  }

  const timestamp = buildTimestamp();
  const summaryPath = path.join(outDir, `missing_active_sources_recovery_summary_${timestamp}.json`);
  const detailJsonPath = path.join(outDir, `missing_active_sources_recovery_details_${timestamp}.json`);
  const detailCsvPath = path.join(outDir, `missing_active_sources_recovery_details_${timestamp}.csv`);

  const csvHeaders = [
    'report_id',
    'version_id',
    'region_id',
    'region_name',
    'year',
    'file_name',
    'file_hash',
    'storage_path',
    'expected_abs_path',
    'status',
    'resolve_mode',
    'candidate_count',
    'candidate_path',
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
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[recover-missing-active-sources-from-root] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
