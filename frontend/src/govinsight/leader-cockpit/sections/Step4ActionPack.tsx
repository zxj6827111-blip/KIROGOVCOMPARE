import React, { useEffect, useMemo, useState } from 'react';
import type { ActionPackTemplateInstance, LeaderCockpitModel } from '../types';
import { ActionPackEditor } from '../components/ActionPackEditor';
import { createLeaderTask } from '../tasks';

interface Step4ActionPackProps {
  model: LeaderCockpitModel;
  selectedActionPack: ActionPackTemplateInstance | null;
  onActionPackChange: (pack: ActionPackTemplateInstance | null) => void;
}

export const Step4ActionPack: React.FC<Step4ActionPackProps> = ({
  model,
  selectedActionPack,
  onActionPackChange,
}) => {
  const defaultPack = useMemo(() => model.actionPacks.templates[0], [model.actionPacks.templates]);
  const [draft, setDraft] = useState<ActionPackTemplateInstance>(selectedActionPack || (defaultPack as ActionPackTemplateInstance));
  const [creating, setCreating] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedActionPack) {
      setDraft(selectedActionPack);
    }
  }, [selectedActionPack]);

  const handleCreateTask = async () => {
    setCreating(true);
    setError(null);
    try {
      const taskId = await createLeaderTask({
        cityId: model.city.id,
        year: model.year,
        title: draft.title,
        description: draft,
        ownerLine: draft.ownerLine,
      });
      setCreatedTaskId(taskId);
    } catch (err: any) {
      setError(err?.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  if (!defaultPack) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-lg p-6 text-xs text-slate-400">
        暂无可用行动包模板
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 text-xs">
          {model.actionPacks.templates.map((pack) => (
            <button
              key={pack.id}
              type="button"
              onClick={() => {
                setDraft(pack);
                onActionPackChange(pack);
              }}
              className={`px-3 py-1.5 rounded-full border ${draft.id === pack.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              {pack.title}
            </button>
          ))}
        </div>
      </div>

      <ActionPackEditor
        value={draft}
        onChange={(next) => {
          setDraft(next);
          onActionPackChange(next);
        }}
        onCreateTask={handleCreateTask}
        creating={creating}
        createdTaskId={createdTaskId}
        error={error}
      />
    </div>
  );
};
