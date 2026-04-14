import pool from '../config/database-llm';
import { materializeService } from '../services/data-center/MaterializeService';

type MissingActiveRow = {
  report_id: number;
  version_id: number;
  parsed_empty: boolean;
};

async function loadMissingActiveFacts(limit: number): Promise<MissingActiveRow[]> {
  const result = await pool.query(
    `SELECT
       r.id::int AS report_id,
       r.active_version_id::int AS version_id,
       (rv.parsed_json IS NULL OR rv.parsed_json::text IN ('{}', 'null', '\"\"')) AS parsed_empty
     FROM reports r
     JOIN report_versions rv ON rv.id = r.active_version_id
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
       )
     ORDER BY r.id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as MissingActiveRow[];
}

async function countMissingActiveFacts(): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total
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
  return Number(result.rows[0]?.total ?? 0);
}

async function switchActiveToFactVersion(apply: boolean): Promise<number> {
  const switcheableWhere = `
    r.active_version_id IS NOT NULL
    AND NOT (
      EXISTS (SELECT 1 FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = r.active_version_id)
      OR EXISTS (SELECT 1 FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = r.active_version_id)
      OR EXISTS (SELECT 1 FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = r.active_version_id)
    )
    AND EXISTS (
      SELECT 1
      FROM report_versions rv
      WHERE rv.report_id = r.id
        AND (
          EXISTS (SELECT 1 FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = rv.id)
          OR EXISTS (SELECT 1 FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = rv.id)
          OR EXISTS (SELECT 1 FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = rv.id)
        )
    )
  `;

  if (!apply) {
    const preview = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM reports r
       WHERE ${switcheableWhere}`
    );
    return Number(preview.rows[0]?.total ?? 0);
  }

  const result = await pool.query(
    `UPDATE reports r
     SET active_version_id = (
       SELECT rv.id
       FROM report_versions rv
       WHERE rv.report_id = r.id
         AND (
           EXISTS (SELECT 1 FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = rv.id)
           OR EXISTS (SELECT 1 FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = rv.id)
           OR EXISTS (SELECT 1 FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = rv.id)
         )
       ORDER BY rv.created_at DESC, rv.id DESC
       LIMIT 1
     )
     WHERE ${switcheableWhere}
     RETURNING id`
  );
  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = Math.max(1, Number(limitArg?.split('=')[1] ?? 2000));

  const beforeMissing = await countMissingActiveFacts();
  const rows = await loadMissingActiveFacts(limit);

  let parsedEmpty = 0;
  let materializeCandidates = 0;
  let materializedOk = 0;
  let materializedFailed = 0;

  for (const row of rows) {
    if (row.parsed_empty) {
      parsedEmpty += 1;
      continue;
    }

    materializeCandidates += 1;
    if (!apply) continue;

    const result = await materializeService.materializeVersion(row.version_id);
    if (result.success && result.factsCreated > 0) {
      materializedOk += 1;
    } else {
      materializedFailed += 1;
    }
  }

  const switchedActive = await switchActiveToFactVersion(apply);
  const afterMissing = await countMissingActiveFacts();

  console.log(
    JSON.stringify(
      {
        apply,
        limit,
        before_missing_active_facts: beforeMissing,
        scanned_missing_active: rows.length,
        parsed_empty: parsedEmpty,
        materialize_candidates: materializeCandidates,
        materialized_ok: materializedOk,
        materialized_failed: materializedFailed,
        switched_active_to_fact_version: switchedActive,
        after_missing_active_facts: afterMissing,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[repair-active-facts] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
