import { buildApiUrl } from '../../apiClient';
import { LEADER_COCKPIT_TASK_MODE } from './config';
import type { ActionPackTemplateInstance } from './types';

export interface LeaderTaskPayload {
  cityId: string;
  entityId?: string;      // 区县/部门 ID
  entityName?: string;    // 区县/部门名称
  year: number;
  title: string;
  description: ActionPackTemplateInstance;
  ownerLine: string;
  dueDate?: string;
}

const STORAGE_KEY = 'leader_cockpit_tasks';

const storeTask = (payload: LeaderTaskPayload) => {
  const raw = localStorage.getItem(STORAGE_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const taskId = `LC-${Date.now()}`;
  list.unshift({ id: taskId, ...payload, status: 'todo', createdAt: new Date().toISOString() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return taskId;
};

export const createLeaderTask = async (payload: LeaderTaskPayload): Promise<string> => {
  if (LEADER_COCKPIT_TASK_MODE === 'api') {
    const response = await fetch(buildApiUrl('/leader-cockpit/tasks'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`任务创建失败: ${response.status}`);
    }
    const result = await response.json();
    return result.id || result.taskId || 'unknown';
  }
  return storeTask(payload);
};
