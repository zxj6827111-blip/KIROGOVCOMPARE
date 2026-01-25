import React from 'react';
import type { AttributionItem } from '../types';
import { formatNumber, formatPercent, getStatusLabel } from '../utils';

interface AttributionTopListProps {
  title: string;
  items?: AttributionItem[];
  missingText: string;
}

export const AttributionTopList: React.FC<AttributionTopListProps> = ({ title, items, missingText }) => {
  if (!items || items.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-400">
        {missingText}
      </div>
    );
  }

  const getValueTitle = (item: AttributionItem) => {
    if (item.valueStatus === 'MISSING') return '数据未接入/未统计';
    if (item.value === 0) return '枚举项当年统计为0';
    return undefined;
  };

  const getValueDisplay = (item: AttributionItem) => {
    if (item.valueStatus === 'MISSING') return '—';
    if (item.status !== 'ok') return getStatusLabel(item.status);
    const valueText = item.value !== undefined ? formatNumber(item.value) : '—';
    const shareText = item.share !== undefined ? formatPercent(item.share, 1) : '—';
    return `${valueText}（${shareText}）`;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-slate-800 mb-3">{title}</h4>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px]">
                {index + 1}
              </span>
              <span className="text-slate-700">{item.label}</span>
            </div>
            <div className="text-slate-600" title={getValueTitle(item)}>
              {getValueDisplay(item)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
