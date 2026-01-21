import pool from '../config/database-llm';

const MATERIALIZE_SUCCESS = new Set(['done', 'succeeded', 'success']);

interface DerivedOptions {
  year?: number;
  regionId?: number;
}

interface ReportRow {
  id: number;
  region_id: number | null;
  unit_name: string | null;
  year: number | null;
  active_version_id: number | null;
}

interface IssueCountRow {
  report_id: number;
  version_id: number;
  severity: string;
  count: number;
}

interface FactCountRow {
  report_id: number;
  version_id: number;
  count: number;
}

interface FactSumRow {
  report_id: number;
  version_id: number;
  total: number;
}

interface JobStatusRow {
  report_id: number;
  version_id: number;
  status: string;
}

function buildKey(reportId: number, versionId: number): string {
  return `${reportId}-${versionId}`;
}

function parseNumber(input: any): number {
  const num = Number(input);
  return Number.isFinite(num) ? num : 0;
}

export class DerivedMetricsService {
  static async run(options: DerivedOptions): Promise<{ unitUpserts: number; regionUpserts: number }> {
    const conditions: string[] = ['active_version_id IS NOT NULL'];
    const params: any[] = [];
    if (options.year) {
      params.push(options.year);
      conditions.push(`year = $${params.length}`);
    }
    if (options.regionId) {
      params.push(options.regionId);
      conditions.push(`region_id = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const reportsRes = await pool.query(
      `SELECT id, region_id, unit_name, year, active_version_id
       FROM reports
       ${whereClause}
       ORDER BY id ASC`,
      params
    );
    const reports = reportsRes.rows as ReportRow[];

    if (reports.length === 0) {
      return { unitUpserts: 0, regionUpserts: 0 };
    }

    const reportIds = reports.map((r) => r.id);
    const versionIds = reports.map((r) => r.active_version_id).filter((id): id is number => !!id);

    // If there are too many IDs, splitting into chunks might be better, but for now we assume they fit in query
    // BUT since we are doing manual string interpolation for IN clause (pg doesn't support array parameters for IN easily without ANY), 
    // let's just loop or use ANY($1). Using ANY($1::int[]) is better.

    const reportIdsParams = [reportIds];
    const versionIdsParams = [versionIds];

    const issueCountsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, severity, COUNT(*) as count
         FROM quality_issues
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
         GROUP BY report_id, version_id, severity`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const issueCounts = issueCountsRes.rows as IssueCountRow[];

    const activeDisclosureCountsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, COUNT(*) as count
         FROM fact_active_disclosure
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
         GROUP BY report_id, version_id`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const activeDisclosureCounts = activeDisclosureCountsRes.rows as FactCountRow[];

    const applicationCountsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, COUNT(*) as count
         FROM fact_application
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
         GROUP BY report_id, version_id`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const applicationCounts = applicationCountsRes.rows as FactCountRow[];

    const legalCountsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, COUNT(*) as count
         FROM fact_legal_proceeding
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
         GROUP BY report_id, version_id`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const legalCounts = legalCountsRes.rows as FactCountRow[];

    const applicationTotalsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, SUM(count) as total
         FROM fact_application
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
           AND response_type = 'new_received'
         GROUP BY report_id, version_id`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const applicationTotals = applicationTotalsRes.rows as FactSumRow[];

    const legalTotalsRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, SUM(count) as total
         FROM fact_legal_proceeding
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
           AND result_type = 'total'
         GROUP BY report_id, version_id`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const legalTotals = legalTotalsRes.rows as FactSumRow[];

    const jobStatusesRes = reportIds.length
      ? await pool.query(
        `SELECT report_id, version_id, status
         FROM jobs
         WHERE report_id = ANY($1::int[])
           AND version_id = ANY($2::int[])
           AND kind = 'materialize'
         ORDER BY id DESC`,
        [reportIds, versionIds]
      )
      : { rows: [] };
    const jobStatuses = jobStatusesRes.rows as JobStatusRow[];

    const issueMap = new Map<string, { total: number; high: number; medium: number; low: number }>();
    issueCounts.forEach((row) => {
      const key = buildKey(row.report_id, row.version_id);
      if (!issueMap.has(key)) {
        issueMap.set(key, { total: 0, high: 0, medium: 0, low: 0 });
      }
      const entry = issueMap.get(key)!;
      const count = parseNumber(row.count);
      entry.total += count;
      const severity = String(row.severity || '').toLowerCase();
      if (severity === 'high' || severity === 'critical') {
        entry.high += count;
      } else if (severity === 'medium') {
        entry.medium += count;
      } else {
        entry.low += count;
      }
    });

    const activeDisclosureMap = new Map<string, number>();
    activeDisclosureCounts.forEach((row) => {
      activeDisclosureMap.set(buildKey(row.report_id, row.version_id), parseNumber(row.count));
    });

    const applicationMap = new Map<string, number>();
    applicationCounts.forEach((row) => {
      applicationMap.set(buildKey(row.report_id, row.version_id), parseNumber(row.count));
    });

    const legalMap = new Map<string, number>();
    legalCounts.forEach((row) => {
      legalMap.set(buildKey(row.report_id, row.version_id), parseNumber(row.count));
    });

    const applicationTotalMap = new Map<string, number>();
    applicationTotals.forEach((row) => {
      applicationTotalMap.set(buildKey(row.report_id, row.version_id), parseNumber(row.total));
    });

    const legalTotalMap = new Map<string, number>();
    legalTotals.forEach((row) => {
      legalTotalMap.set(buildKey(row.report_id, row.version_id), parseNumber(row.total));
    });

    const jobStatusMap = new Map<string, string>();
    jobStatuses.forEach((row) => {
      const key = buildKey(row.report_id, row.version_id);
      if (!jobStatusMap.has(key)) {
        jobStatusMap.set(key, row.status);
      }
    });

    let unitUpserts = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (const report of reports) {
        if (!report.active_version_id || report.year === null) {
          continue;
        }
        const versionId = report.active_version_id;
        const key = buildKey(report.id, versionId);
        const issues = issueMap.get(key) || { total: 0, high: 0, medium: 0, low: 0 };
        const missingFacts = [
          activeDisclosureMap.get(key) || 0,
          applicationMap.get(key) || 0,
          legalMap.get(key) || 0,
        ].filter((count) => count === 0).length;
        const materializeSucceeded = MATERIALIZE_SUCCESS.has(jobStatusMap.get(key) || '') ? 1 : 0;

        const derivedRiskScore =
          issues.high * 3 +
          issues.medium * 2 +
          issues.low +
          missingFacts +
          (materializeSucceeded ? 0 : 2);

        const insertSql = `
          INSERT INTO derived_unit_year_metrics (
            report_id, region_id, unit_name, year, version_id, active_version_id,
            report_count, active_report_count, materialize_succeeded,
            quality_issue_count_total, quality_issue_count_high, quality_issue_count_medium, quality_issue_count_low,
            application_total, legal_total, derived_risk_score, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            1, 1, $7,
            $8, $9, $10, $11,
            $12, $13, $14, NOW()
          )
          ON CONFLICT(report_id) DO UPDATE SET
            region_id = excluded.region_id,
            unit_name = excluded.unit_name,
            year = excluded.year,
            version_id = excluded.version_id,
            active_version_id = excluded.active_version_id,
            report_count = excluded.report_count,
            active_report_count = excluded.active_report_count,
            materialize_succeeded = excluded.materialize_succeeded,
            quality_issue_count_total = excluded.quality_issue_count_total,
            quality_issue_count_high = excluded.quality_issue_count_high,
            quality_issue_count_medium = excluded.quality_issue_count_medium,
            quality_issue_count_low = excluded.quality_issue_count_low,
            application_total = excluded.application_total,
            legal_total = excluded.legal_total,
            derived_risk_score = excluded.derived_risk_score,
            updated_at = excluded.updated_at;
        `;

        await client.query(insertSql, [
          report.id, report.region_id, report.unit_name, report.year, versionId, report.active_version_id,
          materializeSucceeded,
          issues.total, issues.high, issues.medium, issues.low,
          applicationTotalMap.get(key) || 0,
          legalTotalMap.get(key) || 0,
          derivedRiskScore
        ]);
        unitUpserts += 1;
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Region aggregation
    const regionFilters: string[] = [];
    const regionParams: any[] = [];
    if (options.year) {
      regionParams.push(options.year);
      regionFilters.push(`year = $${regionParams.length}`);
    }
    if (options.regionId) {
      regionParams.push(options.regionId);
      regionFilters.push(`region_id = $${regionParams.length}`);
    }
    const regionWhere = regionFilters.length ? `WHERE ${regionFilters.join(' AND ')}` : '';

    const regionRowsRes = await pool.query(`
      SELECT
        region_id,
        year,
        SUM(report_count) as report_count,
        SUM(active_report_count) as active_report_count,
        SUM(materialize_succeeded) as materialize_succeeded,
        SUM(quality_issue_count_total) as quality_issue_count_total,
        SUM(quality_issue_count_high) as quality_issue_count_high,
        SUM(quality_issue_count_medium) as quality_issue_count_medium,
        SUM(quality_issue_count_low) as quality_issue_count_low,
        SUM(application_total) as application_total,
        SUM(legal_total) as legal_total,
        AVG(derived_risk_score) as derived_risk_avg,
        MAX(derived_risk_score) as derived_risk_max
      FROM derived_unit_year_metrics
      ${regionWhere}
      GROUP BY region_id, year
      ORDER BY region_id, year
    `, regionParams);

    const regionRows = regionRowsRes.rows;

    let regionUpserts = 0;
    const regionClient = await pool.connect();

    try {
      await regionClient.query('BEGIN');
      for (const row of regionRows) {
        const insertSql = `
          INSERT INTO derived_region_year_metrics (
            region_id, year, report_count, active_report_count, materialize_succeeded,
            quality_issue_count_total, quality_issue_count_high, quality_issue_count_medium, quality_issue_count_low,
            application_total, legal_total, derived_risk_avg, derived_risk_max, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW()
          )
          ON CONFLICT(region_id, year) DO UPDATE SET
            report_count = excluded.report_count,
            active_report_count = excluded.active_report_count,
            materialize_succeeded = excluded.materialize_succeeded,
            quality_issue_count_total = excluded.quality_issue_count_total,
            quality_issue_count_high = excluded.quality_issue_count_high,
            quality_issue_count_medium = excluded.quality_issue_count_medium,
            quality_issue_count_low = excluded.quality_issue_count_low,
            application_total = excluded.application_total,
            legal_total = excluded.legal_total,
            derived_risk_avg = excluded.derived_risk_avg,
            derived_risk_max = excluded.derived_risk_max,
            updated_at = excluded.updated_at;
        `;
        await regionClient.query(insertSql, [
          row.region_id,
          row.year,
          parseNumber(row.report_count),
          parseNumber(row.active_report_count),
          parseNumber(row.materialize_succeeded),
          parseNumber(row.quality_issue_count_total),
          parseNumber(row.quality_issue_count_high),
          parseNumber(row.quality_issue_count_medium),
          parseNumber(row.quality_issue_count_low),
          parseNumber(row.application_total),
          parseNumber(row.legal_total),
          Number(row.derived_risk_avg || 0).toFixed(2),
          parseNumber(row.derived_risk_max)
        ]);
        regionUpserts += 1;
      }
      await regionClient.query('COMMIT');
    } catch (e) {
      await regionClient.query('ROLLBACK');
      throw e;
    } finally {
      regionClient.release();
    }

    return { unitUpserts, regionUpserts };
  }
}

export default DerivedMetricsService;
