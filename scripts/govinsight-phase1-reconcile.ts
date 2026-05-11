import pool from '../src/config/database-llm';

const METRIC_FIELDS = [
  'app_new',
  'app_carried_over',
  'app_carried_forward',
  'outcome_public',
  'outcome_partial',
  'outcome_not_open',
  'outcome_unable',
  'outcome_ignore',
  'outcome_other',
  'rev_total',
  'rev_corrected',
  'lit_total',
  'lit_corrected',
] as const;

function parseRegionId(): number | null {
  const raw = process.argv.find((arg) => arg.startsWith('--region='))?.split('=')[1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseYear(): number | null {
  const raw = process.argv.find((arg) => arg.startsWith('--year='))?.split('=')[1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

async function main(): Promise<void> {
  const regionId = parseRegionId();
  const year = parseYear();

  if (!regionId || !year) {
    throw new Error('Usage: ts-node scripts/govinsight-phase1-reconcile.ts --region=3201 --year=2024');
  }

  const legacyRes = await pool.query(
    `
    SELECT *
    FROM gov_open_annual_stats
    WHERE split_part(org_id, '_', 2) = $1 AND year = $2
    ORDER BY org_name ASC
    LIMIT 1
    `,
    [String(regionId), year]
  );

  const v2Res = await pool.query(
    `
    SELECT *
    FROM gov_open_annual_stats_v2
    WHERE region_id = $1 AND year = $2
    ORDER BY
      CASE materialize_status
        WHEN 'official' THEN 0
        WHEN 'preview' THEN 1
        ELSE 2
      END ASC,
      updated_at DESC
    LIMIT 1
    `,
    [regionId, year]
  );

  const legacy = legacyRes.rows[0];
  const v2 = v2Res.rows[0];

  if (!legacy) {
    throw new Error(`No legacy gov_open_annual_stats row found for region=${regionId}, year=${year}`);
  }

  if (!v2) {
    throw new Error(`No gov_open_annual_stats_v2 row found for region=${regionId}, year=${year}`);
  }

  const diffs = METRIC_FIELDS.map((field) => {
    const left = Number(legacy[field] ?? 0);
    const right = Number(v2[field] ?? 0);
    return {
      field,
      legacy: left,
      v2: right,
      delta: right - left,
      match: left === right,
    };
  });

  console.log(JSON.stringify({
    regionId,
    year,
    materializeStatus: v2.materialize_status,
    unitType: v2.unit_type,
    metricVersion: v2.metric_version,
    mappingVersion: v2.mapping_version,
    diffs,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('[govinsight-phase1-reconcile] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
