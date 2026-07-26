/**
 * Shared report identity helper used by PDF upload and structured import.
 */
import pool from '../config/database-llm';

export type Queryable = {
  query: (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
};

export class ReportUniqueConflictError extends Error {
  readonly code = 'REPORT_UNIQUE_CONFLICT';
  constructor() {
    super('report already exists for region/year');
    this.name = 'ReportUniqueConflictError';
  }
}

/**
 * Resolve existing report for (region_id, year) or create one.
 * Matches production uniqueness uq_reports_region_year.
 *
 * IMPORTANT: On unique violation inside a multi-statement transaction, PostgreSQL
 * aborts the transaction. We rethrow ReportUniqueConflictError so the caller can
 * ROLLBACK and re-query with a fresh client/pool — never continue on the aborted client.
 */
export async function resolveOrCreateReport(
  regionId: number,
  year: number,
  unitName: string,
  client: Queryable = pool
): Promise<{ id: number }> {
  const existingResult = await client.query(
    `SELECT id, unit_name
     FROM reports
     WHERE region_id = $1 AND year = $2
     ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [regionId, year]
  );

  const existing = existingResult.rows[0];
  if (existing?.id) {
    await client.query(
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
    const insertResult = await client.query(
      `INSERT INTO reports (region_id, year, unit_name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [regionId, year, unitName]
    );
    return { id: Number(insertResult.rows[0].id) };
  } catch (error: any) {
    if (error?.code === '23505') {
      // Do NOT query on the same transactional client after 23505 (25P02).
      throw new ReportUniqueConflictError();
    }
    throw error;
  }
}

/** Fresh-pool lookup after ReportUniqueConflictError / concurrent create. */
export async function findReportIdByRegionYear(
  regionId: number,
  year: number,
  client: Queryable = pool
): Promise<number | null> {
  const concurrentResult = await client.query(
    `SELECT id
     FROM reports
     WHERE region_id = $1 AND year = $2
     ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC
     LIMIT 1`,
    [regionId, year]
  );
  return concurrentResult.rows[0]?.id ? Number(concurrentResult.rows[0].id) : null;
}
