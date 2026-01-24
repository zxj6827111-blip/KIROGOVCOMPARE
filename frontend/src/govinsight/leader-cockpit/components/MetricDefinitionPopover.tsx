import React from 'react';
import type { MetricDefinition } from '../types';

interface MetricDefinitionPopoverProps {
  open: boolean;
  definition: MetricDefinition | null;
  onClose: () => void;
}

export const MetricDefinitionPopover: React.FC<MetricDefinitionPopoverProps> = ({
  open,
  definition,
  onClose,
}) => {
  if (!open || !definition) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40">
      <div className="bg-white w-full max-w-lg rounded-lg shadow-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-800">{definition.name}</h3>
            <p className="text-xs text-slate-400">口径说明</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            关闭
          </button>
        </div>
        <div className="space-y-3 text-sm text-slate-700">
          <div>
            <div className="text-xs text-slate-400 mb-1">计算公式</div>
            <div className="bg-slate-50 border border-slate-100 rounded p-2 text-slate-700">{definition.formula}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 mb-1">指标说明</div>
            <p>{definition.description}</p>
          </div>
          {definition.notes && (
            <div>
              <div className="text-xs text-slate-400 mb-1">备注</div>
              <p>{definition.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
