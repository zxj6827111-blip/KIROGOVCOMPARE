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

export function buildReportFlowState(report) {
  const activeVersion = report?.active_version || null;
  const pendingVersion = report?.pending_review_version || null;
  const workingVersion = pendingVersion || activeVersion || null;
  const flowSignals = report?.flow_signals || {};
  const comparison = flowSignals.latestComparison || null;
  const pdfJob = flowSignals.latestCompletedPdfJob || null;
  const latestJobStatus = String(report?.latest_job?.status || '').toLowerCase();
  const parsed = hasParsedContent(workingVersion);
  const hasPending = Boolean(pendingVersion);
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
    return {
      activeKey: 'review',
      completedKeys: ['uploaded', ...(parsed ? ['parsed'] : [])],
      tone: 'warning',
      label: '待复核',
      description: `当前展示待复核版本 #${pendingVersion.version_id}，请先处理勾稽、质量或视觉复核问题。`,
      nextAction: {
        label: '处理问题',
        target: 'checks',
      },
    };
  }

  if (published && pdfJob && comparison) {
    return {
      activeKey: 'exportable',
      completedKeys: ['uploaded', 'parsed', 'review', 'publish', 'published', 'comparable', 'exportable'],
      tone: 'success',
      label: '可导出',
      description: `已找到比对 #${comparison.id} 和已完成 PDF 任务 #${pdfJob.job_id}，可查看或下载导出结果。`,
      nextAction: {
        label: '查看导出任务',
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
      description: `已找到相关比对 #${comparison.id}（${comparison.yearA} vs ${comparison.yearB}），可查看比对详情。`,
      nextAction: {
        label: '查看比对',
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
      description: `正式版本 #${activeVersion.version_id} 已发布，可生成跨年比对；导出需先进入比对结果。`,
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
        label: '发布工作版本',
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
              <span className="report-flow-step__label">{step.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default ReportFlowStatusBar;
