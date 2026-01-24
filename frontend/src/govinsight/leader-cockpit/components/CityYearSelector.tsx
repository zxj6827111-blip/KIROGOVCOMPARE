import React from 'react';
import { ChevronDown } from 'lucide-react';

interface CityYearSelectorProps {
  cityName: string;
  year: number;
  years: number[];
  onYearChange: (year: number) => void;
  onOpenCitySelector?: () => void;
}

export const CityYearSelector: React.FC<CityYearSelectorProps> = ({
  cityName,
  year,
  years,
  onYearChange,
  onOpenCitySelector,
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
    </div>
  );
};
