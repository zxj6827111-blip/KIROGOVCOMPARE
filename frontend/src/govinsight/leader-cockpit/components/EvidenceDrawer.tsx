import React from 'react';
import type { EvidenceItem } from '../types';

interface EvidenceDrawerProps {
  open: boolean;
  evidence: EvidenceItem[];
  onClose: () => void;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({
  open,
  evidence,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex justify-end bg-black/30">
      <div className="bg-white w-full max-w-md h-full shadow-xl border-l border-slate-200 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800">证据链</h3>
            <p className="text-xs text-slate-400">数据来源与字段说明</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            关闭
          </button>
        </div>
        <div className="space-y-4">
          {evidence.length === 0 && (
            <div className="text-sm text-slate-400">暂无证据条目</div>
          )}
          {evidence.map((item) => (
            <div key={item.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
              <div className="text-sm font-semibold text-slate-800 mb-1">{item.title}</div>
              <div className="text-xs text-slate-500 mb-2">{item.source}</div>
              <div className="text-xs text-slate-600">{item.detail}</div>
              {item.linkLabel && (
                <button
                  type="button"
                  className="mt-2 text-xs text-blue-600 hover:text-blue-700"
                >
                  {item.linkLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
