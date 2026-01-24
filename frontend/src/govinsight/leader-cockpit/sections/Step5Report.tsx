import React from 'react';
import type { EvidenceItem, LeaderCockpitModel, LeaderCockpitReport } from '../types';
import { metricDefinitions, metricEvidence } from '../definitions';
import { formatNumber, formatPercent, getMetricDisplay } from '../utils';
import { ReportPreview } from '../components/ReportPreview';

interface Step5ReportProps {
  model: LeaderCockpitModel;
  report: LeaderCockpitReport;
  onReportChange: (report: LeaderCockpitReport) => void;
  onShowEvidence: (evidence?: EvidenceItem[]) => void;
}

const buildCsv = (rows: LeaderCockpitReport['rectificationTable'] = []) => {
  const header = ['问题', '行动', '责任', '期限', 'KPI'];
  const lines = rows.map((row) => [
    row.issue,
    row.action,
    row.owner,
    row.dueDate || '',
    row.kpi,
  ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','));
  return [header.join(','), ...lines].join('\n');
};

export const Step5Report: React.FC<Step5ReportProps> = ({
  model,
  report,
  onReportChange,
  onShowEvidence,
}) => {
  const handleGenerate = () => {
    const newApps = getMetricDisplay(model.metrics.newApplications, (value) => formatNumber(value));
    const correctionRate = getMetricDisplay(model.funnel.rates.correctionRate, (value) => formatPercent(value, 1));
    const disclosureRate = getMetricDisplay(model.metrics.substantiveDisclosureRate, (value) => formatPercent(value, 1));

    const content = `【风险提示】${model.city.name}${model.year}年依申请新收为${newApps}，纠错率为${correctionRate}。\n`
      + `【关注项】实质公开率为${disclosureRate}，建议结合原因结构持续跟踪。\n`
      + `【建议】围绕高频原因项开展专项复盘，形成统一口径与行动包。`;

    const rectificationTable = model.actionPacks.templates.map((pack) => ({
      id: pack.id,
      issue: pack.risk,
      action: pack.actions[0] || '待补充',
      owner: pack.ownerLine,
      dueDate: pack.cycle,
      kpi: pack.kpis[0] || '待补充',
    }));

    const metricAppendix = [
      metricDefinitions.newApplications,
      metricDefinitions.acceptedTotal,
      metricDefinitions.substantiveDisclosureRate,
      metricDefinitions.reconsiderationCorrectionRate,
      metricDefinitions.disputeConversion,
      metricDefinitions.correctionConversion,
      metricDefinitions.correctionRate,
      metricDefinitions.serviceRatio,
    ].filter(Boolean);

    const keyFindings = [
      {
        id: 'finding-correction',
        text: `风险提示：纠错率 ${correctionRate}（重点关注争议成本链条）`,
        evidence: metricEvidence.correctionRate,
      },
      {
        id: 'finding-application',
        text: `关注项：依申请新收 ${newApps}（需关注压力趋势）`,
        evidence: metricEvidence.newApplications,
      },
    ];

    onReportChange({
      content,
      rectificationTable,
      metricAppendix,
      keyFindings,
    });
  };

  const handleExportCsv = () => {
    const csv = buildCsv(report.rectificationTable);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${model.city.name}_${model.year}_整改清单.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ReportPreview
      report={report}
      onContentChange={(content) => onReportChange({ ...report, content })}
      onGenerate={handleGenerate}
      onExportCsv={handleExportCsv}
      onShowEvidence={onShowEvidence}
    />
  );
};
