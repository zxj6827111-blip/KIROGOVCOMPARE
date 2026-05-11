import React from 'react';
import type { GovInsightBackendReportPayload } from '../utils/aiReport';
import { MIN_N_FOR_RANKING, RISK_THRESHOLDS } from '../leader-cockpit/riskPolicy';

type HierarchyAnalysis = NonNullable<GovInsightBackendReportPayload['hierarchyAnalysis']>;
type HierarchyFocusItem = NonNullable<HierarchyAnalysis['districtFocus']>[number];
type HierarchyCoverage = NonNullable<HierarchyAnalysis['districtCoverage']>;

const riskLevelLabel = (riskLevel?: string | null): string => {
  if (riskLevel === 'red') return '红牌关注';
  if (riskLevel === 'yellow') return '黄牌关注';
  if (riskLevel === 'green') return '绿色观察';
  return '待补充';
};

const riskLevelClassName = (riskLevel?: string | null): string => {
  if (riskLevel === 'red') return 'border-rose-300 bg-rose-50/40 text-rose-800';
  if (riskLevel === 'yellow') return 'border-amber-300 bg-amber-50/40 text-amber-800';
  if (riskLevel === 'green') return 'border-emerald-300 bg-emerald-50/40 text-emerald-800';
  return 'border-slate-300 bg-slate-50 text-slate-600';
};

const formatCount = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toLocaleString('zh-CN');
};

const formatPercent = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Number(value).toFixed(1)}%`;
};

const formatCoverage = (value?: string | null): string => {
  const normalized = String(value || '').trim();
  return normalized || '0/0';
};

const buildCoverageSummary = (coverage?: HierarchyCoverage): string => {
  if (!coverage) {
    return '覆盖单位 0 个，纳入底座 0/0，可直接分析 0/0，正式口径 0/0。';
  }

  return `覆盖单位 ${formatCount(coverage.total)} 个，纳入底座 ${formatCoverage(
    coverage.statsCoverage || coverage.reportCoverage
  )}，可直接分析 ${formatCoverage(
    coverage.analyzableCoverage || coverage.parseSuccessRate
  )}，正式口径 ${formatCoverage(coverage.officialCoverage)}。`;
};

const buildMethodNotes = (): string[] => [
  '区县层和部门层覆盖情况，分别反映当前纳入监测范围的区县、部门单位总量及其可用情况。',
  '“纳入底座”指已纳入当期监测底账；“可直接分析”指已有可比数据、可以开展当期研判；“正式口径”指达到当前年度正式使用条件的单位。',
  `红牌样本主要指受理总量达到${MIN_N_FOR_RANKING}件，且实质公开率低于${RISK_THRESHOLDS.disclosureRate.red}%或纠正占比高于${RISK_THRESHOLDS.correctionRate.red}%的单位；黄牌样本主要指受理总量达到${MIN_N_FOR_RANKING}件，且实质公开率低于${RISK_THRESHOLDS.disclosureRate.yellow}%或纠正占比高于${RISK_THRESHOLDS.correctionRate.yellow}%的单位；绿色观察为未触发前述阈值的样本；受理总量低于${MIN_N_FOR_RANKING}件的，标注为“样本偏小”，仅作观察提示。`,
  '以上内容属于基于当前底座和样本门槛形成的内部重点样本提示，不形成全量正式排名，不作为正式考核结论。',
];

const FocusTable = ({
  title,
  items,
  emptyText,
  limit,
}: {
  title: string;
  items: HierarchyFocusItem[];
  emptyText: string;
  limit: number;
}) => {
  const visibleItems = items.slice(0, limit);

  return (
    <div className="border border-slate-300 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h4 className="text-sm font-bold tracking-[0.01em] text-slate-900">{title}</h4>
      </div>
      {visibleItems.length ? (
        <div className="divide-y divide-slate-200">
          {visibleItems.map((item, index) => (
            <div key={`${item.orgId || item.regionId || index}`} className="px-4 py-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{item.orgName || '未命名单位'}</span>
                    <span
                      className={`inline-flex border px-2 py-0.5 text-[11px] font-semibold ${riskLevelClassName(item.riskLevel)}`}
                    >
                      {riskLevelLabel(item.riskLevel)}
                    </span>
                    {item.isSampleSufficient === false ? (
                      <span className="inline-flex border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        样本偏小
                      </span>
                    ) : null}
                  </div>
                  {item.riskReason ? (
                    <p className="text-xs leading-6 text-slate-600">{item.riskReason}</p>
                  ) : null}
                </div>
                <div className="grid min-w-[260px] gap-2 text-xs text-slate-600 md:grid-cols-2">
                  <div>
                    <span className="font-semibold text-slate-700">新收申请：</span>
                    {formatCount(item.newApplications)}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">受理总量：</span>
                    {formatCount(item.acceptedTotal)}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">公开率：</span>
                    {formatPercent(item.disclosureRate)}
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">纠正占比：</span>
                    {formatPercent(item.correctionRate)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-5 text-sm text-slate-500">{emptyText}</div>
      )}
    </div>
  );
};

export const HierarchySupportSummary: React.FC<{
  payload?: GovInsightBackendReportPayload | null;
  title?: string;
  subtitle?: string;
  limit?: number;
  showHeader?: boolean;
}> = ({
  payload,
  title = '三级监测重点摘要',
  subtitle = '本节依据既有三级监测结果，对已纳入监测范围且具备分析条件的区县、部门样本作内部提示，不形成全量正式排名，不作为正式考核结论。',
  limit = 5,
  showHeader = true,
}) => {
  const hierarchyAnalysis = payload?.hierarchyAnalysis;
  const methodNotes = buildMethodNotes();

  if (!hierarchyAnalysis) {
    return null;
  }

  const districtCoverage = hierarchyAnalysis.districtCoverage;
  const departmentCoverage = hierarchyAnalysis.departmentCoverage;
  const districtFocus = Array.isArray(hierarchyAnalysis.districtFocus) ? hierarchyAnalysis.districtFocus : [];
  const departmentFocus = Array.isArray(hierarchyAnalysis.departmentFocus) ? hierarchyAnalysis.departmentFocus : [];

  if (
    !districtCoverage?.available &&
    !departmentCoverage?.available &&
    districtFocus.length === 0 &&
    departmentFocus.length === 0
  ) {
    return null;
  }

  return (
    <section className="border border-slate-300 bg-white p-6">
      {showHeader ? (
        <div className="border-b border-slate-200 pb-3">
          <h3 className="text-[15px] font-bold tracking-[0.02em] text-slate-900">{title}</h3>
          <p className="mt-2 text-sm leading-[1.9] text-slate-600">{subtitle}</p>
        </div>
      ) : null}

      <div className={`${showHeader ? 'mt-4' : ''} space-y-3`}>
        {!showHeader ? (
          <div className="border border-slate-300 bg-slate-50 px-4 py-4">
            <p className="text-sm leading-[1.9] text-slate-700">{subtitle}</p>
          </div>
        ) : null}
        <div className="border border-slate-300 bg-slate-50/70 px-4 py-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">方法说明</p>
          <div className="mt-2 space-y-2">
            {methodNotes.map((note, index) => (
              <p key={`method-note-${index}`} className="text-sm leading-[1.9] text-slate-700">
                {note}
              </p>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="border border-slate-300 bg-slate-50/20 px-4 py-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">区县层覆盖情况</p>
          <p className="mt-2 text-sm leading-[1.9] text-slate-700">{buildCoverageSummary(districtCoverage)}</p>
        </div>
        <div className="border border-slate-300 bg-slate-50/20 px-4 py-4">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">部门层覆盖情况</p>
          <p className="mt-2 text-sm leading-[1.9] text-slate-700">{buildCoverageSummary(departmentCoverage)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <FocusTable
          title="区县层重点提示样本"
          items={districtFocus}
          emptyText="当前未返回可展示的区县层重点样本。"
          limit={limit}
        />
        <FocusTable
          title="部门层重点提示样本"
          items={departmentFocus}
          emptyText="当前未返回可展示的部门层重点样本。"
          limit={limit}
        />
      </div>
    </section>
  );
};

export default HierarchySupportSummary;
