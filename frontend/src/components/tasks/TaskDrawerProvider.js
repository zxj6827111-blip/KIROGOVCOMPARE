import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  RefreshCw,
  RotateCw,
  X,
} from 'lucide-react';
import { apiClient } from '../../apiClient';
import { getAxiosFriendlyError, getRawErrorDetail, translateFailureReason, translateJobError } from '../../utils/errorTranslator';
import { useToast } from '../common/ToastProvider';
import './TaskDrawerProvider.css';

const TaskDrawerContext = createContext(null);

const ACTIVE_STATUSES = new Set(['queued', 'processing', 'running']);
const FINAL_STATUSES = new Set(['done', 'succeeded', 'failed', 'cancelled']);
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 12000;

const TASK_TYPE_META = {
  parse: {
    label: '解析任务',
    centerUrl: '/jobs',
  },
  pdf: {
    label: 'PDF 导出',
    centerUrl: '/jobs?tab=download',
  },
  govinsight: {
    label: 'AI 报告',
    centerUrl: '/govinsight/report',
  },
};

const normalizeStatus = (status) => {
  const value = String(status || 'queued').toLowerCase();
  if (value === 'running') return 'processing';
  return value;
};

const isActiveTask = (task) => ACTIVE_STATUSES.has(normalizeStatus(task?.status));

const buildTaskKey = (task) => `${task.type}:${task.id || task.jobId || task.versionId || task.title}`;

const clampProgress = (progress, fallback = 0) => {
  const value = Number(progress);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
};

const getTaskTitle = (task) => {
  if (task.title) return task.title;
  if (task.type === 'parse') return task.fileName || `解析任务 #${task.id || task.jobId || ''}`.trim();
  if (task.type === 'pdf') return task.exportTitle || `PDF 导出 #${task.id || task.jobId || ''}`.trim();
  if (task.type === 'govinsight') return `${task.orgName || task.orgId || 'GovInsight'} ${task.year || ''} AI 报告`.trim();
  return '后台任务';
};

const getStatusView = (task) => {
  const status = normalizeStatus(task.status);
  if (task.type === 'pdf' && status === 'done' && task.fileExists === false) {
    return { label: '文件已过期', tone: 'warning', icon: AlertCircle };
  }
  if (status === 'queued') return { label: '排队中', tone: 'info', icon: Clock3 };
  if (status === 'processing') return { label: task.type === 'pdf' ? '生成中' : '处理中', tone: 'warning', icon: Loader2 };
  if (status === 'done' || status === 'succeeded') return { label: '已完成', tone: 'success', icon: CheckCircle2 };
  if (status === 'failed') return { label: '失败', tone: 'danger', icon: AlertCircle };
  if (status === 'cancelled') return { label: '已取消', tone: 'neutral', icon: AlertCircle };
  return { label: task.status || '未知', tone: 'neutral', icon: Clock3 };
};

const getFailureText = (task) => {
  if (normalizeStatus(task.status) !== 'failed') return '';
  if (task.errorMessage || task.error_code || task.error_message) {
    return translateJobError({
      ...task,
      error_message: task.errorMessage || task.error_message,
      error_code: task.errorCode || task.error_code,
    });
  }
  return task.message || '任务执行失败，请稍后重试。';
};

const mapParseJobToTask = (raw, existing = {}) => ({
  ...existing,
  type: 'parse',
  id: raw.job_id || existing.id || existing.jobId,
  jobId: raw.job_id || existing.jobId,
  versionId: raw.version_id || existing.versionId,
  reportId: raw.report_id || existing.reportId,
  title: existing.title || raw.file_name || `${raw.unit_name || '年报'} ${raw.year || ''}`.trim(),
  status: normalizeStatus(raw.status),
  progress: clampProgress(raw.progress),
  message: raw.step_name || existing.message || '',
  errorCode: raw.error_code || existing.errorCode,
  errorMessage: raw.error_message || existing.errorMessage,
  updatedAt: raw.updated_at || raw.finished_at || raw.started_at || raw.created_at || existing.updatedAt,
  centerUrl: raw.version_id ? `/jobs/${raw.version_id}` : TASK_TYPE_META.parse.centerUrl,
});

const mapPdfJobToTask = (raw, existing = {}) => ({
  ...existing,
  type: 'pdf',
  id: raw.job_id || existing.id || existing.jobId,
  jobId: raw.job_id || existing.jobId,
  comparisonId: raw.comparison_id || existing.comparisonId,
  title: raw.export_title || existing.title || `PDF 导出 #${raw.job_id || existing.id}`,
  exportTitle: raw.export_title || existing.exportTitle,
  fileName: raw.file_name || existing.fileName,
  fileSize: raw.file_size || existing.fileSize,
  fileExists: raw.file_exists,
  status: normalizeStatus(raw.status),
  progress: clampProgress(raw.progress),
  message: raw.step_name || existing.message || '',
  errorMessage: raw.error_message || existing.errorMessage,
  updatedAt: raw.finished_at || raw.started_at || raw.created_at || existing.updatedAt,
  centerUrl: TASK_TYPE_META.pdf.centerUrl,
});

const mapGovInsightJobToTask = (raw, existing = {}) => ({
  ...existing,
  type: 'govinsight',
  id: raw.id || existing.id,
  jobId: raw.id || existing.jobId,
  orgId: raw.orgId || existing.orgId,
  orgName: raw.orgName || existing.orgName,
  year: raw.year || existing.year,
  title: existing.title || `${raw.orgName || raw.orgId || 'GovInsight'} ${raw.year || ''} AI 报告`.trim(),
  status: normalizeStatus(raw.status),
  progress: clampProgress(raw.progress),
  message: raw.stepName || raw.errorMessage || existing.message || '',
  errorCode: raw.errorCode || existing.errorCode,
  errorMessage: raw.errorMessage || existing.errorMessage,
  updatedAt: raw.finishedAt || raw.startedAt || raw.createdAt || existing.updatedAt,
  centerUrl: '/govinsight/report',
});

function TaskDrawer({ tasks, isOpen, onClose, onOpen, onRefresh, onNavigate, onDownloadPdf, onRegeneratePdf }) {
  const activeCount = tasks.filter(isActiveTask).length;
  const latestTasks = tasks.slice(0, 12);

  return (
    <>
      <button
        type="button"
        className={`task-drawer-trigger ${activeCount > 0 ? 'has-active' : ''}`}
        onClick={onOpen}
        aria-label="打开任务抽屉"
      >
        <Clock3 size={18} />
        <span>任务</span>
        {activeCount > 0 && <strong>{activeCount}</strong>}
      </button>

      {isOpen && (
        <div className="task-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      )}

      <aside className={`task-drawer ${isOpen ? 'open' : ''}`} aria-label="任务进度抽屉">
        <div className="task-drawer__header">
          <div>
            <h2>任务进度</h2>
            <p>解析、PDF 导出和 AI 报告任务会在这里持续更新。</p>
          </div>
          <button type="button" className="task-drawer__icon-btn" onClick={onClose} aria-label="关闭任务抽屉">
            <X size={18} />
          </button>
        </div>

        <div className="task-drawer__summary">
          <span>{tasks.length} 个近期任务</span>
          <span>{activeCount} 个进行中</span>
          <button type="button" onClick={onRefresh}>
            <RefreshCw size={14} />
            刷新
          </button>
        </div>

        <div className="task-drawer__list">
          {latestTasks.length === 0 ? (
            <div className="task-drawer__empty">
              <Clock3 size={28} />
              <strong>暂无本次会话任务</strong>
              <p>创建解析、PDF 导出或 AI 报告任务后，会自动出现在这里。</p>
            </div>
          ) : (
            latestTasks.map((task) => (
              <TaskDrawerItem
                key={buildTaskKey(task)}
                task={task}
                onNavigate={onNavigate}
                onDownloadPdf={onDownloadPdf}
                onRegeneratePdf={onRegeneratePdf}
              />
            ))
          )}
        </div>
      </aside>
    </>
  );
}

function TaskDrawerItem({ task, onNavigate, onDownloadPdf, onRegeneratePdf }) {
  const meta = TASK_TYPE_META[task.type] || { label: '任务', centerUrl: '/jobs' };
  const statusView = getStatusView(task);
  const StatusIcon = statusView.icon;
  const failureText = getFailureText(task);
  const progress = clampProgress(task.progress, normalizeStatus(task.status) === 'done' || normalizeStatus(task.status) === 'succeeded' ? 100 : 0);
  const isPdfReady = task.type === 'pdf' && normalizeStatus(task.status) === 'done' && task.fileExists;
  const isPdfExpired = task.type === 'pdf' && normalizeStatus(task.status) === 'done' && task.fileExists === false;
  const canRetryPdf = task.type === 'pdf' && (normalizeStatus(task.status) === 'failed' || isPdfExpired);
  const centerUrl = task.centerUrl || meta.centerUrl;

  return (
    <article className={`task-card task-card--${statusView.tone}`}>
      <div className="task-card__topline">
        <span className="task-card__type">{meta.label}</span>
        <span className={`task-card__status task-card__status--${statusView.tone}`}>
          <StatusIcon size={13} className={isActiveTask(task) ? 'spin' : ''} />
          {statusView.label}
        </span>
      </div>

      <h3>{getTaskTitle(task)}</h3>
      {(task.message || failureText) && (
        <p className={failureText ? 'task-card__message danger' : 'task-card__message'}>
          {failureText || task.message}
        </p>
      )}

      <div className="task-card__progress" aria-label={`进度 ${progress}%`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="task-card__meta">
        <span>{progress}%</span>
        {task.updatedAt && <span>{formatDateTime(task.updatedAt)}</span>}
      </div>

      <div className="task-card__actions">
        {isPdfReady && (
          <button type="button" onClick={() => onDownloadPdf(task)}>
            <Download size={14} />
            下载
          </button>
        )}
        {canRetryPdf && (
          <button type="button" onClick={() => onRegeneratePdf(task)}>
            <RotateCw size={14} />
            重新生成
          </button>
        )}
        <button type="button" onClick={() => onNavigate(centerUrl)}>
          <ExternalLink size={14} />
          任务中心
        </button>
        {task.type === 'parse' && task.versionId && (
          <button type="button" onClick={() => onNavigate(`/jobs/${task.versionId}`)}>
            <ChevronRight size={14} />
            详情
          </button>
        )}
        {task.type === 'govinsight' && (
          <button type="button" onClick={() => onNavigate('/govinsight/report')}>
            <FileDown size={14} />
            报告页
          </button>
        )}
      </div>
    </article>
  );
}

export function TaskDrawerProvider({ children, navigate, disabled = false }) {
  const toast = useToast();
  const [tasksByKey, setTasksByKey] = useState({});
  const [isOpen, setIsOpen] = useState(false);
  const tasksRef = useRef({});

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    tasksRef.current = tasksByKey;
  }, [tasksByKey]);

  const upsertTask = useCallback((input) => {
    if (!input?.type) return null;
    const task = {
      id: input.id || input.jobId,
      status: 'queued',
      progress: 0,
      updatedAt: new Date().toISOString(),
      ...input,
    };
    const key = buildTaskKey(task);
    setTasksByKey((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        ...task,
        key,
      },
    }));
    return key;
  }, []);

  const openDrawer = useCallback(() => {
    if (!disabled) {
      setIsOpen(true);
    }
  }, [disabled]);
  const closeDrawer = useCallback(() => setIsOpen(false), []);

  const navigateTo = useCallback((path) => {
    if (!path) return;
    setIsOpen(false);
    if (typeof navigate === 'function') {
      navigate(path);
    } else {
      window.location.href = path;
    }
  }, [navigate]);

  const refreshTrackedTasks = useCallback(async () => {
    const currentTasks = Object.values(tasksRef.current);
    if (currentTasks.length === 0) return;

    const parseTasks = currentTasks.filter((task) => task.type === 'parse' && task.jobId);
    const pdfTasks = currentTasks.filter((task) => task.type === 'pdf' && task.jobId);
    const govInsightTasks = currentTasks.filter((task) => task.type === 'govinsight' && task.jobId);
    const updates = {};

    await Promise.allSettled(parseTasks.map(async (task) => {
      const response = await apiClient.get(`/jobs/task/${task.jobId}`);
      const nextTask = mapParseJobToTask(response.data, task);
      updates[buildTaskKey(nextTask)] = nextTask;
    }));

    if (pdfTasks.length > 0) {
      const response = await apiClient.get('/pdf-jobs', { params: { page: 1, limit: 100 } });
      const rows = response.data?.jobs || [];
      pdfTasks.forEach((task) => {
        const row = rows.find((item) => Number(item.job_id) === Number(task.jobId));
        if (row) {
          const nextTask = mapPdfJobToTask(row, task);
          updates[buildTaskKey(nextTask)] = nextTask;
        }
      });
    }

    await Promise.allSettled(govInsightTasks.map(async (task) => {
      const response = await apiClient.get(`/gov-insight/ai-report/jobs/${task.jobId}`);
      const raw = response.data?.data;
      if (raw) {
        const nextTask = mapGovInsightJobToTask(raw, task);
        updates[buildTaskKey(nextTask)] = nextTask;
      }
    }));

    if (Object.keys(updates).length > 0) {
      setTasksByKey((prev) => {
        const next = { ...prev };
        Object.values(updates).forEach((task) => {
          next[buildTaskKey(task)] = {
            ...(next[buildTaskKey(task)] || {}),
            ...task,
          };
        });
        return next;
      });
    }
  }, []);

  const refreshRecentTasks = useCallback(async () => {
    const updates = {};

    const [parseResult, pdfResult] = await Promise.allSettled([
      apiClient.get('/jobs', { params: { page: 1, limit: 5 } }),
      apiClient.get('/pdf-jobs', { params: { page: 1, limit: 5 } }),
    ]);

    if (parseResult.status === 'fulfilled') {
      (parseResult.value.data?.jobs || []).forEach((row) => {
        const task = mapParseJobToTask(row);
        updates[buildTaskKey(task)] = task;
      });
    }

    if (pdfResult.status === 'fulfilled') {
      (pdfResult.value.data?.jobs || []).forEach((row) => {
        const task = mapPdfJobToTask(row);
        updates[buildTaskKey(task)] = task;
      });
    }

    if (Object.keys(updates).length > 0) {
      setTasksByKey((prev) => ({ ...prev, ...updates }));
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refreshTrackedTasks(), refreshRecentTasks()]);
  }, [refreshRecentTasks, refreshTrackedTasks]);

  const downloadPdfTask = useCallback(async (task) => {
    if (!task?.jobId) return;
    try {
      const response = await apiClient.get(`/pdf-jobs/${task.jobId}/download`, { responseType: 'blob' });
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = task.fileName || `comparison_${task.comparisonId || task.jobId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '下载失败，请稍后重试。');
      toast.error('PDF 下载失败', friendly.message, { detail: friendly.detail });
      if (error.response?.status === 410) {
        upsertTask({ ...task, fileExists: false, status: 'done', message: '文件已过期，请重新生成。' });
      }
    }
  }, [toast, upsertTask]);

  const regeneratePdfTask = useCallback(async (task) => {
    if (!task?.jobId) return;
    try {
      const response = await apiClient.post(`/pdf-jobs/${task.jobId}/regenerate`);
      upsertTask({
        ...task,
        status: 'queued',
        progress: 0,
        fileExists: false,
        fileName: response.data?.file_name || task.fileName,
        message: '已重新加入生成队列。',
      });
      toast.success('已重新生成 PDF', '任务已加入队列，可在抽屉查看进度。');
      setIsOpen(true);
      refreshTrackedTasks();
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '重新生成失败，请稍后重试。');
      toast.error('重新生成失败', friendly.message, { detail: friendly.detail || getRawErrorDetail(error) });
    }
  }, [refreshTrackedTasks, toast, upsertTask]);

  useEffect(() => {
    refreshRecentTasks();
  }, [refreshRecentTasks]);

  useEffect(() => {
    const tasks = Object.values(tasksRef.current);
    const intervalMs = tasks.some(isActiveTask) ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const intervalId = window.setInterval(refreshTrackedTasks, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [refreshTrackedTasks, tasksByKey]);

  const tasks = useMemo(() => Object.values(tasksByKey).sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  }), [tasksByKey]);

  const value = useMemo(() => ({
    openDrawer,
    closeDrawer,
    refreshAll,
    trackParseJob: (job, options = {}) => upsertTask(mapParseJobToTask(job, options)),
    trackPdfJob: (job, options = {}) => upsertTask(mapPdfJobToTask(job, options)),
    trackGovInsightJob: (job, options = {}) => upsertTask(mapGovInsightJobToTask(job, options)),
    trackTask: upsertTask,
  }), [closeDrawer, openDrawer, refreshAll, upsertTask]);

  return (
    <TaskDrawerContext.Provider value={value}>
      {children}
      {!disabled && (
        <TaskDrawer
          tasks={tasks}
          isOpen={isOpen}
          onClose={closeDrawer}
          onOpen={() => {
            setIsOpen(true);
            refreshAll();
          }}
          onRefresh={refreshAll}
          onNavigate={navigateTo}
          onDownloadPdf={downloadPdfTask}
          onRegeneratePdf={regeneratePdfTask}
        />
      )}
    </TaskDrawerContext.Provider>
  );
}

export function useTaskDrawer() {
  const context = useContext(TaskDrawerContext);
  if (!context) {
    return {
      openDrawer: () => null,
      closeDrawer: () => null,
      refreshAll: () => null,
      trackParseJob: () => null,
      trackPdfJob: () => null,
      trackGovInsightJob: () => null,
      trackTask: () => null,
    };
  }
  return context;
}
