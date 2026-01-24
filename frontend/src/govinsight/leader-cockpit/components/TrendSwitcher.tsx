import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ComposedChart, Area } from 'recharts';
import type { YearSeries } from '../types';

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
  const [overlay, setOverlay] = useState(false);
  const activeUnit = active === 'pressure' ? '件' : '%';

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
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${
                active === item.id && !overlay
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={overlay}
            onChange={(e) => setOverlay(e.target.checked)}
          />
          叠加对比（高级）
        </label>
      </div>

      <div className="h-72">
        {!overlay && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dataBySeries[active]}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 4 }}
                unit={activeUnit}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
        {overlay && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={combinedData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="year" stroke="#94a3b8" />
              <YAxis yAxisId="left" stroke="#94a3b8" />
              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" unit="%" />
              <Tooltip />
              <Legend />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pressure"
                name="压力（件）"
                stroke="#3b82f6"
                fill="#bfdbfe"
                fillOpacity={0.5}
                unit="件"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="quality"
                name="质量（%）"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 3 }}
                unit="%"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="risk"
                name="风险（%）"
                stroke="#f43f5e"
                strokeWidth={2}
                dot={{ r: 3 }}
                unit="%"
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};
