import pool from '../../config/database-llm';
import {
  CATEGORY_ACTIONS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CATEGORY_TO_METRIC,
  inferCategoryFromRule,
  inferCategoryFromTable,
  normalizeSeverity,
  SEVERITY_ORDER,
  IssueCategory,
  IssueSeverity,
} from './mappings';
import {
  EvidenceItem,
  IssueItem,
  MetricItem,
  ReportSectionData,
  renderHtmlReport,
  renderMarkdownReport,
} from './renderers';

export type ReportFormat = 'md' | 'html';

export interface ReportFactoryOptions {
  reportId: number;
  versionId?: number;
  format: ReportFormat;
  includeEvidence: boolean;
}

interface ReportRow {
  id: number;
  unit_name: string | null;
  year: number | null;
  active_version_id: number | null;
}

interface ReportVersionRow {
  id: number;
  report_id: number;
}

interface QualityIssueRow {
  id: number;
  rule_code: string;
  severity: string | null;
  description: string;
  cell_ref: string | null;
}

interface CellRow {
  id: number;
  table_id: string;
  row_key: string;
  col_key: string;
  cell_ref: string;
  value_raw: string | null;
  value_num: number | null;
  normalized_value: string | null;
}

interface MetricDefinition {
  metric_key: string;
  display_name: string;
  description: string | null;
  unit: string | null;
  caveats: string | null;
}

type FactActiveDisclosureRow = {
  id: number;
  category: string;
  made_count: number | null;
  repealed_count: number | null;
  valid_count: number | null;
  processed_count: number | null;
  amount: number | null;
};

type FactApplicationRow = {
  id: number;
  applicant_type: string;
  response_type: string;
  count: number | null;
};

type FactLegalProceedingRow = {
  id: number;
  case_type: string;
  result_type: string;
  count: number | null;
};

const FACT_TABLES = {
  active_disclosure: 'fact_active_disclosure',
  application: 'fact_application',
  legal_proceeding: 'fact_legal_proceeding',
} as const;

type FactTableKey = keyof typeof FACT_TABLES;

const METRIC_KEYS = [
  'active_disclosure_total',
  'active_disclosure_valid',
  'application_received_total',
  'application_carried_over',
  'application_granted',
  'application_partial_grant',
  'application_denied_total',
  'application_total_processed',
  'legal_review_total',
  'legal_litigation_total',
];

const CATEGORY_METRIC_ORDER: Record<IssueCategory, string[]> = {
  active_disclosure: ['active_disclosure_total', 'active_disclosure_valid'],
  application: [
    'application_received_total',
    'application_carried_over',
    'application_granted',
    'application_partial_grant',
    'application_denied_total',
    'application_total_processed',
  ],
  legal_proceeding: ['legal_review_total', 'legal_litigation_total'],
  general: [],
};

function buildEvidenceItem(cell: CellRow, reportId: number, versionId: number): EvidenceItem {
  const raw = cell.normalized_value ?? cell.value_raw ?? (cell.value_num !== null ? String(cell.value_num) : '');
  const snippet = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  return {
    table: cell.table_id,
    row: cell.row_key,
    col: cell.col_key,
    value: snippet,
    reportId,
    versionId,
  };
}

function summarizeRiskPoints(issues: IssueItem[]): string {
  const count = issues.length;
  const top = issues.slice(0, 3).map((issue) => issue.issueCode).filter(Boolean).join('，');
  return `问题数量=${count}，关键风险点=${top || '暂无'}`;
}

function sumBy(rows: Array<Record<string, any>>, key: string, filter?: (row: any) => boolean): number {
  return rows.reduce((acc, row) => {
    if (filter && !filter(row)) {
      return acc;
    }
    const value = row[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return acc + value;
    }
    return acc;
  }, 0);
}

function toMetricItem(def: MetricDefinition | undefined, metricKey: string, value: number): MetricItem {
  return {
    metricKey,
    displayName: def?.display_name || metricKey,
    value: Number.isFinite(value) ? String(value) : '—',
    unit: def?.unit || undefined,
    description: def?.description || '未配置',
    caveats: def?.caveats || undefined,
  };
}

function buildIssueTitle(ruleCode: string, description: string): string {
  const sentence = description.split(/。|\./)[0] || description;
  const trimmed = sentence.length > 24 ? `${sentence.slice(0, 24)}...` : sentence;
  return `${ruleCode || '问题'}：${trimmed}`;
}

function buildRiskDescription(ruleCode: string, description: string): string {
  return `${ruleCode} 可能导致统计口径偏差或披露风险，需核对数据来源。${description ? `（${description}）` : ''}`;
}

function resolveCategory(cell: CellRow | null, ruleCode: string): IssueCategory {
  const fromTable = inferCategoryFromTable(cell?.table_id);
  if (fromTable !== 'general') return fromTable;
  return inferCategoryFromRule(ruleCode);
}

function resolveMetricKey(category: IssueCategory): string | null {
  return CATEGORY_TO_METRIC[category] || null;
}

function buildIssueItem(
  issue: QualityIssueRow,
  cell: CellRow | null,
  fallbackCell: CellRow | null,
  reportId: number,
  versionId: number
): IssueItem {
  const evidenceCell = cell || fallbackCell;
  const evidences = evidenceCell ? [buildEvidenceItem(evidenceCell, reportId, versionId)] : [];
  const category = resolveCategory(cell, issue.rule_code);
  return {
    title: buildIssueTitle(issue.rule_code, issue.description),
    severity: normalizeSeverity(issue.severity),
    category,
    risk: buildRiskDescription(issue.rule_code, issue.description),
    actions: CATEGORY_ACTIONS[category],
    evidences,
    metricKey: resolveMetricKey(category),
    issueCode: issue.rule_code,
    issueId: issue.id,
  };
}

function groupIssues(issues: IssueItem[]): Array<{ severity: IssueSeverity; category: IssueCategory; items: IssueItem[] }> {
  const grouped: Array<{ severity: IssueSeverity; category: IssueCategory; items: IssueItem[] }> = [];
  const severityOrder = Object.keys(SEVERITY_ORDER) as IssueSeverity[];
  severityOrder
    .sort((a, b) => SEVERITY_ORDER[b] - SEVERITY_ORDER[a])
    .forEach((severity) => {
      CATEGORY_ORDER.forEach((category) => {
        const items = issues.filter((issue) => issue.severity === severity && issue.category === category);
        if (items.length > 0) {
          grouped.push({ severity, category, items });
        }
      });
    });
  return grouped;
}

function sortIssues(issues: IssueItem[]): IssueItem[] {
  return issues
    .slice()
    .sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
      if (severityDiff !== 0) return severityDiff;
      const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
      if (categoryDiff !== 0) return categoryDiff;
      const metricDiff = (a.metricKey || '').localeCompare(b.metricKey || '');
      if (metricDiff !== 0) return metricDiff;
      const codeDiff = a.issueCode.localeCompare(b.issueCode);
      if (codeDiff !== 0) return codeDiff;
      return a.issueId - b.issueId;
    });
}

function buildActionSummary(): Array<{ category: IssueCategory; actions: string[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    actions: CATEGORY_ACTIONS[category],
  }));
}

function ensureTableAllowed(tableKey: FactTableKey): string {
  const tableName = FACT_TABLES[tableKey];
  if (!tableName) {
    const err: any = new Error('NOT_ALLOWED');
    err.statusCode = 400;
    throw err;
  }
  return tableName;
}

export class ReportFactoryService {
  static async generate(options: ReportFactoryOptions): Promise<string> {
    const reportId = options.reportId;

    const reportRes = await pool.query(
      `SELECT id, unit_name, year, active_version_id
       FROM reports
       WHERE id = $1
       LIMIT 1`,
      [reportId]
    );
    const report = reportRes.rows[0] as ReportRow | undefined;

    if (!report) {
      const err: any = new Error('Report not found');
      err.statusCode = 404;
      throw err;
    }

    let versionId = options.versionId;
    if (!versionId) {
      if (!report.active_version_id) {
        const err: any = new Error('Active version not found');
        err.statusCode = 404;
        throw err;
      }
      versionId = report.active_version_id;
    } else {
      const versionRes = await pool.query(
        `SELECT id, report_id FROM report_versions
         WHERE id = $1
         LIMIT 1`,
        [versionId]
      );
      const version = versionRes.rows[0] as ReportVersionRow | undefined;
      if (!version || version.report_id !== reportId) {
        const err: any = new Error('Version not found');
        err.statusCode = 404;
        throw err;
      }
    }

    const activeDisclosureTable = ensureTableAllowed('active_disclosure');
    const applicationTable = ensureTableAllowed('application');
    const legalTable = ensureTableAllowed('legal_proceeding');

    // Note: Parameterized usage with table names works only if we are sure table names are safe.
    // ensureTableAllowed checks against a const list, so it's safe to string interpolate table names.
    // However, values must be parameterized.

    const [activeDisclosureRes, applicationsRes, legalProceedingsRes, issuesRes, metricDefsRes, materializeJobRes] = await Promise.all([
      pool.query(
        `SELECT id, category, made_count, repealed_count, valid_count, processed_count, amount
         FROM ${activeDisclosureTable}
         WHERE report_id = $1 AND version_id = $2
         ORDER BY id ASC`, [reportId, versionId]
      ),
      pool.query(
        `SELECT id, applicant_type, response_type, count
         FROM ${applicationTable}
         WHERE report_id = $1 AND version_id = $2
         ORDER BY id ASC`, [reportId, versionId]
      ),
      pool.query(
        `SELECT id, case_type, result_type, count
         FROM ${legalTable}
         WHERE report_id = $1 AND version_id = $2
         ORDER BY id ASC`, [reportId, versionId]
      ),
      pool.query(
        `SELECT id, rule_code, severity, description, cell_ref
         FROM quality_issues
         WHERE report_id = $1 AND version_id = $2
         ORDER BY severity ASC, rule_code ASC, id ASC`, [reportId, versionId]
      ),
      pool.query(
        `SELECT metric_key, display_name, description, unit, caveats
         FROM metric_dictionary
         WHERE metric_key = ANY($1::text[])
           AND deprecated_at IS NULL
         ORDER BY metric_key ASC`, [METRIC_KEYS]
      ),
      pool.query(
        `SELECT id, created_at, finished_at
         FROM jobs
         WHERE report_id = $1
           AND version_id = $2
           AND kind = 'materialize'
         ORDER BY id DESC
         LIMIT 1`, [reportId, versionId]
      ),
    ]);

    const activeDisclosure = activeDisclosureRes.rows as FactActiveDisclosureRow[];
    const applications = applicationsRes.rows as FactApplicationRow[];
    const legalProceedings = legalProceedingsRes.rows as FactLegalProceedingRow[];
    const issues = issuesRes.rows as QualityIssueRow[];
    const metricDefs = metricDefsRes.rows as MetricDefinition[];
    const materializeJob = materializeJobRes.rows;

    const issueEvidenceRefs = issues
      .map((issue) => issue.cell_ref)
      .filter((ref): ref is string => Boolean(ref));

    const uniqueRefs = Array.from(new Set(issueEvidenceRefs));

    let cellRows: CellRow[] = [];
    if (uniqueRefs.length > 0) {
      const cellsRes = await pool.query(
        `SELECT id, table_id, row_key, col_key, cell_ref, value_raw, value_num, normalized_value
         FROM cells
         WHERE version_id = $1
           AND cell_ref = ANY($2::text[])
         ORDER BY id ASC`,
        [versionId, uniqueRefs]
      );
      cellRows = cellsRes.rows as CellRow[];
    }

    const fallbackCellRes = await pool.query(
      `SELECT id, table_id, row_key, col_key, cell_ref, value_raw, value_num, normalized_value
       FROM cells
       WHERE version_id = $1
       ORDER BY id ASC
       LIMIT 1`,
      [versionId]
    );
    const fallbackCell = fallbackCellRes.rows[0] as CellRow | undefined;

    const cellMap = new Map<string, CellRow>();
    cellRows.forEach((cell) => cellMap.set(cell.cell_ref, cell));

    const metricMap = new Map(metricDefs.map((metric) => [metric.metric_key, metric]));

    const metricValues: Record<string, number> = {
      active_disclosure_total: sumBy(activeDisclosure, 'made_count'),
      active_disclosure_valid: sumBy(activeDisclosure, 'valid_count'),
      application_received_total: sumBy(applications, 'count', (row) => row.response_type === 'new_received'),
      application_carried_over: sumBy(applications, 'count', (row) => row.response_type === 'carried_over'),
      application_granted: sumBy(applications, 'count', (row) => row.response_type === 'granted'),
      application_partial_grant: sumBy(applications, 'count', (row) => row.response_type === 'partial_grant'),
      application_denied_total: sumBy(applications, 'count', (row) => row.response_type.startsWith('denied_')),
      application_total_processed: sumBy(applications, 'count', (row) => row.response_type === 'total_processed'),
      legal_review_total: sumBy(legalProceedings, 'count', (row) => row.case_type === 'review' && row.result_type === 'total'),
      legal_litigation_total: sumBy(
        legalProceedings,
        'count',
        (row) => row.case_type !== 'review' && row.result_type === 'total'
      ),
    };

    const metricSections: Record<string, MetricItem[]> = {
      '主动公开类（fact_active_disclosure）': CATEGORY_METRIC_ORDER.active_disclosure.map((metricKey) =>
        toMetricItem(metricMap.get(metricKey), metricKey, metricValues[metricKey])
      ),
      '依申请公开类（fact_application）': CATEGORY_METRIC_ORDER.application.map((metricKey) =>
        toMetricItem(metricMap.get(metricKey), metricKey, metricValues[metricKey])
      ),
      '行政复议/诉讼类（fact_legal_proceeding）': CATEGORY_METRIC_ORDER.legal_proceeding.map((metricKey) =>
        toMetricItem(metricMap.get(metricKey), metricKey, metricValues[metricKey])
      ),
    };

    const issueItems = sortIssues(
      issues.map((issue) =>
        buildIssueItem(
          issue,
          issue.cell_ref ? cellMap.get(issue.cell_ref) || null : null,
          fallbackCell || null,
          reportId,
          versionId!
        )
      )
    );

    const issueGroups = groupIssues(issueItems);

    const evidenceAppendix = Array.from(
      new Map(
        issueItems
          .flatMap((issue) => issue.evidences)
          .map((evidence) => [`${evidence.table}-${evidence.row}-${evidence.col}`, evidence])
      ).values()
    ).sort((a, b) =>
      a.table.localeCompare(b.table) || a.row.localeCompare(b.row) || a.col.localeCompare(b.col)
    );

    const nowRes = await pool.query(`SELECT NOW() as generated_at`);
    const generatedAt = nowRes.rows[0]?.generated_at || new Date().toISOString();

    const titleUnit = report.unit_name || `Report ${report.id}`;
    const titleYear = report.year ? String(report.year) : '未知年份';
    const activeVersionId = report.active_version_id ? String(report.active_version_id) : '—';
    const materializeTime = materializeJob?.[0]?.finished_at || materializeJob?.[0]?.created_at || '—';

    const reportData: ReportSectionData = {
      title: `${titleUnit} 政务公开年报诊断报告（${titleYear}）`,
      statusLine: `报告状态：active_version_id=${activeVersionId} / 生成时间=${generatedAt} / 数据来源=facts/derived + cells 证据`,
      summaryLine: summarizeRiskPoints(issueItems),
      metrics: metricSections,
      issues: issueItems,
      issueGroups,
      actionSummary: buildActionSummary(),
      evidenceAppendix,
      versionInfo: [
        `reportId=${reportId}`,
        `versionId=${versionId}`,
        `active_version_id=${activeVersionId}`,
        `materialize_time=${materializeTime}`,
      ],
      includeEvidence: options.includeEvidence,
    };

    if (options.format === 'html') {
      return renderHtmlReport(reportData);
    }
    return renderMarkdownReport(reportData);
  }
}

export default ReportFactoryService;
