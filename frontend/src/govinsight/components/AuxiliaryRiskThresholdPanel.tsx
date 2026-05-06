import React from 'react';
import {
  buildAuxiliaryRiskThresholdMetrics,
  type AuxiliaryRiskThresholdMetric,
  type AuxiliaryRiskThresholdStatus,
  type ReportMetricsSnapshot,
} from '../utils/aiReport';

interface AuxiliaryRiskThresholdPanelProps {
  current: ReportMetricsSnapshot;
  previous?: ReportMetricsSnapshot | null;
  generatedAt?: string | null;
  engineLabel?: string | null;
  className?: string;
}

const STATUS_TONE: Record<
  AuxiliaryRiskThresholdStatus,
  {
    dot: string;
    badge: string;
    border: string;
    bg: string;
    label: string;
  }
> = {
  stable: {
    dot: 'bg-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    border: 'border-emerald-100',
    bg: 'bg-emerald-50/35',
    label: '平稳',
  },
  attention: {
    dot: 'bg-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
    border: 'border-amber-100',
    bg: 'bg-amber-50/35',
    label: '关注',
  },
  critical: {
    dot: 'bg-rose-500',
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
    border: 'border-rose-100',
    bg: 'bg-rose-50/35',
    label: '攻坚',
  },
};

const MetricRow = ({ item }: { item: AuxiliaryRiskThresholdMetric }) => {
  const tone = STATUS_TONE[item.status];

  return (
    <div className={`rounded-lg border px-3 py-3 ${tone.border} ${tone.bg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${tone.dot}`}></span>
            <p className="text-sm font-semibold text-slate-900">{item.label}</p>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.thresholdText}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold text-slate-900">{item.valueText}</p>
          <span className={`mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
            {tone.label}
          </span>
        </div>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{item.description}</p>
    </div>
  );
};

export const AuxiliaryRiskThresholdPanel: React.FC<AuxiliaryRiskThresholdPanelProps> = ({
  current,
  previous = null,
  generatedAt,
  engineLabel,
  className = '',
}) => {
  const metrics = buildAuxiliaryRiskThresholdMetrics(current, previous);

  return (
    <section
      className={`border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-100/70 px-4 py-4 shadow-sm ${className}`.trim()}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="inline-flex items-center border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-slate-700">
            关键阈值速览
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600">把当前值和判定阈值放在一起，客户一眼就能看懂为什么会判到这个等级。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {generatedAt ? (
            <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
              生成时间：{generatedAt}
            </span>
          ) : null}
          {engineLabel ? (
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              生成方式：{engineLabel}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map((item) => (
          <MetricRow key={item.key} item={item} />
        ))}
      </div>
    </section>
  );
};
