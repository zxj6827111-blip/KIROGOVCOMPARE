import React from 'react';
import type { ActionPackTemplateInstance } from '../types';

interface ActionPackEditorProps {
  value: ActionPackTemplateInstance;
  onChange: (value: ActionPackTemplateInstance) => void;
  onCreateTask: () => void;
  creating?: boolean;
  createdTaskId?: string | null;
  error?: string | null;
}

const listToText = (items: string[]) => items.join('\n');
const textToList = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

export const ActionPackEditor: React.FC<ActionPackEditorProps> = ({
  value,
  onChange,
  onCreateTask,
  creating,
  createdTaskId,
  error,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">整改行动包</h3>
          <p className="text-xs text-slate-400">可编辑字段将同步到任务创建</p>
        </div>
        <button
          type="button"
          onClick={onCreateTask}
          disabled={creating}
          className="px-4 py-2 rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          创建任务
        </button>
      </div>

      {createdTaskId && (
        <div className="text-xs text-emerald-600">任务已创建：{createdTaskId}</div>
      )}
      {error && (
        <div className="text-xs text-rose-600">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-slate-500">行动包标题</label>
          <input
            className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm"
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">牵头单位</label>
          <input
            className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm"
            value={value.ownerLine}
            onChange={(e) => onChange({ ...value, ownerLine: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">整改周期</label>
          <input
            className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm"
            value={value.cycle}
            onChange={(e) => onChange({ ...value, cycle: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-slate-500">验收标准（DoD）</label>
          <input
            className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm"
            value={value.acceptance}
            onChange={(e) => onChange({ ...value, acceptance: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-slate-500">风险提示</label>
        <textarea
          className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm" rows={2}
          value={value.risk}
          onChange={(e) => onChange({ ...value, risk: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">根因分析</label>
        <textarea
          className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm" rows={2}
          value={value.rootCause}
          onChange={(e) => onChange({ ...value, rootCause: e.target.value })}
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">行动建议（每行一条）</label>
        <textarea
          className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm" rows={4}
          value={listToText(value.actions)}
          onChange={(e) => onChange({ ...value, actions: textToList(e.target.value) })}
        />
      </div>
      <div>
        <label className="text-xs text-slate-500">KPI 建议（每行一条）</label>
        <textarea
          className="mt-1 w-full border border-slate-200 rounded px-3 py-2 text-sm" rows={3}
          value={listToText(value.kpis)}
          onChange={(e) => onChange({ ...value, kpis: textToList(e.target.value) })}
        />
      </div>
    </div>
  );
};
