import React from 'react';
import type { ReasonCategory, ReasonItem } from '../types';
import { formatNumber, formatPercent, getStatusLabel } from '../utils';

interface ReasonTreeProps {
  categories: ReasonCategory[];
  onSelect: (item: ReasonItem, category: ReasonCategory) => void;
}

export const ReasonTree: React.FC<ReasonTreeProps> = ({ categories, onSelect }) => {
  const getValueTitle = (item: ReasonItem) => {
    if (item.valueStatus === 'MISSING') return '数据未接入/未统计';
    if (item.value === 0) return '枚举项当年统计为0';
    return undefined;
  };

  const getValueDisplay = (item: ReasonItem) => {
    if (item.valueStatus === 'MISSING') return '—';
    return formatNumber(item.value);
  };

  return (
    <div className="space-y-4">
      {categories.map((category) => (
        <div key={category.id} className="border border-slate-200 rounded-lg bg-white">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <div className="text-sm font-semibold text-slate-800">{category.name}</div>
              <div className="text-xs text-slate-500">总量：{category.status === 'ok' ? formatNumber(category.total) : getStatusLabel(category.status)}</div>
            </div>
            <div className="text-xs text-slate-500">
              占比：{category.share !== undefined ? formatPercent(category.share, 1) : '—'}
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {category.items.length === 0 && (
              <div className="px-4 py-4 text-xs text-slate-400">待接入原因结构数据，可通过上传/接入补齐</div>
            )}
            {category.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item, category)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div>
                  <div className="text-xs text-slate-700">{item.name}</div>
                  <div className="text-[10px] text-slate-400">
                    占比 {item.share !== undefined ? formatPercent(item.share, 1) : '—'}
                    {item.valueStatus === 'VALUE' && item.trend !== null && item.trend !== undefined && (
                      <span className="ml-2">同比 {item.trend >= 0 ? '+' : ''}{item.trend}%</span>
                    )}
                  </div>
                </div>
                <div className="text-xs font-semibold text-slate-700" title={getValueTitle(item)}>
                  {getValueDisplay(item)}
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
