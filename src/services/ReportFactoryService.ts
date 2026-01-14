import { dbQuery, dbType, dbNowExpression } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';

type ReportFormat = 'md' | 'html';

interface ReportFactoryOptions {
  reportId: number;
  versionId?: number;
  format: ReportFormat;
  includeEvidence: boolean;
}

interface ReportRow {
  id: number;
  region_id: number | null;
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
  severity: string;
  description: string;
  cell_ref: string | null;
  created_at: string | null;
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
  source_table: string;
  source_column: string | null;
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

const SEVERITY_ORDER: Record<string, number> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  info: 5,
};

function normalizeSeverity(severity: string): string {
  const normalized = severity?.toLowerCase() || 'unknown';
  return SEVERITY_ORDER[normalized] ? normalized : 'unknown';
}

function formatValue(value: number | null): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return Number.isFinite(value) ? String(value) : '—';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEvidenceSnippet(cell: CellRow, reportId: number, versionId: number): string {
  const raw = cell.normalized_value ?? cell.value_raw ?? (cell.value_num !== null ? String(cell.value_num) : '');
  const snippet = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
  return `reportId=${reportId} [evidence] table=${cell.table_id} row=${cell.row_key} col=${cell.col_key} value="${snippet}" (versionId=${versionId})`;
}

function summarizeRiskPoints(issues: QualityIssueRow[]): string[] {
  const counts = new Map<string, number>();
  issues.forEach((issue) => {
    const key = issue.rule_code || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([rule, count]) => `${rule}(${count})`);
}

function groupIssues(issues: QualityIssueRow[]): Array<{ severity: string; items: QualityIssueRow[] }> {
  const grouped = new Map<string, QualityIssueRow[]>();
  issues.forEach((issue) => {
    const severity = normalizeSeverity(issue.severity);
    if (!grouped.has(severity)) {
      grouped.set(severity, []);
    }
    grouped.get(severity)!.push(issue);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => {
      const aOrder = SEVERITY_ORDER[a[0]] ?? 99;
      const bOrder = SEVERITY_ORDER[b[0]] ?? 99;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a[0].localeCompare(b[0]);
    })
    .map(([severity, items]) => ({
      severity,
      items: items
        .slice()
        .sort((a, b) => a.rule_code.localeCompare(b.rule_code) || a.id - b.id),
    }));
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

export class ReportFactoryService {
  static async generate(options: ReportFactoryOptions): Promise<string> {
    const reportId = options.reportId;
    const report = (await dbQuery(
      `SELECT id, region_id, unit_name, year, active_version_id
       FROM reports
       WHERE id = ${dbType === 'postgres' ? '$1' : '?'}
       LIMIT 1`,
      [reportId]
    ))[0] as ReportRow | undefined;

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
      const version = (await dbQuery(
        `SELECT id, report_id FROM report_versions
         WHERE id = ${dbType === 'postgres' ? '$1' : '?'}
         LIMIT 1`,
        [versionId]
      ))[0] as ReportVersionRow | undefined;
      if (!version || version.report_id !== reportId) {
        const err: any = new Error('Version not found');
        err.statusCode = 404;
        throw err;
      }
    }

    const [activeDisclosure, applications, legalProceedings, issues, metricDefs, materializeJob] = await Promise.all([
      dbQuery(
        `SELECT id, category, made_count, repealed_count, valid_count, processed_count, amount
         FROM ${FACT_TABLES.active_disclosure}
         WHERE report_id = ${sqlValue(reportId)}
           AND version_id = ${sqlValue(versionId)}
         ORDER BY id ASC`
      ) as Promise<FactActiveDisclosureRow[]>,
      dbQuery(
        `SELECT id, applicant_type, response_type, count
         FROM ${FACT_TABLES.application}
         WHERE report_id = ${sqlValue(reportId)}
           AND version_id = ${sqlValue(versionId)}
         ORDER BY id ASC`
      ) as Promise<FactApplicationRow[]>,
      dbQuery(
        `SELECT id, case_type, result_type, count
         FROM ${FACT_TABLES.legal_proceeding}
         WHERE report_id = ${sqlValue(reportId)}
           AND version_id = ${sqlValue(versionId)}
         ORDER BY id ASC`
      ) as Promise<FactLegalProceedingRow[]>,
      dbQuery(
        `SELECT id, rule_code, severity, description, cell_ref, created_at
         FROM quality_issues
         WHERE report_id = ${sqlValue(reportId)}
           AND version_id = ${sqlValue(versionId)}
         ORDER BY severity ASC, rule_code ASC, id ASC`
      ) as Promise<QualityIssueRow[]>,
      dbQuery(
        `SELECT metric_key, display_name, description, unit, source_table, source_column, caveats
         FROM metric_dictionary
         WHERE metric_key IN (${METRIC_KEYS.map((key) => sqlValue(key)).join(', ')})
           AND deprecated_at IS NULL
         ORDER BY metric_key ASC`
      ) as Promise<MetricDefinition[]>,
      dbQuery(
        `SELECT id, created_at, finished_at
         FROM jobs
         WHERE report_id = ${sqlValue(reportId)}
           AND version_id = ${sqlValue(versionId)}
           AND kind = 'materialize'
         ORDER BY id DESC
         LIMIT 1`
      ),
    ]);

    const issueEvidenceRefs = issues
      .map((issue) => issue.cell_ref)
      .filter((ref): ref is string => Boolean(ref));

    const uniqueRefs = Array.from(new Set(issueEvidenceRefs));
    const cellRows = uniqueRefs.length
      ? await dbQuery(
        `SELECT id, table_id, row_key, col_key, cell_ref, value_raw, value_num, normalized_value
         FROM cells
         WHERE version_id = ${sqlValue(versionId)}
           AND cell_ref IN (${uniqueRefs.map((ref) => sqlValue(ref)).join(', ')})
         ORDER BY id ASC`
      )
      : [];

    let fallbackCell: CellRow | null = null;
    if (issues.length > 0 && cellRows.length === 0) {
      const fallback = (await dbQuery(
        `SELECT id, table_id, row_key, col_key, cell_ref, value_raw, value_num, normalized_value
         FROM cells
         WHERE version_id = ${sqlValue(versionId)}
         ORDER BY id ASC
         LIMIT 1`
      )) as CellRow[];
      fallbackCell = fallback[0] ?? null;
    }

    const cellMap = new Map<string, CellRow>();
    (cellRows as CellRow[]).forEach((cell) => cellMap.set(cell.cell_ref, cell));

    const metricsByKey = new Map(metricDefs.map((metric) => [metric.metric_key, metric]));

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

    const issueGroups = groupIssues(issues);
    const riskPoints = summarizeRiskPoints(issues);
    const issueCount = issues.length;
    const nowRow = (await dbQuery(`SELECT ${dbNowExpression()} as generated_at`))[0] as { generated_at?: string } | undefined;
    const generatedAt = nowRow?.generated_at || new Date().toISOString();

    const titleUnit = report.unit_name || `Report ${report.id}`;
    const titleYear = report.year ? String(report.year) : '未知年份';

    const activeVersionId = report.active_version_id ? String(report.active_version_id) : '—';
    const materializeTime = materializeJob?.[0]?.finished_at || materializeJob?.[0]?.created_at || '—';

    const evidenceRows = new Map<string, CellRow>();
    const issueLines: string[] = [];
    issueGroups.forEach((group) => {
      issueLines.push(`### 严重程度：${group.severity}`);
      group.items.forEach((issue) => {
        const evidence: string[] = [];
        const cell = issue.cell_ref ? cellMap.get(issue.cell_ref) : null;
        if (cell) {
          evidence.push(buildEvidenceSnippet(cell, reportId, versionId!));
          evidenceRows.set(cell.cell_ref, cell);
        } else if (fallbackCell) {
          evidence.push(buildEvidenceSnippet(fallbackCell, reportId, versionId!));
          evidenceRows.set(fallbackCell.cell_ref, fallbackCell);
        }

        issueLines.push(`- **问题描述**：${issue.description}`);
        issueLines.push(`  - 影响/风险：${issue.rule_code} 可能导致指标统计偏差或合规风险。`);
        issueLines.push(`  - 建议整改动作：核对对应条目填报逻辑，补充缺失/异常数据，并重新物化版本。`);
        issueLines.push(`  - 证据链：${evidence.join('；') || '暂无可用证据'}`);
      });
    });

    const metricLines = (sectionTitle: string, metricKeys: string[]): string[] => {
      const lines: string[] = [];
      lines.push(`### ${sectionTitle}`);
      metricKeys.forEach((key) => {
        const def = metricsByKey.get(key);
        const value = metricValues[key];
        lines.push(`- ${def?.display_name || key}: ${formatValue(value)} ${def?.unit || ''}`.trim());
        const description = def?.description ? `口径说明：${def.description}` : '口径说明：未配置';
        lines.push(`  - ${description}`);
        if (def?.caveats) {
          lines.push(`  - 注意：${def.caveats}`);
        }
      });
      return lines;
    };

    const reportLines: string[] = [];
    reportLines.push(`# ${titleUnit} 政务公开年报诊断报告（${titleYear}）`);
    reportLines.push('');
    reportLines.push('## 1. 摘要');
    reportLines.push(`- 报告状态：active_version_id=${activeVersionId} / 生成时间=${generatedAt} / 数据来源=facts/derived + cells 证据`);
    reportLines.push(`- 关键结论：问题数量=${issueCount}，关键风险点=${riskPoints.length ? riskPoints.join('，') : '暂无'}`);
    reportLines.push('');
    reportLines.push('## 2. 核心指标概览（facts/derived）');
    reportLines.push(...metricLines('主动公开类（fact_active_disclosure）', [
      'active_disclosure_total',
      'active_disclosure_valid',
    ]));
    reportLines.push(...metricLines('依申请公开类（fact_application）', [
      'application_received_total',
      'application_carried_over',
      'application_granted',
      'application_partial_grant',
      'application_denied_total',
      'application_total_processed',
    ]));
    reportLines.push(...metricLines('行政复议/诉讼类（fact_legal_proceeding）', [
      'legal_review_total',
      'legal_litigation_total',
    ]));
    reportLines.push('');
    reportLines.push('## 3. 问题清单（可核验）');
    if (issueLines.length === 0) {
      reportLines.push('- 暂无质量问题。');
    } else {
      reportLines.push(...issueLines);
    }

    if (options.includeEvidence) {
      reportLines.push('');
      reportLines.push('## 4. 证据附件');
      if (evidenceRows.size === 0) {
        reportLines.push('- 暂无可追溯 cells 证据。');
      } else {
        reportLines.push('| table_id | row_key | col_key | value | cell_ref |');
        reportLines.push('| --- | --- | --- | --- | --- |');
        Array.from(evidenceRows.values())
          .sort((a, b) => a.table_id.localeCompare(b.table_id) || a.row_key.localeCompare(b.row_key) || a.col_key.localeCompare(b.col_key))
          .forEach((cell) => {
            const raw = cell.normalized_value ?? cell.value_raw ?? (cell.value_num !== null ? String(cell.value_num) : '');
            const snippet = raw.length > 60 ? `${raw.slice(0, 57)}...` : raw;
            reportLines.push(`| ${cell.table_id} | ${cell.row_key} | ${cell.col_key} | ${snippet || '—'} | ${cell.cell_ref} |`);
          });
      }
    }

    reportLines.push('');
    reportLines.push('## 5. 版本与生成信息');
    reportLines.push(`- reportId=${reportId}`);
    reportLines.push(`- versionId=${versionId}`);
    reportLines.push(`- active_version_id=${activeVersionId}`);
    reportLines.push(`- materialize_time=${materializeTime || '—'}`);

    const markdown = reportLines.join('\n');
    if (options.format === 'html') {
      return `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(titleUnit)} 报告</title></head><body><pre>${escapeHtml(markdown)}</pre></body></html>`;
    }
    return markdown;
  }
}

export default ReportFactoryService;
