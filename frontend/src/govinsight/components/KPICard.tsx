import React from 'react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { MetricTip } from './MetricTip';

interface KPICardProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: number | null; // Allow null
  trendLabel?: string;
  color?: 'blue' | 'indigo' | 'slate' | 'rose' | 'amber' | 'emerald';
  tooltip?: string;
  source?: string;
}

export const KPICard: React.FC<KPICardProps> = ({ 
  title, 
  value, 
  unit, 
  trend, 
  trendLabel = "同比",
  color = 'blue',
  tooltip,
  source
}) => {
  const colorClasses = {
    blue: 'border-l-blue-500',
    indigo: 'border-l-indigo-500',
    slate: 'border-l-slate-500',
    rose: 'border-l-rose-500',
    amber: 'border-l-amber-500',
    emerald: 'border-l-emerald-500',
  };

  const hasTrend = trend !== undefined && trend !== null && !isNaN(trend);
  const isPositive = hasTrend && trend! > 0;
  const isNegative = hasTrend && trend! < 0;
  const isNeutral = !hasTrend || trend === 0;

  return (
    <div className={`bg-white p-5 rounded-lg shadow-sm border border-slate-200 border-l-4 ${colorClasses[color]} hover:shadow-md transition-shadow`}>
      <div className="flex items-center mb-2">
        <h3 className="text-slate-500 text-sm font-medium uppercase tracking-wider">{title}</h3>
        {tooltip && <MetricTip content={tooltip} source={source} />}
      </div>
      <div className="flex items-baseline space-x-1">
        <span className="text-2xl font-bold text-slate-800">{value}</span>
        {unit && <span className="text-sm text-slate-500">{unit}</span>}
      </div>
      
      {/* 弹性显示：只有当有同比数据时，才显示箭头和百分比 */}
      <div className="mt-3 flex items-center text-xs h-4">
        {hasTrend ? (
          <>
            <span className={`flex items-center font-medium ${
              isPositive ? 'text-rose-600' : isNegative ? 'text-emerald-600' : 'text-slate-500'
            }`}>
               {isPositive && <ArrowUpRight className="w-3 h-3 mr-1" />}
               {isNegative && <ArrowDownRight className="w-3 h-3 mr-1" />}
               {isNeutral && <Minus className="w-3 h-3 mr-1" />}
               {Math.abs(trend!)}%
            </span>
            <span className="text-slate-400 ml-1">{trendLabel}</span>
          </>
        ) : (
          <span className="text-slate-400 italic">暂无同比数据</span>
        )}
      </div>
    </div>
  );
};