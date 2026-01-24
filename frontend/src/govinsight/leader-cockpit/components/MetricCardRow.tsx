import React from 'react';
import type { MetricValue } from '../types';
import { formatNumber, formatPercent, getMetricDisplay } from '../utils';

interface MetricCardRowProps {
  metrics: Array<{
    key: string;
    title: string;
    metric: MetricValue;
    format: 'number' | 'percent';
  }>;
  selectedVariant?: Record<string, string>;
  onVariantChange?: (metricKey: string, variantId: string) => void;
  onShowDefinition: (definition: MetricValue['definition'] | undefined) => void;
  onShowEvidence: (evidence: MetricValue['evidence'] | undefined) => void;
}

export const MetricCardRow: React.FC<MetricCardRowProps> = ({
  metrics,
  selectedVariant,
  onVariantChange,
  onShowDefinition,
  onShowEvidence,
}) => {
  const formatter = (metric: MetricValue, type: 'number' | 'percent') => {
    if (type === 'percent') {
      return getMetricDisplay(metric, (value) => formatPercent(value, 1));
    }
    return getMetricDisplay(metric, (value) => formatNumber(value));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {metrics.map(({ key, title, metric, format }) => (
        <div key={key} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-500">{title}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onShowDefinition(metric.definition)}
                className="text-[10px] text-blue-600 hover:text-blue-700"
              >
                i 口径
              </button>
              <button
                type="button"
                onClick={() => onShowEvidence(metric.evidence)}
                className="text-[10px] text-slate-500 hover:text-slate-700"
              >
                查看证据
              </button>
            </div>
          </div>
          <div className="mt-3 text-2xl font-bold text-slate-800">
            {formatter(metric, format)}
            {metric.status === 'ok' && metric.unit && (
              <span className="text-xs text-slate-400 ml-1">{metric.unit}</span>
            )}
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {metric.yoy === null || metric.yoy === undefined
              ? '暂无同比数据'
              : `同比 ${metric.yoy >= 0 ? '+' : ''}${metric.yoy}%`
            }
          </div>
          {metric.variants && metric.variants.length > 0 && (
            <div className="mt-3">
              <select
                className="w-full border border-slate-200 rounded text-xs px-2 py-1"
                value={selectedVariant?.[key] || metric.variants[0].id}
                onChange={(e) => onVariantChange?.(key, e.target.value)}
              >
                {metric.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
