import fs from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';

type DetailMismatchRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  applicant_type: string;
  total_processed: number;
  detail_sum: number;
  diff: number;
  observed_rows: number;
  null_detail_rows: number;
};

type TotalMismatchRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  response_type: string;
  total_value: number;
  sub_sum: number;
  diff: number;
  observed_rows: number;
};

type ReportSummaryRow = {
  report_id: number;
  version_id: number;
  year: number;
  region_id: number | null;
  region_name: string | null;
  detail_mismatch_rows: number;
  total_mismatch_rows: number;
  max_abs_diff_detail: number;
  max_abs_diff_total: number;
  score: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  has_detail_mismatch: boolean;
  has_total_mismatch: boolean;
};

const DETAIL_RESPONSE_TYPES = [
  'granted',
  'partial_grant',
  'denied_state_secret',
  'denied_law_forbidden',
  'denied_safety_stability',
  'denied_third_party_rights',
  'denied_internal_affairs',
  'denied_process_info',
  'denied_enforcement_case',
  'denied_admin_query',
  'unable_no_info',
  'unable_need_creation',
  'unable_unclear',
  'not_processed_complaint',
  'not_processed_repeat',
  'not_processed_publication',
  'not_processed_massive_requests',
  'not_processed_confirm_info',
  'other_overdue_correction',
  'other_overdue_fee',
  'other_other_reasons',
];

const DETAIL_WITH_TOTAL_TYPES = [...DETAIL_RESPONSE_TYPES, 'total_processed'];
const TOTAL_ROW_RESPONSE_TYPES = ['new_received', 'carried_over', 'total_processed', 'carried_forward'];
const SUB_APPLICANT_TYPES = [
  'natural_person',
  'legal_person_commercial',
  'legal_person_research',
  'legal_person_social',
  'legal_person_legal',
  'legal_person_other',
];

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function toInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function severityFromScore(score: number): ReportSummaryRow['severity'] {
  if (score >= 100) return 'critical';
  if (score >= 20) return 'high';
  if (score >= 5) return 'medium';
  return 'low';
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
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function queryDetailMismatches(minObservedRows: number): Promise<DetailMismatchRow[]> {
  const result = await pool.query(
    `WITH active AS (
       SELECT r.id::int AS report_id,
              r.active_version_id::int AS version_id,
              r.year::int AS year,
              r.region_id::int AS region_id,
              rg.name AS region_name
       FROM reports r
       LEFT JOIN regions rg ON rg.id = r.region_id
       WHERE r.active_version_id IS NOT NULL
     ),
     agg AS (
       SELECT
         a.report_id,
         a.version_id,
         a.year,
         a.region_id,
         a.region_name,
         fa.applicant_type,
         MAX(CASE WHEN fa.response_type = 'total_processed' THEN fa.count END) AS total_processed,
         SUM(CASE WHEN fa.response_type = ANY($1::text[]) THEN COALESCE(fa.count, 0) ELSE 0 END) AS detail_sum,
         COUNT(*) FILTER (WHERE fa.response_type = ANY($2::text[])) AS observed_rows,
         COUNT(*) FILTER (WHERE fa.response_type = ANY($1::text[]) AND fa.count IS NULL) AS null_detail_rows
       FROM active a
       JOIN fact_application fa
         ON fa.report_id = a.report_id
        AND fa.version_id = a.version_id
       GROUP BY
         a.report_id,
         a.version_id,
         a.year,
         a.region_id,
         a.region_name,
         fa.applicant_type
     )
     SELECT
       report_id::int,
       version_id::int,
       year::int,
       region_id::int,
       region_name,
       applicant_type,
       total_processed::int,
       detail_sum::int,
       (detail_sum - total_processed)::int AS diff,
       observed_rows::int,
       null_detail_rows::int
     FROM agg
     WHERE total_processed IS NOT NULL
       AND observed_rows >= $3
       AND detail_sum <> total_processed
     ORDER BY ABS(detail_sum - total_processed) DESC, report_id ASC, applicant_type ASC`,
    [DETAIL_RESPONSE_TYPES, DETAIL_WITH_TOTAL_TYPES, minObservedRows]
  );

  return result.rows as DetailMismatchRow[];
}

async function queryTotalMismatches(minObservedRows: number): Promise<TotalMismatchRow[]> {
  const result = await pool.query(
    `WITH active AS (
       SELECT r.id::int AS report_id,
              r.active_version_id::int AS version_id,
              r.year::int AS year,
              r.region_id::int AS region_id,
              rg.name AS region_name
       FROM reports r
       LEFT JOIN regions rg ON rg.id = r.region_id
       WHERE r.active_version_id IS NOT NULL
     ),
     agg AS (
       SELECT
         a.report_id,
         a.version_id,
         a.year,
         a.region_id,
         a.region_name,
         fa.response_type,
         SUM(CASE WHEN fa.applicant_type = ANY($1::text[]) THEN COALESCE(fa.count, 0) ELSE 0 END) AS sub_sum,
         MAX(CASE WHEN fa.applicant_type = 'total' THEN fa.count END) AS total_value,
         COUNT(*) FILTER (
           WHERE fa.applicant_type = ANY($2::text[])
         ) AS observed_rows
       FROM active a
       JOIN fact_application fa
         ON fa.report_id = a.report_id
        AND fa.version_id = a.version_id
      WHERE fa.response_type = ANY($3::text[])
      GROUP BY
        a.report_id,
        a.version_id,
        a.year,
        a.region_id,
        a.region_name,
        fa.response_type
     )
     SELECT
       report_id::int,
       version_id::int,
       year::int,
       region_id::int,
       region_name,
       response_type,
       total_value::int,
       sub_sum::int,
       (sub_sum - total_value)::int AS diff,
       observed_rows::int
     FROM agg
     WHERE total_value IS NOT NULL
       AND observed_rows >= $4
       AND sub_sum <> total_value
     ORDER BY ABS(sub_sum - total_value) DESC, report_id ASC, response_type ASC`,
    [SUB_APPLICANT_TYPES, [...SUB_APPLICANT_TYPES, 'total'], TOTAL_ROW_RESPONSE_TYPES, minObservedRows]
  );

  return result.rows as TotalMismatchRow[];
}

async function queryProviderModel(versionIds: number[]): Promise<Map<number, { provider: string | null; model: string | null }>> {
  const mapping = new Map<number, { provider: string | null; model: string | null }>();
  if (!versionIds.length) return mapping;

  const result = await pool.query(
    `SELECT id::int AS version_id, provider, model
     FROM report_versions
     WHERE id = ANY($1::int[])`,
    [versionIds]
  );

  for (const row of result.rows) {
    mapping.set(Number(row.version_id), {
      provider: row.provider ?? null,
      model: row.model ?? null,
    });
  }
  return mapping;
}

function buildProviderDist(
  rows: Array<{ version_id: number }>,
  providerMap: Map<number, { provider: string | null; model: string | null }>
): Array<{ provider: string; model: string; count: number }> {
  const counter = new Map<string, number>();
  for (const row of rows) {
    const pm = providerMap.get(row.version_id);
    const provider = pm?.provider || 'unknown';
    const model = pm?.model || 'unknown';
    const key = `${provider}|||${model}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  return Array.from(counter.entries())
    .map(([key, count]) => {
      const [provider, model] = key.split('|||');
      return { provider, model, count };
    })
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
}

function topCounts(rows: Array<{ year: number; region_id: number | null; region_name: string | null }>) {
  const byYear = new Map<number, number>();
  const byRegion = new Map<string, { region_id: number | null; region_name: string | null; count: number }>();

  for (const row of rows) {
    byYear.set(row.year, (byYear.get(row.year) || 0) + 1);
    const key = String(row.region_id ?? 'null');
    const existing = byRegion.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byRegion.set(key, { region_id: row.region_id, region_name: row.region_name, count: 1 });
    }
  }

  return {
    by_year: Array.from(byYear.entries())
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.count - a.count || b.year - a.year),
    top_regions: Array.from(byRegion.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 30),
  };
}

async function main(): Promise<void> {
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);
  const minDetailRows = toInt(parseArg('min-detail-rows'), 10);
  const minTotalRows = toInt(parseArg('min-total-rows'), 7);
  const timestamp = buildTimestamp();

  await fs.mkdir(outDir, { recursive: true });

  const detailRows = await queryDetailMismatches(minDetailRows);
  const totalRows = await queryTotalMismatches(minTotalRows);

  const detailReportIds = new Set(detailRows.map((r) => r.report_id));
  const totalReportIds = new Set(totalRows.map((r) => r.report_id));
  const intersectionReportIds = new Set<number>();
  for (const id of detailReportIds) {
    if (totalReportIds.has(id)) intersectionReportIds.add(id);
  }

  const reportMap = new Map<number, ReportSummaryRow>();
  const upsertReport = (
    reportId: number,
    versionId: number,
    year: number,
    regionId: number | null,
    regionName: string | null
  ): ReportSummaryRow => {
    const existing = reportMap.get(reportId);
    if (existing) return existing;
    const created: ReportSummaryRow = {
      report_id: reportId,
      version_id: versionId,
      year,
      region_id: regionId,
      region_name: regionName,
      detail_mismatch_rows: 0,
      total_mismatch_rows: 0,
      max_abs_diff_detail: 0,
      max_abs_diff_total: 0,
      score: 0,
      severity: 'low',
      has_detail_mismatch: false,
      has_total_mismatch: false,
    };
    reportMap.set(reportId, created);
    return created;
  };

  for (const row of detailRows) {
    const report = upsertReport(row.report_id, row.version_id, row.year, row.region_id, row.region_name);
    report.detail_mismatch_rows += 1;
    report.max_abs_diff_detail = Math.max(report.max_abs_diff_detail, Math.abs(row.diff));
    report.has_detail_mismatch = true;
  }

  for (const row of totalRows) {
    const report = upsertReport(row.report_id, row.version_id, row.year, row.region_id, row.region_name);
    report.total_mismatch_rows += 1;
    report.max_abs_diff_total = Math.max(report.max_abs_diff_total, Math.abs(row.diff));
    report.has_total_mismatch = true;
  }

  for (const report of reportMap.values()) {
    report.score = report.max_abs_diff_detail + report.max_abs_diff_total;
    report.severity = severityFromScore(report.score);
  }

  const reportSummary = Array.from(reportMap.values()).sort(
    (a, b) =>
      b.score - a.score ||
      b.detail_mismatch_rows - a.detail_mismatch_rows ||
      b.total_mismatch_rows - a.total_mismatch_rows ||
      a.report_id - b.report_id
  );

  const allVersionIds = Array.from(new Set([...detailRows.map((r) => r.version_id), ...totalRows.map((r) => r.version_id)]));
  const providerMap = await queryProviderModel(allVersionIds);
  const detailProviderDist = buildProviderDist(detailRows, providerMap);
  const totalProviderDist = buildProviderDist(totalRows, providerMap);

  const detailReportRows = Array.from(
    new Map(detailRows.map((r) => [r.report_id, { year: r.year, region_id: r.region_id, region_name: r.region_name }])).entries()
  ).map(([report_id, meta]) => ({ report_id, ...meta }));
  const totalReportRows = Array.from(
    new Map(totalRows.map((r) => [r.report_id, { year: r.year, region_id: r.region_id, region_name: r.region_name }])).entries()
  ).map(([report_id, meta]) => ({ report_id, ...meta }));

  const detailDist = topCounts(detailReportRows);
  const totalDist = topCounts(totalReportRows);

  const severityCounts = reportSummary.reduce<Record<string, number>>((acc, row) => {
    acc[row.severity] = (acc[row.severity] || 0) + 1;
    return acc;
  }, {});

  const summary = {
    scanned_at: new Date().toISOString(),
    db_name: process.env.DB_NAME || null,
    thresholds: {
      min_detail_rows: minDetailRows,
      min_total_rows: minTotalRows,
    },
    counts: {
      detail_mismatch_rows: detailRows.length,
      detail_mismatch_reports: detailReportIds.size,
      total_mismatch_rows: totalRows.length,
      total_mismatch_reports: totalReportIds.size,
      overlap_reports: intersectionReportIds.size,
      only_detail_reports: detailReportIds.size - intersectionReportIds.size,
      only_total_reports: totalReportIds.size - intersectionReportIds.size,
      combined_reports: reportSummary.length,
    },
    severity_counts: severityCounts,
    detail_distribution: detailDist,
    total_distribution: totalDist,
    detail_provider_distribution: detailProviderDist.slice(0, 20),
    total_provider_distribution: totalProviderDist.slice(0, 20),
    top_combined_reports: reportSummary.slice(0, 50),
  };

  const summaryJsonPath = path.join(outDir, `table3_consistency_summary_${timestamp}.json`);
  const detailJsonPath = path.join(outDir, `table3_detail_mismatches_${timestamp}.json`);
  const totalJsonPath = path.join(outDir, `table3_total_mismatches_${timestamp}.json`);
  const reportJsonPath = path.join(outDir, `table3_report_summary_${timestamp}.json`);
  const detailCsvPath = path.join(outDir, `table3_detail_mismatches_${timestamp}.csv`);
  const totalCsvPath = path.join(outDir, `table3_total_mismatches_${timestamp}.csv`);
  const reportCsvPath = path.join(outDir, `table3_report_summary_${timestamp}.csv`);

  await fs.writeFile(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8');
  await fs.writeFile(detailJsonPath, JSON.stringify(detailRows, null, 2), 'utf8');
  await fs.writeFile(totalJsonPath, JSON.stringify(totalRows, null, 2), 'utf8');
  await fs.writeFile(reportJsonPath, JSON.stringify(reportSummary, null, 2), 'utf8');

  await fs.writeFile(
    detailCsvPath,
    toCsv(detailRows as unknown as Array<Record<string, unknown>>, [
      'report_id',
      'version_id',
      'year',
      'region_id',
      'region_name',
      'applicant_type',
      'total_processed',
      'detail_sum',
      'diff',
      'observed_rows',
      'null_detail_rows',
    ]),
    'utf8'
  );

  await fs.writeFile(
    totalCsvPath,
    toCsv(totalRows as unknown as Array<Record<string, unknown>>, [
      'report_id',
      'version_id',
      'year',
      'region_id',
      'region_name',
      'response_type',
      'total_value',
      'sub_sum',
      'diff',
      'observed_rows',
    ]),
    'utf8'
  );

  await fs.writeFile(
    reportCsvPath,
    toCsv(reportSummary as unknown as Array<Record<string, unknown>>, [
      'report_id',
      'version_id',
      'year',
      'region_id',
      'region_name',
      'detail_mismatch_rows',
      'total_mismatch_rows',
      'max_abs_diff_detail',
      'max_abs_diff_total',
      'score',
      'severity',
      'has_detail_mismatch',
      'has_total_mismatch',
    ]),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        summary,
        artifacts: {
          summary_json: summaryJsonPath,
          detail_json: detailJsonPath,
          total_json: totalJsonPath,
          report_json: reportJsonPath,
          detail_csv: detailCsvPath,
          total_csv: totalCsvPath,
          report_csv: reportCsvPath,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[audit-table3-consistency] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
