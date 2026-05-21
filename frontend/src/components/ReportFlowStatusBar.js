import React from 'react';
import { CheckCircle2, Circle, ClipboardCheck, FileCheck2, FileDown, GitCompare, UploadCloud } from 'lucide-react';
import Button from './common/Button';
import StatusBadge from './common/StatusBadge';
import './ReportFlowStatusBar.css';

const FLOW_STEPS = [
  { key: 'uploaded', label: '已上传', icon: UploadCloud },
  { key: 'parsed', label: '已解析', icon: FileCheck2 },
  { key: 'review', label: '待复核', icon: ClipboardCheck },
  { key: 'publish', label: '待发布', icon: FileCheck2 },
  { key: 'published', label: '已发布', icon: CheckCircle2 },
  { key: 'comparable', label: '可比对', icon: GitCompare },
  { key: 'exportable', label: '可导出', icon: FileDown },
];

const hasParsedContent = (version) => {
  const parsed = version?.parsed_json;
  if (!parsed) return false;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    return Boolean(trimmed && trimmed !== '{}' && trimmed !== 'null');
  }
  return typeof parsed === 'object' && Object.keys(parsed).length > 0;
};

const normalizePdfJobStatus = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'running') return 'processing';
  return value;
};

export function buildReportFlowState(report) {
  const activeVersion = report?.active_version || null;
  const pendingVersion = report?.pending_review_version || null;
  const workingVersion = pendingVersion || activeVersion || null;
  const flowSignals = report?.flow_signals || {};
  const comparison = flowSignals.latestComparison || null;
  const completedPdfJob = flowSignals.latestCompletedPdfJob || null;
  const pdfJob = completedPdfJob || flowSignals.latestPdfJob || null;
  const pdfJobStatus = completedPdfJob ? 'done' : normalizePdfJobStatus(pdfJob?.status);
  const pdfFileExists = completedPdfJob ? pdfJob?.file_exists !== false : Boolean(pdfJob?.file_exists);
  const latestJobStatus = String(report?.latest_job?.status || '').toLowerCase();
  const parsed = hasParsedContent(workingVersion);
  const hasPending = Boolean(pendingVersion);
  const hasPendingIssueCount = pendingVersion?.open_issue_count !== null && pendingVersion?.open_issue_count !== undefined;
  const pendingIssueCount = hasPendingIssueCount ? Number(pendingVersion.open_issue_count) : null;
  const published = Boolean(activeVersion && activeVersion.review_status === 'published');

  if (!report) {
    return {
      activeKey: 'uploaded',
      completedKeys: [],
      tone: 'neutral',
      label: '状态未知',
      description: '尚未取得报告状态。',
      nextAction: null,
    };
  }

  if (hasPending) {
    if (parsed && pendingIssueCount === 0) {
      return {
        activeKey: 'publish',
        completedKeys: ['uploaded', 'parsed', 'review'],
        tone: 'info',
        label: '待发布',
        description: `待复核版本 #${pendingVersion.version_id} 已处理完复核项，可以发布为正式版本。`,
        nextAction: {
          label: '发布正式版本',
          target: 'publishPending',
        },
      };
    }

    return {
      activeKey: 'review',
      completedKeys: ['uploaded', ...(parsed ? ['parsed'] : [])],
      tone: 'warning',
      label: '待复核',
      description: pendingIssueCount === null
        ? `当前展示待复核版本 #${pendingVersion.version_id}，请先处理勾稽、质量或视觉复核问题。`
        : `当前展示待复核版本 #${pendingVersion.version_id}，还有 ${pendingIssueCount} 个复核项需要确认或忽略。`,
      nextAction: {
        label: '处理问题',
        target: 'checks',
      },
    };
  }

  if (published && pdfJob && comparison && pdfJobStatus === 'done' && pdfFileExists) {
    return {
      activeKey: 'exportable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published', 'comparable', 'exportable'],
      tone: 'success',
      label: 'PDF可下载',
      description: `比对 #${comparison.id} 的 PDF 任务 #${pdfJob.job_id} 已完成，可进入任务中心下载。`,
      stepLabelOverrides: {
        comparable: '已比对',
        exportable: 'PDF可下载',
      },
      nextAction: {
        label: '查看下载任务',
        href: '/jobs?tab=download',
      },
    };
  }

  if (published && pdfJob && comparison && (pdfJobStatus === 'queued' || pdfJobStatus === 'processing')) {
    const statusLabel = pdfJobStatus === 'queued' ? '排队中' : '生成中';
    return {
      activeKey: 'exportable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published', 'comparable'],
      tone: 'warning',
      label: 'PDF生成中',
      description: `比对 #${comparison.id} 的 PDF 任务 #${pdfJob.job_id} ${statusLabel}，完成后这里会变成“PDF可下载”。`,
      stepLabelOverrides: {
        comparable: '已比对',
        exportable: 'PDF生成中',
      },
      nextAction: {
        label: '查看生成进度',
        href: '/jobs?tab=download',
      },
    };
  }

  if (published && pdfJob && comparison && pdfJobStatus === 'failed') {
    return {
      activeKey: 'exportable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published', 'comparable'],
      tone: 'danger',
      label: 'PDF生成失败',
      description: `比对 #${comparison.id} 的 PDF 任务 #${pdfJob.job_id} 生成失败，请进入任务中心查看原因或重新生成。`,
      stepLabelOverrides: {
        comparable: '已比对',
        exportable: 'PDF失败',
      },
      nextAction: {
        label: '查看失败任务',
        href: '/jobs?tab=download',
      },
    };
  }

  if (published && comparison) {
    return {
      activeKey: 'comparable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published', 'comparable'],
      tone: 'success',
      label: '已比对',
      description: `已找到相关比对 #${comparison.id}（${comparison.yearA} vs ${comparison.yearB}），点击“查看比对详情”进入比对结果；生成 PDF 后才会进入可导出。`,
      stepLabelOverrides: {
        comparable: '已比对',
      },
      nextAction: {
        label: '查看比对详情',
        href: `/comparison/${comparison.id}`,
      },
    };
  }

  if (published) {
    return {
      activeKey: 'comparable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published'],
      tone: 'success',
      label: '可比对',
      description: `正式版本 #${activeVersion.version_id} 已发布，可生成跨年比对；在比对详情中生成 PDF 后才会进入可导出。`,
      nextAction: {
        label: '生成比对',
        href: '/catalog',
      },
    };
  }

  if (parsed) {
    return {
      activeKey: 'publish',
      completedKeys: ['uploaded', 'parsed', 'review'],
      tone: 'info',
      label: '待发布',
      description: `当前版本 #${workingVersion.version_id} 已解析，但尚未成为正式发布版本。`,
      nextAction: {
        label: '发布正式版本',
        target: 'versions',
      },
    };
  }

  if (latestJobStatus === 'queued' || latestJobStatus === 'processing' || latestJobStatus === 'running') {
    return {
      activeKey: 'uploaded',
      completedKeys: ['uploaded'],
      tone: 'info',
      label: '解析中',
      description: '报告已上传，解析任务仍在处理。',
      nextAction: null,
    };
  }

  return {
    activeKey: 'uploaded',
    completedKeys: ['uploaded'],
    tone: 'neutral',
    label: '已上传',
    description: '报告已创建，但当前没有可确认的解析版本。',
    nextAction: {
      label: '自动解析',
      target: 'parse',
    },
  };
}

function ReportFlowStatusBar({ onAction, report }) {
  const state = buildReportFlowState(report);

  return (
    <section className="report-flow-status" aria-label="报告业务流程状态">
      <div className="report-flow-status__summary">
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
        <span>{state.description}</span>
        {state.nextAction && (
          <Button
            size="sm"
            variant={state.nextAction.href ? 'secondary' : 'primary'}
            onClick={() => onAction?.(state.nextAction)}
          >
            {state.nextAction.label}
          </Button>
        )}
      </div>
      <div className="report-flow-status__steps">
        {FLOW_STEPS.map((step) => {
          const Icon = step.icon || Circle;
          const isDone = state.completedKeys.includes(step.key);
          const isActive = state.activeKey === step.key;
          const stepLabel = state.stepLabelOverrides?.[step.key] || step.label;
          return (
            <div
              key={step.key}
              className={[
                'report-flow-step',
                isDone && 'is-done',
                isActive && 'is-active',
              ].filter(Boolean).join(' ')}
            >
              <span className="report-flow-step__dot">
                {isDone ? <CheckCircle2 size={16} /> : <Icon size={16} />}
              </span>
              <span className="report-flow-step__label">{stepLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default ReportFlowStatusBar;
