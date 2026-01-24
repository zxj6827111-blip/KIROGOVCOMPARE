import React from 'react';
import type { EvidenceItem, LeaderCockpitReport } from '../types';

interface ReportPreviewProps {
  report: LeaderCockpitReport;
  onContentChange: (content: string) => void;
  onGenerate: () => void;
  onExportCsv: () => void;
  onShowEvidence: (evidence?: EvidenceItem[]) => void;
}

export const ReportPreview: React.FC<ReportPreviewProps> = ({
  report,
  onContentChange,
  onGenerate,
  onExportCsv,
  onShowEvidence,
}) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-slate-800">AI 报告正文</h3>
          <button
            type="button"
            onClick={onGenerate}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-900 text-white"
          >
            一键生成报告
          </button>
        </div>
        <textarea
          value={report.content || ''}
          onChange={(e) => onContentChange(e.target.value)}
          className="w-full border border-slate-200 rounded p-3 text-sm min-h-[180px]"
          placeholder="点击一键生成报告或手动编辑正文..."
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">关键结论与证据</h3>
        </div>
        <div className="space-y-2">
          {report.keyFindings?.length ? report.keyFindings.map((finding) => (
            <div key={finding.id} className="flex items-center justify-between text-xs text-slate-700 bg-slate-50 rounded p-2">
              <span>{finding.text}</span>
              {finding.evidence && finding.evidence.length > 0 && (
                <button
                  type="button"
                  onClick={() => onShowEvidence(finding.evidence)}
                  className="text-blue-600"
                >
                  查看证据
                </button>
              )}
            </div>
          )) : (
            <div className="text-xs text-slate-400">暂无结论</div>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-800">整改清单</h3>
          <button
            type="button"
            onClick={onExportCsv}
            className="text-xs text-blue-600"
          >
            导出 CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="text-left py-2">问题</th>
                <th className="text-left py-2">行动</th>
                <th className="text-left py-2">责任</th>
                <th className="text-left py-2">期限</th>
                <th className="text-left py-2">KPI</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {report.rectificationTable?.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3">{row.issue}</td>
                  <td className="py-2 pr-3">{row.action}</td>
                  <td className="py-2 pr-3">{row.owner}</td>
                  <td className="py-2 pr-3">{row.dueDate || '-'} </td>
                  <td className="py-2 pr-3">{row.kpi}</td>
                </tr>
              ))}
              {!report.rectificationTable?.length && (
                <tr>
                  <td className="py-3 text-slate-400" colSpan={5}>暂无整改清单</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">口径附录</h3>
        <div className="space-y-3 text-xs text-slate-600">
          {report.metricAppendix?.map((def) => (
            <div key={def.id} className="border border-slate-100 rounded p-3 bg-slate-50">
              <div className="font-semibold text-slate-700">{def.name}</div>
              <div className="text-slate-500">{def.formula}</div>
              <div className="text-slate-600 mt-1">{def.description}</div>
            </div>
          ))}
          {!report.metricAppendix?.length && (
            <div className="text-slate-400">暂无口径附录</div>
          )}
        </div>
      </div>
    </div>
  );
};
