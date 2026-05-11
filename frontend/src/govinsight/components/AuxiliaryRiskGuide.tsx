import React from 'react';
import {
  buildAuxiliaryRiskLevelExplanation,
  type DataQualityStatus,
  type ReportMetricsSnapshot,
  type ReportRating,
} from '../utils/aiReport';

type GuideVariant = 'screen' | 'print';

interface AuxiliaryRiskGuideProps {
  current: ReportMetricsSnapshot;
  previous?: ReportMetricsSnapshot | null;
  dataQuality: DataQualityStatus;
  rating?: ReportRating | null;
  riskLabel?: string | null;
  reason?: string | null;
  note?: string | null;
  className?: string;
  variant?: GuideVariant;
}

const GUIDE_TONES: Record<
  ReportRating,
  {
    shell: string;
    badge: string;
    highlight: string;
    summaryCard: string;
    activeLevel: string;
    activeLevelText: string;
  }
> = {
  A: {
    shell: 'border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-emerald-100/80',
    badge: 'border-emerald-300 bg-emerald-100 text-emerald-800',
    highlight: 'text-emerald-800',
    summaryCard: 'border-emerald-200 bg-white/85',
    activeLevel: 'border-emerald-300 bg-emerald-50 shadow-sm',
    activeLevelText: 'text-emerald-800',
  },
  B: {
    shell: 'border-amber-300 bg-gradient-to-br from-amber-50 via-white to-amber-100/80',
    badge: 'border-amber-300 bg-amber-100 text-amber-800',
    highlight: 'text-amber-900',
    summaryCard: 'border-amber-200 bg-white/85',
    activeLevel: 'border-amber-300 bg-amber-50 shadow-sm',
    activeLevelText: 'text-amber-900',
  },
  C: {
    shell: 'border-rose-300 bg-gradient-to-br from-rose-50 via-white to-rose-100/80',
    badge: 'border-rose-300 bg-rose-100 text-rose-800',
    highlight: 'text-rose-900',
    summaryCard: 'border-rose-200 bg-white/85',
    activeLevel: 'border-rose-300 bg-rose-50 shadow-sm',
    activeLevelText: 'text-rose-900',
  },
};

export const AuxiliaryRiskGuide: React.FC<AuxiliaryRiskGuideProps> = ({
  current,
  previous = null,
  dataQuality,
  rating,
  riskLabel,
  reason,
  note,
  className = '',
  variant = 'screen',
}) => {
  const guide = buildAuxiliaryRiskLevelExplanation(current, previous, dataQuality, {
    rating: rating || undefined,
    riskLabel: riskLabel || undefined,
    reason: reason || undefined,
  });
  const tone = GUIDE_TONES[guide.rating];
  const compact = variant === 'print';

  return (
    <section className={`${tone.shell} border px-4 py-4 ${compact ? '' : 'shadow-sm'} ${className}`.trim()}>
      <div className="flex flex-wrap items-center gap-2.5">
        <p className={`inline-flex items-center border px-3 py-1 text-xs font-semibold tracking-[0.12em] ${tone.badge}`}>
          辅助风险等级说明
        </p>
        <p className="inline-flex items-center rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-sm font-semibold text-slate-900">
          当前等级：{guide.currentLevelText}
        </p>
        <p className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${tone.badge}`}>
          共 {guide.levelCount} 级
        </p>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.85fr)]">
        <div className="border border-white/70 bg-white/86 px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">当前判定</p>
          <p className={`mt-2 font-semibold leading-[1.85] text-slate-900 ${compact ? 'text-[15px]' : 'text-sm'}`}>{guide.reason}</p>
          <div className={`mt-3 grid gap-2 ${guide.currentBasis.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {guide.currentBasis.map((item, index) => (
              <div key={`basis-${index}`} className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50/75 px-3 py-2">
                <span
                  className={`mt-[7px] h-2 w-2 flex-shrink-0 rounded-full ${
                    guide.rating === 'A' ? 'bg-emerald-500' : guide.rating === 'B' ? 'bg-amber-500' : 'bg-rose-500'
                  }`}
                ></span>
                <span className={`${compact ? 'text-[13px] leading-6' : 'text-xs leading-6'} text-slate-700`}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={`border px-4 py-3 ${tone.summaryCard}`}>
          <p className="text-xs font-semibold tracking-[0.12em] text-slate-500">等级含义</p>
          <p className={`mt-2 font-semibold ${tone.highlight} ${compact ? 'text-[15px]' : 'text-sm'}`}>
            {guide.rating}级属于当前系统的{guide.rating === 'A' ? '平稳档' : guide.rating === 'B' ? '中间提醒档' : '集中攻坚档'}。
          </p>
          <p className="mt-2 text-xs leading-6 text-slate-600">系统目前只使用 A / B / C 三档，客户可以直接据此判断所处位置和处理强度。</p>
          {note ? <p className="mt-2 border-t border-slate-200 pt-2 text-xs leading-6 text-slate-600">{note}</p> : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {guide.levels.map((level) => {
          const isActive = level.rating === guide.rating;
          return (
            <div
              key={level.rating}
              className={`border px-3 py-3 ${
                isActive ? tone.activeLevel : 'border-slate-200 bg-white/86'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className={`text-[17px] font-bold ${isActive ? tone.activeLevelText : 'text-slate-900'}`}>{level.rating}级</p>
                {isActive ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
                    当前
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">{level.title}</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-600">{level.summary}</p>
              <p className="mt-2 border-t border-slate-200 pt-2 text-[11px] leading-5 text-slate-600">{level.thresholdText}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
};
