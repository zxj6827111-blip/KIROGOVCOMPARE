import pool from '../config/database-llm';
import { checkStoragePathExists } from '../services/SourceFileGuardService';

type JsonRecord = Record<string, unknown>;

function printSection(title: string, payload: unknown): void {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(payload, null, 2));
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const asJson = args.has('--json');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const sampleLimit = Math.max(1, Number(limitArg?.split('=')[1] ?? 20));

  const duplicateGroupsRes = await pool.query(
    `SELECT
       r.region_id,
       reg.name AS region_name,
       r.year,
       COUNT(*)::int AS duplicate_count,
       SUM(CASE WHEN r.active_version_id IS NOT NULL THEN 1 ELSE 0 END)::int AS active_report_count,
       ARRAY_AGG(r.id ORDER BY (r.active_version_id IS NOT NULL) DESC, r.updated_at DESC, r.id DESC) AS report_ids
     FROM reports r
     LEFT JOIN regions reg ON reg.id = r.region_id
     GROUP BY r.region_id, reg.name, r.year
     HAVING COUNT(*) > 1
     ORDER BY duplicate_count DESC, r.region_id ASC, r.year ASC`
  );

  const unstableVersionCountRes = await pool.query(
    `SELECT COUNT(*)::int AS unstable_version_count
     FROM (
       SELECT report_version_id
       FROM report_version_parses
       GROUP BY report_version_id
       HAVING COUNT(DISTINCT md5(output_json::text)) > 1
     ) t`
  );

  const unstableSamplesRes = await pool.query(
    `SELECT
       p.report_version_id AS version_id,
       rv.report_id,
       r.region_id,
       r.year,
       COUNT(*)::int AS parse_count,
       COUNT(DISTINCT md5(p.output_json::text))::int AS distinct_output_count,
       MIN(p.created_at) AS first_parse_at,
       MAX(p.created_at) AS last_parse_at
     FROM report_version_parses p
     JOIN report_versions rv ON rv.id = p.report_version_id
     JOIN reports r ON r.id = rv.report_id
     GROUP BY p.report_version_id, rv.report_id, r.region_id, r.year
     HAVING COUNT(DISTINCT md5(p.output_json::text)) > 1
     ORDER BY distinct_output_count DESC, parse_count DESC, version_id DESC
     LIMIT $1`,
    [sampleLimit]
  );

  const missingActiveVersionRes = await pool.query(
    `SELECT
       r.id AS report_id,
       r.region_id,
       reg.name AS region_name,
       r.year,
       COUNT(rv.id)::int AS version_count
     FROM reports r
     JOIN report_versions rv ON rv.report_id = r.id
     LEFT JOIN regions reg ON reg.id = r.region_id
     WHERE r.active_version_id IS NULL
     GROUP BY r.id, r.region_id, reg.name, r.year
     ORDER BY version_count DESC, r.id DESC
     LIMIT $1`,
    [sampleLimit]
  );

  const missingActiveVersionCountRes = await pool.query(
    `SELECT COUNT(DISTINCT r.id)::int AS total
     FROM reports r
     JOIN report_versions rv ON rv.report_id = r.id
     WHERE r.active_version_id IS NULL`
  );

  const emptyActiveParsedRes = await pool.query(
    `SELECT
       r.id AS report_id,
       r.region_id,
       reg.name AS region_name,
       r.year,
       r.active_version_id
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
     LEFT JOIN regions reg ON reg.id = r.region_id
     WHERE rv.parsed_json IS NULL
        OR rv.parsed_json::text IN ('{}', 'null', '\"\"')
     ORDER BY r.id DESC
     LIMIT $1`,
    [sampleLimit]
  );

  const emptyActiveParsedCountRes = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
     WHERE rv.parsed_json IS NULL
        OR rv.parsed_json::text IN ('{}', 'null', '\"\"')`
  );

  const missingActiveFactsRes = await pool.query(
    `SELECT
       COUNT(*)::int AS total
     FROM reports r
     WHERE r.active_version_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM fact_active_disclosure fad
         WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_application fa
         WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM fact_legal_proceeding flp
         WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id
       )`
  );

  const activeVersionSourceRes = await pool.query(
    `SELECT
       r.id AS report_id,
       r.region_id,
       reg.name AS region_name,
       r.year,
       r.active_version_id,
       rv.storage_path
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
     LEFT JOIN regions reg ON reg.id = r.region_id
     WHERE r.active_version_id IS NOT NULL
     ORDER BY r.id DESC`
  );

  let activeVersionMissingSourceCount = 0;
  const activeVersionMissingSourceSamples: Array<Record<string, unknown>> = [];
  for (const row of activeVersionSourceRes.rows) {
    const sourceCheck = checkStoragePathExists(row.storage_path ?? null);
    if (sourceCheck.ok) {
      continue;
    }
    activeVersionMissingSourceCount += 1;
    if (activeVersionMissingSourceSamples.length < sampleLimit) {
      activeVersionMissingSourceSamples.push({
        report_id: row.report_id,
        region_id: row.region_id,
        region_name: row.region_name,
        year: row.year,
        active_version_id: row.active_version_id,
        storage_path: sourceCheck.storagePath,
        resolved_path: sourceCheck.resolvedPath,
        reason: sourceCheck.errorMessage,
      });
    }
  }

  const openIssuesRes = await pool.query(
    `SELECT severity, COUNT(*)::int AS count
     FROM quality_issues
     WHERE auto_status = 'open'
     GROUP BY severity
     ORDER BY count DESC, severity ASC`
  );

  const parseJobQueueRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE kind = 'parse' AND status = 'queued')::int AS parse_jobs_queued,
       COUNT(*) FILTER (WHERE kind = 'parse' AND status = 'running')::int AS parse_jobs_running
     FROM jobs`
  );

  const parseQueueTimingRes = await pool.query(
    `SELECT
       MIN(created_at) FILTER (WHERE kind = 'parse' AND status = 'queued') AS oldest_parse_queued_at,
       MAX(COALESCE(finished_at, started_at, created_at)) FILTER (
         WHERE kind = 'parse' AND status IN ('running', 'succeeded', 'failed', 'cancelled')
       ) AS last_parse_activity_at
     FROM jobs`
  );

  const queuedParseSamplesRes = await pool.query(
    `SELECT
       j.id AS job_id,
       j.report_id,
       j.version_id,
       j.created_at,
       r.region_id,
       reg.name AS region_name,
       r.year
     FROM jobs j
     LEFT JOIN reports r ON r.id = j.report_id
     LEFT JOIN regions reg ON reg.id = r.region_id
     WHERE j.kind = 'parse' AND j.status = 'queued'
     ORDER BY j.created_at ASC, j.id ASC
     LIMIT $1`,
    [sampleLimit]
  );

  const missingSourceJobsRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (
         WHERE kind = 'parse'
           AND status = 'queued'
           AND (
             error_code = 'SOURCE_FILE_MISSING'
             OR error_message ILIKE '%source file missing%'
             OR error_message ILIKE '%ENOENT%'
           )
       )::int AS queued_parse_jobs_missing_source,
       COUNT(*) FILTER (
         WHERE kind = 'parse'
           AND status = 'failed'
           AND error_code = 'SOURCE_FILE_MISSING'
       )::int AS failed_parse_jobs_missing_source
     FROM jobs`
  );

  const missingSourceSamplesRes = await pool.query(
    `SELECT
       j.id AS job_id,
       j.report_id,
       j.version_id,
       j.status,
       j.error_code,
       LEFT(COALESCE(j.error_message, ''), 260) AS error_message,
       j.created_at,
       j.started_at,
       j.finished_at
     FROM jobs j
     WHERE j.kind = 'parse'
       AND (
         j.error_code = 'SOURCE_FILE_MISSING'
         OR j.error_message ILIKE '%source file missing%'
         OR j.error_message ILIKE '%ENOENT%'
       )
     ORDER BY j.id DESC
     LIMIT $1`,
    [sampleLimit]
  );

  const parseJobsQueued = Number(parseJobQueueRes.rows[0]?.parse_jobs_queued ?? 0);
  const parseJobsRunning = Number(parseJobQueueRes.rows[0]?.parse_jobs_running ?? 0);
  const oldestQueuedAt = parseQueueTimingRes.rows[0]?.oldest_parse_queued_at
    ? new Date(parseQueueTimingRes.rows[0].oldest_parse_queued_at as string)
    : null;
  const lastParseActivityAt = parseQueueTimingRes.rows[0]?.last_parse_activity_at
    ? new Date(parseQueueTimingRes.rows[0].last_parse_activity_at as string)
    : null;
  const oldestQueuedAgeMinutes = oldestQueuedAt
    ? Math.round((Date.now() - oldestQueuedAt.getTime()) / 60000)
    : null;
  const parseWorkerLikelyStalled = parseJobsQueued > 0 && parseJobsRunning === 0;

  const summary: JsonRecord = {
    scanned_at: new Date().toISOString(),
    duplicate_report_groups: duplicateGroupsRes.rowCount,
    unstable_parse_versions: Number(unstableVersionCountRes.rows[0]?.unstable_version_count ?? 0),
    reports_missing_active_version_with_existing_versions: Number(missingActiveVersionCountRes.rows[0]?.total ?? 0),
    reports_with_empty_active_parsed_json: Number(emptyActiveParsedCountRes.rows[0]?.total ?? 0),
    reports_with_active_version_missing_all_facts: Number(missingActiveFactsRes.rows[0]?.total ?? 0),
    reports_with_active_version_missing_source_file: activeVersionMissingSourceCount,
    parse_jobs_queued: parseJobsQueued,
    parse_jobs_running: parseJobsRunning,
    parse_oldest_queued_at: oldestQueuedAt ? oldestQueuedAt.toISOString() : null,
    parse_oldest_queued_age_minutes: oldestQueuedAgeMinutes,
    parse_last_activity_at: lastParseActivityAt ? lastParseActivityAt.toISOString() : null,
    parse_worker_likely_stalled: parseWorkerLikelyStalled,
    queued_parse_jobs_missing_source: Number(missingSourceJobsRes.rows[0]?.queued_parse_jobs_missing_source ?? 0),
    failed_parse_jobs_missing_source: Number(missingSourceJobsRes.rows[0]?.failed_parse_jobs_missing_source ?? 0),
    open_quality_issues: openIssuesRes.rows,
  };

  const details: JsonRecord = {
    duplicate_groups: duplicateGroupsRes.rows.slice(0, sampleLimit),
    unstable_parse_samples: unstableSamplesRes.rows,
    reports_missing_active_version_samples: missingActiveVersionRes.rows,
    empty_active_parsed_samples: emptyActiveParsedRes.rows,
    active_version_missing_source_samples: activeVersionMissingSourceSamples,
    queued_parse_job_samples: queuedParseSamplesRes.rows,
    missing_source_job_samples: missingSourceSamplesRes.rows,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, details }, null, 2));
    return;
  }

  printSection('Integrity Summary', summary);
  printSection('Duplicate Groups (sample)', details.duplicate_groups);
  printSection('Unstable Parse Versions (sample)', details.unstable_parse_samples);
  printSection('Reports Missing Active Version (sample)', details.reports_missing_active_version_samples);
  printSection('Reports With Empty Active Parsed JSON (sample)', details.empty_active_parsed_samples);
  printSection('Reports With Active Version Missing Source File (sample)', details.active_version_missing_source_samples);
  printSection('Queued Parse Jobs (sample)', details.queued_parse_job_samples);
  printSection('Missing Source Parse Jobs (sample)', details.missing_source_job_samples);
}

main()
  .catch((error) => {
    console.error('[scan-system-integrity] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
