import React from 'react';
import { formatInteger, type EnhancedAIReportResponse } from '../utils/aiReport';

type ReconciliationCheck = EnhancedAIReportResponse['appendices']['reconciliationChecks'][number];

type ReconciliationCheckCardsProps = {
  checks: ReconciliationCheck[];
  variant?: 'screen' | 'print';
  className?: string;
};

const getCheckTone = (passed: boolean) =>
  passed
    ? {
        wrapper: 'border-slate-200 border-l-emerald-500 bg-emerald-50/20',
        badge: 'border-emerald-200 bg-emerald-100 text-emerald-700',
        metric: 'border-emerald-100 bg-white/85',
        label: 'text-emerald-700',
        status: '校验通过',
      }
    : {
        wrapper: 'border-amber-200 border-l-amber-500 bg-amber-50/35',
        badge: 'border-amber-200 bg-amber-100 text-amber-800',
        metric: 'border-amber-100 bg-white/88',
        label: 'text-amber-800',
        status: '建议复核',
      };

export const ReconciliationCheckCards: React.FC<ReconciliationCheckCardsProps> = ({
  checks,
  variant = 'screen',
  className = '',
}) => {
  if (!checks.length) return null;

  const isPrint = variant === 'print';

  return (
    <div className={`${className} space-y-3`.trim()}>
      {checks.map((check) => {
        const tone = getCheckTone(check.passed);

        return (
          <div
            key={check.key}
            className={`${isPrint ? 'report-avoid-break ' : ''}overflow-hidden border border-l-4 ${tone.wrapper}`.trim()}
          >
            <div
              className={`grid gap-3 px-4 py-4 ${
                isPrint ? 'md:grid-cols-[minmax(0,1.55fr)_160px_160px]' : 'lg:grid-cols-[minmax(0,1.7fr)_180px_180px]'
              }`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`${isPrint ? 'text-[14px]' : 'text-[15px]'} font-bold tracking-[0.01em] text-slate-900`}>
                    {check.label}
                  </p>
                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badge}`}>
                    {tone.status}
                  </span>
                </div>
                <div className="mt-3 border-t border-dashed border-slate-200 pt-3">
                  <p className={`text-xs font-semibold tracking-[0.08em] ${tone.label}`}>校验说明</p>
                  <p className={`${isPrint ? 'mt-2 text-[14px] leading-7' : 'mt-2 text-sm leading-[1.9]'} text-slate-700`}>
                    {check.note}
                  </p>
                </div>
              </div>

              <div className={`border px-3 py-3 ${tone.metric}`}>
                <p className={`text-xs font-semibold tracking-[0.08em] ${tone.label}`}>期望值</p>
                <p className={`${isPrint ? 'mt-2 text-[18px]' : 'mt-2 text-lg'} font-bold text-slate-900`}>
                  {formatInteger(check.expected)}
                </p>
              </div>

              <div className={`border px-3 py-3 ${tone.metric}`}>
                <p className={`text-xs font-semibold tracking-[0.08em] ${tone.label}`}>实际值</p>
                <p className={`${isPrint ? 'mt-2 text-[18px]' : 'mt-2 text-lg'} font-bold text-slate-900`}>
                  {formatInteger(check.actual)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
