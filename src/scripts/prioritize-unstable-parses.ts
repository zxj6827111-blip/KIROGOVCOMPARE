import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { checkStoragePathExists } from '../services/SourceFileGuardService';

type UnstableVersionRow = {
  version_id: number;
  report_id: number;
  region_id: number | null;
  region_name: string | null;
  year: number | null;
  is_active: boolean;
  review_status: string | null;
  storage_path: string;
  parse_count: number;
  distinct_output_count: number;
  first_parse_at: string;
  last_parse_at: string;
};

type IssueAgg = {
  open_issue_count: number;
  open_table_issue_count: number;
  open_table3_issue_count: number;
  open_visual_issue_count: number;
  open_quality_issue_count: number;
  parse_error_count: number;
};

type FragmentAgg = {
  suspicious_row_count: number;
  suspicious_response_types: string[];
};

type PriorityRow = {
  priority_bucket: 'P0_BLOCKED' | 'P1_TABLE_ACCURACY' | 'P2_ACTIVE_UNSTABLE' | 'P3_MONITOR';
  priority_score: number;
  recommended_action:
    | 'restore_source_first'
    | 'source_gated_reparse_table_priority'
    | 'reparse_and_compare'
    | 'monitor_or_defer';
  focus_reason: string;
  report_id: number;
  version_id: number;
  region_id: number | null;
  region_name: string | null;
  year: number | null;
  is_active: boolean;
  review_status: string | null;
  storage_path: string;
  source_exists: boolean;
  parse_count: number;
  distinct_output_count: number;
  first_parse_at: string;
  last_parse_at: string;
  open_issue_count: number;
  open_table_issue_count: number;
  open_table3_issue_count: number;
  open_visual_issue_count: number;
  open_quality_issue_count: number;
  parse_error_count: number;
  table3_fragmentation_rows: number;
  table3_fragmentation_response_types: string[];
};

type ApplicationAggregate = {
  version_id: number;
  response_type: string;
  natural_person: number | null;
  legal_person_commercial: number | null;
  legal_person_research: number | null;
  legal_person_social: number | null;
  legal_person_legal: number | null;
  legal_person_other: number | null;
  total: number | null;
};

type EntityKey =
  | 'natural_person'
  | 'legal_person_commercial'
  | 'legal_person_research'
  | 'legal_person_social'
  | 'legal_person_legal'
  | 'legal_person_other';

const ENTITY_KEYS: EntityKey[] = [
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

function toNumber(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isSingleDigitInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 9;
}

function hasFragmentCandidate(row: ApplicationAggregate): boolean {
  const values = ENTITY_KEYS.map((key) => ({ key, value: toNumber(row[key]) }));
  const total = toNumber(row.total);
  const entitySum = values.reduce((sum, item) => sum + item.value, 0);
  if (entitySum === total) {
    return false;
  }

  for (let index = 0; index < values.length - 1; index += 1) {
    const left = values[index];
    const right = values[index + 1];
    if (!isSingleDigitInteger(left.value) || !isSingleDigitInteger(right.value)) {
      continue;
    }
    if (left.value === 0 && right.value === 0) {
      continue;
    }

    const mergedValue = Number(`${left.value}${right.value}`);
    const repairedSum = entitySum - left.value - right.value + mergedValue;
    if (repairedSum === total) {
      return true;
    }
  }

  return false;
}

async function loadUnstableVersions(limit: number): Promise<UnstableVersionRow[]> {
  const result = await pool.query(
    `SELECT
       p.report_version_id::int AS version_id,
       rv.report_id::int AS report_id,
       r.region_id::int AS region_id,
       reg.name AS region_name,
       r.year::int AS year,
       rv.is_active,
       rv.review_status,
       rv.storage_path,
       COUNT(*)::int AS parse_count,
       COUNT(DISTINCT md5(p.output_json::text))::int AS distinct_output_count,
       MIN(p.created_at) AS first_parse_at,
       MAX(p.created_at) AS last_parse_at
     FROM report_version_parses p
     JOIN report_versions rv ON rv.id = p.report_version_id
     JOIN reports r ON r.id = rv.report_id
     LEFT JOIN regions reg ON reg.id = r.region_id
     GROUP BY
       p.report_version_id,
       rv.report_id,
       r.region_id,
       reg.name,
       r.year,
       rv.is_active,
       rv.review_status,
       rv.storage_path
     HAVING COUNT(DISTINCT md5(p.output_json::text)) > 1
     ORDER BY
       rv.is_active DESC,
       COUNT(DISTINCT md5(p.output_json::text)) DESC,
       COUNT(*) DESC,
       p.report_version_id DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as UnstableVersionRow[];
}

async function loadIssueAgg(versionIds: number[]): Promise<Map<number, IssueAgg>> {
  const mapping = new Map<number, IssueAgg>();
  if (versionIds.length === 0) return mapping;

  const result = await pool.query(
    `SELECT
       report_version_id::int AS version_id,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
       )::int AS open_issue_count,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
           AND group_key IN ('table2', 'table3', 'table4')
       )::int AS open_table_issue_count,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
           AND group_key = 'table3'
       )::int AS open_table3_issue_count,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
           AND group_key = 'visual'
       )::int AS open_visual_issue_count,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
           AND group_key = 'quality'
       )::int AS open_quality_issue_count,
       COUNT(*) FILTER (
         WHERE auto_status IN ('FAIL', 'UNCERTAIN')
           AND COALESCE(human_status, 'pending') <> 'dismissed'
           AND check_key = 'parse_error'
       )::int AS parse_error_count
     FROM report_consistency_items
     WHERE report_version_id = ANY($1::int[])
     GROUP BY report_version_id`,
    [versionIds]
  );

  for (const row of result.rows) {
    mapping.set(Number(row.version_id), {
      open_issue_count: Number(row.open_issue_count || 0),
      open_table_issue_count: Number(row.open_table_issue_count || 0),
      open_table3_issue_count: Number(row.open_table3_issue_count || 0),
      open_visual_issue_count: Number(row.open_visual_issue_count || 0),
      open_quality_issue_count: Number(row.open_quality_issue_count || 0),
      parse_error_count: Number(row.parse_error_count || 0),
    });
  }

  return mapping;
}

async function loadFragmentAgg(versionIds: number[]): Promise<Map<number, FragmentAgg>> {
  const mapping = new Map<number, FragmentAgg>();
  if (versionIds.length === 0) return mapping;

  const result = await pool.query(
    `WITH base AS (
       SELECT
         fa.version_id::int AS version_id,
         fa.response_type,
         MAX(CASE WHEN fa.applicant_type = 'natural_person' THEN fa.count END) AS natural_person,
         MAX(CASE WHEN fa.applicant_type = 'legal_person_commercial' THEN fa.count END) AS legal_person_commercial,
         MAX(CASE WHEN fa.applicant_type = 'legal_person_research' THEN fa.count END) AS legal_person_research,
         MAX(CASE WHEN fa.applicant_type = 'legal_person_social' THEN fa.count END) AS legal_person_social,
         MAX(CASE WHEN fa.applicant_type = 'legal_person_legal' THEN fa.count END) AS legal_person_legal,
         MAX(CASE WHEN fa.applicant_type = 'legal_person_other' THEN fa.count END) AS legal_person_other,
         MAX(CASE WHEN fa.applicant_type = 'total' THEN fa.count END) AS total
       FROM fact_application fa
       WHERE fa.version_id = ANY($1::int[])
       GROUP BY fa.version_id, fa.response_type
     )
     SELECT *
     FROM base
     WHERE total IS NOT NULL
     ORDER BY version_id DESC, response_type ASC`,
    [versionIds]
  );

  for (const row of result.rows as ApplicationAggregate[]) {
    if (!hasFragmentCandidate(row)) {
      continue;
    }

    const existing = mapping.get(row.version_id) || {
      suspicious_row_count: 0,
      suspicious_response_types: [],
    };
    existing.suspicious_row_count += 1;
    existing.suspicious_response_types.push(row.response_type);
    mapping.set(row.version_id, existing);
  }

  return mapping;
}

function summarizeReason(row: PriorityRow): string {
  const reasons: string[] = [];
  if (!row.source_exists) reasons.push('缺源文件');
  if (row.is_active) reasons.push('活跃版本');
  if (row.table3_fragmentation_rows > 0) reasons.push(`表三疑似拆格 ${row.table3_fragmentation_rows} 行`);
  if (row.open_table3_issue_count > 0) reasons.push(`表三问题 ${row.open_table3_issue_count}`);
  if (row.open_visual_issue_count > 0) reasons.push(`视觉问题 ${row.open_visual_issue_count}`);
  if (row.parse_error_count > 0) reasons.push(`解析错误 ${row.parse_error_count}`);
  if (row.distinct_output_count > 1) reasons.push(`解析输出 ${row.distinct_output_count} 种`);
  return reasons.join(' / ') || '一般监控';
}

function computePriority(
  base: UnstableVersionRow,
  issues: IssueAgg,
  fragments: FragmentAgg,
  sourceExists: boolean
): PriorityRow {
  let score = 0;
  if (base.is_active) score += 120;
  score += Math.min(60, Math.max(0, base.distinct_output_count - 1) * 12);
  score += Math.min(30, Math.max(0, base.parse_count - 1) * 4);
  score += Math.min(80, issues.open_table_issue_count * 12);
  score += Math.min(60, issues.open_table3_issue_count * 16);
  score += Math.min(36, issues.open_visual_issue_count * 9);
  score += Math.min(24, issues.parse_error_count * 12);
  score += Math.min(30, issues.open_issue_count * 3);
  score += fragments.suspicious_row_count > 0 ? 100 + fragments.suspicious_row_count * 12 : 0;
  if (!sourceExists) score -= 150;

  let priorityBucket: PriorityRow['priority_bucket'] = 'P3_MONITOR';
  let recommendedAction: PriorityRow['recommended_action'] = 'monitor_or_defer';

  if (!sourceExists) {
    priorityBucket = 'P0_BLOCKED';
    recommendedAction = 'restore_source_first';
  } else if (
    fragments.suspicious_row_count > 0 ||
    issues.open_table3_issue_count > 0 ||
    issues.open_visual_issue_count > 0 ||
    issues.parse_error_count > 0
  ) {
    priorityBucket = 'P1_TABLE_ACCURACY';
    recommendedAction = 'source_gated_reparse_table_priority';
  } else if (base.is_active || issues.open_table_issue_count > 0 || issues.open_issue_count > 0) {
    priorityBucket = 'P2_ACTIVE_UNSTABLE';
    recommendedAction = 'reparse_and_compare';
  }

  const row: PriorityRow = {
    priority_bucket: priorityBucket,
    priority_score: score,
    recommended_action: recommendedAction,
    focus_reason: '',
    report_id: base.report_id,
    version_id: base.version_id,
    region_id: base.region_id,
    region_name: base.region_name,
    year: base.year,
    is_active: base.is_active,
    review_status: base.review_status,
    storage_path: base.storage_path,
    source_exists: sourceExists,
    parse_count: base.parse_count,
    distinct_output_count: base.distinct_output_count,
    first_parse_at: base.first_parse_at,
    last_parse_at: base.last_parse_at,
    open_issue_count: issues.open_issue_count,
    open_table_issue_count: issues.open_table_issue_count,
    open_table3_issue_count: issues.open_table3_issue_count,
    open_visual_issue_count: issues.open_visual_issue_count,
    open_quality_issue_count: issues.open_quality_issue_count,
    parse_error_count: issues.parse_error_count,
    table3_fragmentation_rows: fragments.suspicious_row_count,
    table3_fragmentation_response_types: fragments.suspicious_response_types,
  };
  row.focus_reason = summarizeReason(row);
  return row;
}

async function main(): Promise<void> {
  const limit = toInt(parseArg('limit'), 1000);
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);
  await fsp.mkdir(outDir, { recursive: true });

  const unstableVersions = await loadUnstableVersions(limit);
  const versionIds = unstableVersions.map((row) => row.version_id);
  const [issueAgg, fragmentAgg] = await Promise.all([
    loadIssueAgg(versionIds),
    loadFragmentAgg(versionIds),
  ]);

  const rows = unstableVersions.map((row) => {
    const issues = issueAgg.get(row.version_id) || {
      open_issue_count: 0,
      open_table_issue_count: 0,
      open_table3_issue_count: 0,
      open_visual_issue_count: 0,
      open_quality_issue_count: 0,
      parse_error_count: 0,
    };
    const fragments = fragmentAgg.get(row.version_id) || {
      suspicious_row_count: 0,
      suspicious_response_types: [],
    };
    const sourceExists = checkStoragePathExists(row.storage_path).ok;
    return computePriority(row, issues, fragments, sourceExists);
  });

  rows.sort((left, right) => {
    const bucketOrder: Record<PriorityRow['priority_bucket'], number> = {
      P1_TABLE_ACCURACY: 1,
      P0_BLOCKED: 2,
      P2_ACTIVE_UNSTABLE: 3,
      P3_MONITOR: 4,
    };
    const bucketDelta = bucketOrder[left.priority_bucket] - bucketOrder[right.priority_bucket];
    if (bucketDelta !== 0) return bucketDelta;
    if (right.priority_score !== left.priority_score) return right.priority_score - left.priority_score;
    if (Number(right.is_active) !== Number(left.is_active)) return Number(right.is_active) - Number(left.is_active);
    return right.version_id - left.version_id;
  });

  const summary = {
    unstable_versions: rows.length,
    active_versions: rows.filter((row) => row.is_active).length,
    blocked_missing_source: rows.filter((row) => row.priority_bucket === 'P0_BLOCKED').length,
    table_accuracy_priority: rows.filter((row) => row.priority_bucket === 'P1_TABLE_ACCURACY').length,
    active_unstable_priority: rows.filter((row) => row.priority_bucket === 'P2_ACTIVE_UNSTABLE').length,
    monitor_priority: rows.filter((row) => row.priority_bucket === 'P3_MONITOR').length,
  };

  const timestamp = buildTimestamp();
  const summaryPath = path.join(outDir, `unstable_parse_priority_summary_${timestamp}.json`);
  const detailJsonPath = path.join(outDir, `unstable_parse_priority_details_${timestamp}.json`);
  const detailCsvPath = path.join(outDir, `unstable_parse_priority_details_${timestamp}.csv`);
  const topTableJsonPath = path.join(outDir, `unstable_parse_priority_table_accuracy_top_${timestamp}.json`);

  const csvHeaders = [
    'priority_bucket',
    'priority_score',
    'recommended_action',
    'focus_reason',
    'report_id',
    'version_id',
    'region_id',
    'region_name',
    'year',
    'is_active',
    'review_status',
    'source_exists',
    'parse_count',
    'distinct_output_count',
    'open_issue_count',
    'open_table_issue_count',
    'open_table3_issue_count',
    'open_visual_issue_count',
    'open_quality_issue_count',
    'parse_error_count',
    'table3_fragmentation_rows',
    'table3_fragmentation_response_types',
    'storage_path',
    'first_parse_at',
    'last_parse_at',
  ];

  const csvRows = rows.map((row) => ({
    ...row,
    table3_fragmentation_response_types: row.table3_fragmentation_response_types.join('|'),
  }));

  await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fsp.writeFile(detailJsonPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  await fsp.writeFile(detailCsvPath, toCsv(csvRows, csvHeaders), 'utf8');
  await fsp.writeFile(
    topTableJsonPath,
    `${JSON.stringify(rows.filter((row) => row.priority_bucket === 'P1_TABLE_ACCURACY').slice(0, 100), null, 2)}\n`,
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        summary,
        outputs: {
          summary_json: summaryPath,
          details_json: detailJsonPath,
          details_csv: detailCsvPath,
          top_table_accuracy_json: topTableJsonPath,
        },
        top_samples: rows.slice(0, 20),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[prioritize-unstable-parses] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
