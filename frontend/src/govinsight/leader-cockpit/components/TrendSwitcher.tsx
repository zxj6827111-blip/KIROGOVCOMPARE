import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ComposedChart, Area } from 'recharts';
import type { Formatter as LegendFormatter, LegendPayload } from 'recharts/types/component/DefaultLegendContent';
import type { Formatter as TooltipFormatter, NameType, Payload, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import type { YearSeries } from '../types';
import { formatNumber, formatPercent } from '../utils';
import { DEFAULT_OVERLAY_COMPARE } from '../riskPolicy';

interface TrendSwitcherProps {
  pressure: YearSeries;
  quality: YearSeries;
  risk: YearSeries;
}

const buildChartData = (series: YearSeries) => {
  return series.points.map((point) => ({
    year: point.year,
    value: point.status === 'ok' ? point.value : null,
  }));
};

export const TrendSwitcher: React.FC<TrendSwitcherProps> = ({ pressure, quality, risk }) => {
  const [active, setActive] = useState<'pressure' | 'quality' | 'risk'>('pressure');
  const [overlayEnabled, setOverlayEnabled] = useState(DEFAULT_OVERLAY_COMPARE);
  const seriesMeta = {
    pressure: { label: '压力', unit: '件', color: '#3b82f6' },
    quality: { label: '质量', unit: '%', color: '#10b981' },
    risk: { label: '风险', unit: '%', color: '#f43f5e' },
  } as const;
  const activeMeta = seriesMeta[active];
  const activeLegendLabel = `${activeMeta.label}（${activeMeta.unit}）`;

  const formatSeriesValue = (value: ValueType | undefined, unit?: string) => {
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized === null || normalized === undefined || normalized === '') return '—';
    const numericValue = typeof normalized === 'string' ? Number(normalized) : normalized;
    if (Number.isNaN(numericValue)) return '—';
    if (unit === '%') return formatPercent(numericValue, 1);
    return unit ? `${formatNumber(numericValue)}${unit}` : formatNumber(numericValue);
  };

  const dataBySeries = useMemo(() => ({
    pressure: buildChartData(pressure),
    quality: buildChartData(quality),
    risk: buildChartData(risk),
  }), [pressure, quality, risk]);

  const combinedData = useMemo(() => {
    const years = pressure.points.map((p) => p.year);
    return years.map((year, idx) => ({
      year,
      pressure: dataBySeries.pressure[idx]?.value ?? null,
      quality: dataBySeries.quality[idx]?.value ?? null,
      risk: dataBySeries.risk[idx]?.value ?? null,
    }));
  }, [pressure.points, dataBySeries]);

  const overlayTooltipFormatter: TooltipFormatter<ValueType, NameType> = (
    value,
    name,
    item: Payload<ValueType, NameType>
  ) => {
    const dataKey = typeof item?.dataKey === 'string' ? item.dataKey : undefined;
    const metaKey = dataKey as keyof typeof seriesMeta | undefined;
    const meta = metaKey ? seriesMeta[metaKey] : undefined;
    const label = meta ? `${meta.label}（${meta.unit}）` : name;
    return [formatSeriesValue(value, meta?.unit), label || ''];
  };

  const overlayLegendFormatter: LegendFormatter = (value, entry: LegendPayload) => {
    const dataKey = typeof entry?.dataKey === 'string' ? entry.dataKey : undefined;
    const metaKey = dataKey as keyof typeof seriesMeta | undefined;
    const meta = metaKey ? seriesMeta[metaKey] : undefined;
    return meta ? `${meta.label}（${meta.unit}）` : value;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          {([
            { id: 'pressure', label: '压力趋势' },
            { id: 'quality', label: '质量趋势' },
            { id: 'risk', label: '风险趋势' },
          ] as const).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActive(item.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${active === item.id && !overlayEnabled
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
                }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-help" title="叠加会引入不同量纲/口径风险，默认关闭以保证可解释性">
          <input
            type="checkbox"
            checked={overlayEnabled}
            onChange={(e) => setOverlayEnabled(e.target.checked)}
          />
          叠加对比（高级）
        </label>
      </div>

      <div className="h-72">
        {!overlayEnabled && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dataBySeries[active]}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip formatter={(value) => [formatSeriesValue(value, activeMeta.unit), activeLegendLabel]} />
              <Line
                type="monotone"
                dataKey="value"
                name={activeLegendLabel}
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 4 }}
                unit={activeMeta.unit}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        {overlayEnabled && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={combinedData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" />
              <YAxis yAxisId="left" stroke="#94a3b8" />
              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" unit="%" />
              <Tooltip formatter={overlayTooltipFormatter} />
              <Legend formatter={overlayLegendFormatter} />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pressure"
                name={seriesMeta.pressure.label}
                stroke={seriesMeta.pressure.color}
                fill="#bfdbfe"
                fillOpacity={0.5}
                unit={seriesMeta.pressure.unit}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="quality"
                name={seriesMeta.quality.label}
                stroke={seriesMeta.quality.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                unit={seriesMeta.quality.unit}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="risk"
                name={seriesMeta.risk.label}
                stroke={seriesMeta.risk.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                unit={seriesMeta.risk.unit}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
