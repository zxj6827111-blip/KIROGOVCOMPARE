import fs from 'fs';
import path from 'path';
import pool from '../config/database-llm';
import { PROJECT_ROOT } from '../config/constants';

interface ParseJobRow {
  id: number;
  report_id: number | null;
  version_id: number | null;
  storage_path: string | null;
  created_at: string;
}

function resolveAbsoluteStoragePath(storagePath: string): string {
  if (path.isAbsolute(storagePath)) {
    return storagePath;
  }
  return path.resolve(PROJECT_ROOT, storagePath);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = Math.max(1, Number(limitArg?.split('=')[1] ?? 5000));

  const jobsRes = await pool.query(
    `SELECT
       j.id,
       j.report_id,
       j.version_id,
       rv.storage_path,
       j.created_at
     FROM jobs j
     JOIN report_versions rv ON rv.id = j.version_id
     WHERE j.kind = 'parse'
       AND j.status = 'queued'
     ORDER BY j.created_at ASC, j.id ASC
     LIMIT $1`,
    [limit]
  );

  const jobs = jobsRes.rows as ParseJobRow[];
  const missing: Array<ParseJobRow & { resolved_path: string }> = [];

  for (const job of jobs) {
    const storagePath = String(job.storage_path || '').trim();
    if (!storagePath) {
      missing.push({ ...job, resolved_path: '' });
      continue;
    }
    const resolved = resolveAbsoluteStoragePath(storagePath);
    if (!fs.existsSync(resolved)) {
      missing.push({ ...job, resolved_path: resolved });
    }
  }

  let updated = 0;
  if (apply && missing.length > 0) {
    await pool.query('BEGIN');
    try {
      for (const job of missing) {
        const message = job.resolved_path
          ? `source file missing: ${job.resolved_path}`
          : 'source file path missing';
        const updateRes = await pool.query(
          `UPDATE jobs
           SET status = 'failed',
               error_code = 'SOURCE_FILE_MISSING',
               error_message = $2,
               progress = 100,
               step_code = 'DONE',
               step_name = 'failed',
               finished_at = NOW()
           WHERE id = $1
             AND status = 'queued'`,
          [job.id, message]
        );
        updated += updateRes.rowCount ?? 0;
      }
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }

  const payload = {
    scanned: jobs.length,
    missing_source_jobs: missing.length,
    updated,
    apply,
    sample: missing.slice(0, 20),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error('[fail-missing-parse-jobs] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
