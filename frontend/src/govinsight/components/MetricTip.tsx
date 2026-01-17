import React from 'react';
import { Info } from 'lucide-react';

interface MetricTipProps {
  content: React.ReactNode;
  source?: string; // e.g., "表3-2-1"
}

export const MetricTip: React.FC<MetricTipProps> = ({ content, source }) => {
  return (
    <div className="group relative inline-block ml-1.5 align-middle cursor-help z-50">
      <Info className="w-3.5 h-3.5 text-slate-400 hover:text-blue-500 transition-colors" />
      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-800 text-white text-xs rounded p-3 shadow-xl z-50 pointer-events-none">
        <div className="font-normal leading-relaxed text-slate-200">
          {content}
        </div>
        {source && (
          <div className="mt-2 pt-2 border-t border-slate-700 text-[10px] text-slate-400 font-mono">
            数据来源: {source}
          </div>
        )}
        {/* Little triangle arrow */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-slate-800"></div>
      </div>
    </div>
  );
};