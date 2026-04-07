import pool from '../config/database-llm';

interface DuplicateGroup {
  region_id: number;
  year: number;
  duplicate_count: number;
}

interface ReportRow {
  id: number;
  region_id: number;
  year: number;
  unit_name: string;
  active_version_id: number | null;
  updated_at: string;
}

interface VersionRow {
  id: number;
  report_id: number;
  file_hash: string;
  created_at: string;
}

interface MergeStats {
  groupsProcessed: number;
  reportsMerged: number;
  reportsDeleted: number;
  versionsMoved: number;
  versionsDeduped: number;
  failedGroups: number;
}

const VERSION_REF_UPDATE_TABLES: Array<{ table: string; column: string }> = [
  { table: 'jobs', column: 'version_id' },
  { table: 'notifications', column: 'related_version_id' },
  { table: 'quality_issues', column: 'version_id' },
  { table: 'report_versions', column: 'parent_version_id' },
  { table: 'reports', column: 'active_version_id' },
  { table: 'derived_unit_year_metrics', column: 'version_id' },
  { table: 'derived_unit_year_metrics', column: 'active_version_id' },
];

const VERSION_REF_DELETE_TABLES: Array<{ table: string; column: string }> = [
  { table: 'cells', column: 'version_id' },
  { table: 'fact_active_disclosure', column: 'version_id' },
  { table: 'fact_application', column: 'version_id' },
  { table: 'fact_legal_proceeding', column: 'version_id' },
  { table: 'report_consistency_items', column: 'report_version_id' },
  { table: 'report_consistency_runs', column: 'report_version_id' },
  { table: 'report_version_parses', column: 'report_version_id' },
];

const REPORT_REF_UPDATE_TABLES: Array<{ table: string; column: string }> = [
  { table: 'jobs', column: 'report_id' },
  { table: 'quality_issues', column: 'report_id' },
  { table: 'fact_active_disclosure', column: 'report_id' },
  { table: 'fact_application', column: 'report_id' },
  { table: 'fact_legal_proceeding', column: 'report_id' },
  { table: 'comparisons', column: 'left_report_id' },
  { table: 'comparisons', column: 'right_report_id' },
];

async function getDuplicateGroups(limit?: number): Promise<DuplicateGroup[]> {
  const params: any[] = [];
  let limitClause = '';
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    params.push(Math.floor(limit));
    limitClause = `LIMIT $${params.length}`;
  }

  const result = await pool.query(
    `SELECT
       region_id::int AS region_id,
       year::int AS year,
       COUNT(*)::int AS duplicate_count
     FROM reports
     GROUP BY region_id, year
     HAVING COUNT(*) > 1
     ORDER BY duplicate_count DESC, region_id ASC, year ASC
     ${limitClause}`,
    params
  );
  return result.rows;
}

async function getReportsInGroup(regionId: number, year: number): Promise<ReportRow[]> {
  const result = await pool.query(
    `SELECT
       id::int AS id,
       region_id::int AS region_id,
       year::int AS year,
       unit_name,
       active_version_id::int AS active_version_id,
       updated_at::text AS updated_at
     FROM reports
     WHERE region_id = $1 AND year = $2
     ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC`,
    [regionId, year]
  );
  return result.rows;
}

async function getVersions(reportId: number): Promise<VersionRow[]> {
  const result = await pool.query(
    `SELECT
       id::int AS id,
       report_id::int AS report_id,
       file_hash,
       created_at::text AS created_at
     FROM report_versions
     WHERE report_id = $1
     ORDER BY created_at ASC, id ASC`,
    [reportId]
  );
  return result.rows;
}

async function remapVersionReferences(oldVersionId: number, newVersionId: number): Promise<void> {
  for (const ref of VERSION_REF_UPDATE_TABLES) {
    await pool.query(
      `UPDATE ${ref.table}
       SET ${ref.column} = $1
       WHERE ${ref.column} = $2`,
      [newVersionId, oldVersionId]
    );
  }
}

async function purgeVersionRows(oldVersionId: number): Promise<void> {
  for (const ref of VERSION_REF_DELETE_TABLES) {
    await pool.query(
      `DELETE FROM ${ref.table}
       WHERE ${ref.column} = $1`,
      [oldVersionId]
    );
  }
}

async function mergeGroup(group: DuplicateGroup, dryRun: boolean): Promise<{
  canonicalReportId: number;
  mergedReportIds: number[];
  movedVersions: number;
  dedupedVersions: number;
  deletedReports: number;
}> {
  const reports = await getReportsInGroup(group.region_id, group.year);
  if (reports.length < 2) {
    return {
      canonicalReportId: 0,
      mergedReportIds: [],
      movedVersions: 0,
      dedupedVersions: 0,
      deletedReports: 0,
    };
  }

  const canonical = reports[0];
  const duplicates = reports.slice(1);
  let movedVersions = 0;
  let dedupedVersions = 0;
  let deletedReports = 0;
  const mergedReportIds: number[] = [];

  if (dryRun) {
    return {
      canonicalReportId: canonical.id,
      mergedReportIds: duplicates.map((r) => r.id),
      movedVersions: duplicates.length,
      dedupedVersions: 0,
      deletedReports: duplicates.length,
    };
  }

  for (const duplicate of duplicates) {
    const duplicateVersions = await getVersions(duplicate.id);

    for (const version of duplicateVersions) {
      const existingInCanonical = await pool.query(
        `SELECT id::int
         FROM report_versions
         WHERE report_id = $1 AND file_hash = $2
         LIMIT 1`,
        [canonical.id, version.file_hash]
      );
      const conflictVersionId = existingInCanonical.rows[0]?.id as number | undefined;

      if (conflictVersionId && conflictVersionId !== version.id) {
        await remapVersionReferences(version.id, conflictVersionId);
        await purgeVersionRows(version.id);
        await pool.query('DELETE FROM report_versions WHERE id = $1', [version.id]);
        dedupedVersions += 1;
      } else {
        await pool.query(
          `UPDATE report_versions
           SET is_active = false,
               report_id = $1
           WHERE id = $2`,
          [canonical.id, version.id]
        );
        movedVersions += 1;
      }
    }

    for (const ref of REPORT_REF_UPDATE_TABLES) {
      await pool.query(
        `UPDATE ${ref.table}
         SET ${ref.column} = $1
         WHERE ${ref.column} = $2`,
        [canonical.id, duplicate.id]
      );
    }

    const canonicalMetricExists = await pool.query(
      'SELECT 1 FROM derived_unit_year_metrics WHERE report_id = $1 LIMIT 1',
      [canonical.id]
    );
    if (canonicalMetricExists.rows.length > 0) {
      await pool.query('DELETE FROM derived_unit_year_metrics WHERE report_id = $1', [duplicate.id]);
    } else {
      await pool.query(
        'UPDATE derived_unit_year_metrics SET report_id = $1 WHERE report_id = $2',
        [canonical.id, duplicate.id]
      );
    }

    await pool.query('DELETE FROM reports WHERE id = $1', [duplicate.id]);
    deletedReports += 1;
    mergedReportIds.push(duplicate.id);
  }

  const activeVersionRes = await pool.query(
    `SELECT id::int
     FROM report_versions
     WHERE report_id = $1
     ORDER BY (parsed_json IS NOT NULL AND parsed_json::text NOT IN ('{}', 'null', '\"\"')) DESC,
              created_at DESC,
              id DESC
     LIMIT 1`,
    [canonical.id]
  );
  const nextActiveVersionId = activeVersionRes.rows[0]?.id as number | undefined;

  await pool.query(
    `UPDATE reports
     SET active_version_id = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [nextActiveVersionId ?? null, canonical.id]
  );

  await pool.query(
    `UPDATE report_versions
     SET is_active = (id = $1)
     WHERE report_id = $2`,
    [nextActiveVersionId ?? null, canonical.id]
  );

  return {
    canonicalReportId: canonical.id,
    mergedReportIds,
    movedVersions,
    dedupedVersions,
    deletedReports,
  };
}

async function ensureUniqueIndex(): Promise<void> {
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_region_year
     ON reports(region_id, year)`
  );
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has('--apply');
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  const groups = await getDuplicateGroups(limit);
  const stats: MergeStats = {
    groupsProcessed: 0,
    reportsMerged: 0,
    reportsDeleted: 0,
    versionsMoved: 0,
    versionsDeduped: 0,
    failedGroups: 0,
  };

  console.log(`[merge-duplicate-reports] mode=${dryRun ? 'dry-run' : 'apply'}, duplicate_groups=${groups.length}`);

  for (const group of groups) {
    try {
      if (!dryRun) {
        await pool.query('BEGIN');
      }

      const merged = await mergeGroup(group, dryRun);

      if (!dryRun) {
        await pool.query('COMMIT');
      }

      stats.groupsProcessed += 1;
      stats.reportsMerged += merged.mergedReportIds.length;
      stats.reportsDeleted += merged.deletedReports;
      stats.versionsMoved += merged.movedVersions;
      stats.versionsDeduped += merged.dedupedVersions;

      console.log(
        JSON.stringify({
          region_id: group.region_id,
          year: group.year,
          canonical_report_id: merged.canonicalReportId,
          merged_report_ids: merged.mergedReportIds,
          moved_versions: merged.movedVersions,
          deduped_versions: merged.dedupedVersions,
          deleted_reports: merged.deletedReports,
          dry_run: dryRun,
        })
      );
    } catch (error: any) {
      if (!dryRun) {
        await pool.query('ROLLBACK');
      }
      stats.failedGroups += 1;
      console.error(
        `[merge-duplicate-reports] group failed region_id=${group.region_id}, year=${group.year}: ${error?.message || error}`
      );
    }
  }

  if (!dryRun && stats.failedGroups === 0) {
    try {
      await ensureUniqueIndex();
      console.log('[merge-duplicate-reports] ensured unique index uq_reports_region_year');
    } catch (error: any) {
      console.error(`[merge-duplicate-reports] failed to ensure unique index: ${error?.message || error}`);
    }
  }

  console.log(JSON.stringify({ dry_run: dryRun, stats }, null, 2));
}

main()
  .catch((error) => {
    console.error('[merge-duplicate-reports] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
