import { CATEGORY_LABELS, IssueCategory, IssueSeverity } from './mappings';

export interface EvidenceItem {
  table: string;
  row: string;
  col: string;
  value: string;
  reportId: number;
  versionId: number;
}

export interface IssueItem {
  title: string;
  severity: IssueSeverity;
  category: IssueCategory;
  risk: string;
  actions: string[];
  evidences: EvidenceItem[];
  metricKey?: string | null;
  issueCode: string;
  issueId: number;
}

export interface MetricItem {
  metricKey: string;
  displayName: string;
  value: string;
  unit?: string | null;
  description: string;
  caveats?: string | null;
}

export interface ReportSectionData {
  title: string;
  statusLine: string;
  summaryLine: string;
  metrics: Record<string, MetricItem[]>;
  issues: IssueItem[];
  issueGroups: Array<{ severity: IssueSeverity; category: IssueCategory; items: IssueItem[] }>;
  actionSummary: Array<{ category: IssueCategory; actions: string[] }>;
  evidenceAppendix: EvidenceItem[];
  versionInfo: string[];
  includeEvidence: boolean;
}

function buildEvidenceLine(item: EvidenceItem): string {
  return `[evidence] table=${item.table} row=${item.row} col=${item.col} value="${item.value}" (reportId=${item.reportId} versionId=${item.versionId})`;
}

export function renderMarkdownReport(data: ReportSectionData): string {
  const lines: string[] = [];
  lines.push(`# ${data.title}`);
  lines.push('');
  lines.push('## 1. 摘要');
  lines.push(`- ${data.statusLine}`);
  lines.push(`- ${data.summaryLine}`);
  lines.push('');
  lines.push('## 2. 核心指标概览');
  Object.entries(data.metrics).forEach(([section, metrics]) => {
    lines.push(`### ${section}`);
    metrics.forEach((metric) => {
      const unit = metric.unit ? ` ${metric.unit}` : '';
      lines.push(`- ${metric.displayName} (${metric.metricKey}): ${metric.value}${unit}`.trim());
      lines.push(`  - 口径说明：${metric.description || '未配置'}`);
      if (metric.caveats) {
        lines.push(`  - 注意：${metric.caveats}`);
      }
    });
  });
  lines.push('');
  lines.push('## 3. 问题清单');
  data.issueGroups.forEach((group) => {
    lines.push(`### 严重程度：${group.severity} / 类别：${CATEGORY_LABELS[group.category]}`);
    group.items.forEach((issue) => {
      lines.push(`- 问题标题：${issue.title}`);
      lines.push(`  - 严重程度：${issue.severity}`);
      lines.push(`  - 类别：${issue.category}`);
      lines.push(`  - 风险影响：${issue.risk}`);
      lines.push('  - 整改建议：');
      issue.actions.forEach((action) => {
        lines.push(`    - ${action}`);
      });
      lines.push('  - 证据链：');
      issue.evidences.forEach((evidence) => {
        lines.push(`    - ${buildEvidenceLine(evidence)}`);
      });
      if (issue.metricKey) {
        lines.push(`  - 关联指标：${issue.metricKey}`);
      }
    });
  });
  lines.push('');
  lines.push('## 4. 整改建议汇总');
  data.actionSummary.forEach((summary) => {
    lines.push(`### ${CATEGORY_LABELS[summary.category]}`);
    summary.actions.forEach((action) => {
      lines.push(`- ${action}`);
    });
  });
  if (data.includeEvidence) {
    lines.push('');
    lines.push('## 5. 证据附件');
    if (data.evidenceAppendix.length === 0) {
      lines.push('- 暂无证据。');
    } else {
      lines.push('| table | row | col | value | reportId | versionId |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      data.evidenceAppendix.forEach((evidence) => {
        lines.push(
          `| ${evidence.table} | ${evidence.row} | ${evidence.col} | ${evidence.value || '—'} | ${evidence.reportId} | ${evidence.versionId} |`
        );
      });
    }
  }
  lines.push('');
  lines.push('## 6. 版本与生成信息');
  data.versionInfo.forEach((line) => lines.push(`- ${line}`));

  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderHtmlReport(data: ReportSectionData): string {
  const renderEvidenceList = (items: EvidenceItem[]) =>
    items
      .map(
        (item) =>
          `<li>${escapeHtml(buildEvidenceLine(item))}</li>`
      )
      .join('');

  const metricsHtml = Object.entries(data.metrics)
    .map(([section, metrics]) => {
      const items = metrics
        .map((metric) => {
          const unit = metric.unit ? ` ${metric.unit}` : '';
          return `
            <li>
              <strong>${escapeHtml(metric.displayName)}</strong> (${escapeHtml(metric.metricKey)}): ${escapeHtml(metric.value + unit)}
              <ul>
                <li>口径说明：${escapeHtml(metric.description || '未配置')}</li>
                ${metric.caveats ? `<li>注意：${escapeHtml(metric.caveats)}</li>` : ''}
              </ul>
            </li>
          `;
        })
        .join('');
      return `<section><h3>${escapeHtml(section)}</h3><ul>${items}</ul></section>`;
    })
    .join('');

  const issuesHtml = data.issueGroups
    .map((group) => {
      const items = group.items
        .map((issue) => {
          const actions = issue.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('');
          const evidences = renderEvidenceList(issue.evidences);
          return `
            <li>
              <h4>${escapeHtml(issue.title)}</h4>
              <ul>
                <li><strong>严重程度</strong>：${escapeHtml(issue.severity)}</li>
                <li><strong>类别</strong>：${escapeHtml(issue.category)}</li>
                <li><strong>风险影响</strong>：${escapeHtml(issue.risk)}</li>
                <li><strong>整改建议</strong><ul>${actions}</ul></li>
                <li><strong>证据链</strong><ul>${evidences}</ul></li>
                ${issue.metricKey ? `<li><strong>关联指标</strong>：${escapeHtml(issue.metricKey)}</li>` : ''}
              </ul>
            </li>
          `;
        })
        .join('');
      return `
        <section>
          <h3>严重程度：${escapeHtml(group.severity)} / 类别：${escapeHtml(CATEGORY_LABELS[group.category])}</h3>
          <ul>${items}</ul>
        </section>
      `;
    })
    .join('');

  const actionsHtml = data.actionSummary
    .map((summary) => {
      const items = summary.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('');
      return `<section><h3>${escapeHtml(CATEGORY_LABELS[summary.category])}</h3><ul>${items}</ul></section>`;
    })
    .join('');

  const evidenceAppendixHtml = data.includeEvidence
    ? `
      <section>
        <h2>5. 证据附件</h2>
        ${data.evidenceAppendix.length === 0
          ? '<p>暂无证据。</p>'
          : `<table><thead><tr><th>table</th><th>row</th><th>col</th><th>value</th><th>reportId</th><th>versionId</th></tr></thead><tbody>
            ${data.evidenceAppendix
              .map(
                (item) =>
                  `<tr><td>${escapeHtml(item.table)}</td><td>${escapeHtml(item.row)}</td><td>${escapeHtml(item.col)}</td><td>${escapeHtml(item.value || '—')}</td><td>${item.reportId}</td><td>${item.versionId}</td></tr>`
              )
              .join('')}
          </tbody></table>`}
      </section>
    `
    : '';

  const versionInfoHtml = data.versionInfo.map((line) => `<li>${escapeHtml(line)}</li>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(data.title)}</title>
  <style>
    body { font-family: "Noto Sans", "Microsoft YaHei", sans-serif; color: #0f172a; line-height: 1.6; }
    h1, h2, h3, h4 { margin: 0.6em 0 0.3em; }
    h1 { font-size: 24px; }
    h2 { font-size: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    h3 { font-size: 16px; color: #1e293b; }
    ul { padding-left: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #e2e8f0; padding: 6px; text-align: left; font-size: 12px; }
    @media print { body { color: #000; } table { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  <section>
    <h2>1. 摘要</h2>
    <ul>
      <li>${escapeHtml(data.statusLine)}</li>
      <li>${escapeHtml(data.summaryLine)}</li>
    </ul>
  </section>
  <section>
    <h2>2. 核心指标概览</h2>
    ${metricsHtml}
  </section>
  <section>
    <h2>3. 问题清单</h2>
    ${issuesHtml}
  </section>
  <section>
    <h2>4. 整改建议汇总</h2>
    ${actionsHtml}
  </section>
  ${evidenceAppendixHtml}
  <section>
    <h2>6. 版本与生成信息</h2>
    <ul>${versionInfoHtml}</ul>
  </section>
</body>
</html>`;
}
