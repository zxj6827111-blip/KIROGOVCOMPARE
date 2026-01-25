import React from 'react';
import { ChevronDown } from 'lucide-react';
import type { ViewLevel } from '../types';

interface CityYearSelectorProps {
  cityName: string;
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  onOpenCitySelector?: () => void;
  viewLevel: ViewLevel;
  onViewLevelChange: (level: ViewLevel) => void;
}

export const CityYearSelector: React.FC<CityYearSelectorProps> = ({
  cityName,
  year,
  years,
  onYearChange,
  onOpenCitySelector,
  viewLevel,
  onViewLevelChange,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span className="px-2 py-1 bg-slate-100 rounded">当前分析对象</span>
        <span className="font-semibold text-slate-800 truncate max-w-[160px]">{cityName}</span>
        <button
          type="button"
          onClick={() => onOpenCitySelector?.()}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          切换城市
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">年度</span>
        <div className="relative">
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="appearance-none bg-white border border-slate-200 rounded pl-3 pr-8 py-1 text-xs font-semibold text-slate-700"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1.5 pointer-events-none" />
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-slate-500">分析层级</span>
        <div className="flex items-center rounded-full border border-slate-200 bg-slate-50 p-0.5">
          {([
            { id: 'city', label: '市级' },
            { id: 'district', label: '区县' },
            { id: 'department', label: '部门' },
          ] as const).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onViewLevelChange(option.id)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${viewLevel === option.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
