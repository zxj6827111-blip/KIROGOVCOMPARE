/**
 * Upload pipeline stages: parse → materialize → checks.
 * Used by jobs API (and mirrored labels on the frontend).
 *
 * structured_import maps to the **parse** stage only (write parsed_json).
 * Materialize and checks remain separate jobs, same as AI parse.
 */

export type PipelineStageKey = 'parse' | 'materialize' | 'checks';

export type PipelineStageStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface PipelineJobLike {
  kind?: string | null;
  status?: string | null;
  progress?: number | null;
  step_code?: string | null;
  step_name?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  retry_count?: number | null;
  max_retries?: number | null;
  started_at?: string | Date | null;
  finished_at?: string | Date | null;
}

export interface PipelineStageView {
  key: PipelineStageKey;
  label: string;
  shortLabel: string;
  description: string;
  status: PipelineStageStatus;
  progress: number;
  step_code: string | null;
  step_name: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  attempt: number;
}

export interface UploadPipelineSummary {
  stages: PipelineStageView[];
  current_stage_key: PipelineStageKey | null;
  current_stage_label: string | null;
  headline: string;
  all_core_succeeded: boolean;
}

const STAGE_META: Array<{
  key: PipelineStageKey;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    key: 'parse',
    label: '解析 / 导入',
    shortLabel: '解析',
    description: 'AI 解析年报，或本地材料包写入 parsed_json',
  },
  {
    key: 'materialize',
    label: '结构化入库',
    shortLabel: '入库',
    description: '把解析结果写入指标事实表，供看板与比对使用',
  },
  {
    key: 'checks',
    label: '一致性校验',
    shortLabel: '校验',
    description: '检查表间勾稽与明显数据问题',
  },
];

/** Kinds that fulfill the parse/import stage. */
const PARSE_STAGE_KINDS = ['parse', 'structured_import'] as const;

function mapJobStatus(statusRaw: string | null | undefined): PipelineStageStatus {
  const status = String(statusRaw || '').toLowerCase();
  if (status === 'running') return 'running';
  if (status === 'queued') return 'queued';
  if (status === 'succeeded') return 'succeeded';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'pending';
}

function latestJobMatching(jobs: PipelineJobLike[], kinds: readonly string[]): PipelineJobLike | null {
  const kindSet = new Set(kinds.map((k) => k.toLowerCase()));
  const matched = jobs.filter((job) => kindSet.has(String(job.kind || '').toLowerCase()));
  if (matched.length === 0) return null;
  return matched[matched.length - 1];
}

function latestJobForKind(jobs: PipelineJobLike[], kind: PipelineStageKey): PipelineJobLike | null {
  if (kind === 'parse') {
    return latestJobMatching(jobs, PARSE_STAGE_KINDS);
  }
  return latestJobMatching(jobs, [kind]);
}

function stageLabel(meta: (typeof STAGE_META)[number], job: PipelineJobLike | null): string {
  if (meta.key === 'parse' && String(job?.kind || '') === 'structured_import') {
    return '本地材料包导入';
  }
  return meta.label;
}

/**
 * Aggregate version status from core pipeline jobs (ignore compare/pdf_export noise).
 */
export function determineCorePipelineStatus(jobs: PipelineJobLike[]): string {
  const coreKinds: PipelineStageKey[] = ['parse', 'materialize', 'checks'];
  const latest = coreKinds
    .map((kind) => latestJobForKind(jobs, kind))
    .filter((job): job is PipelineJobLike => Boolean(job));

  if (latest.length === 0) {
    return 'queued';
  }

  if (latest.some((job) => mapJobStatus(job.status) === 'running')) {
    return 'processing';
  }
  if (latest.some((job) => mapJobStatus(job.status) === 'failed')) {
    return 'failed';
  }
  if (latest.some((job) => mapJobStatus(job.status) === 'cancelled')) {
    return 'cancelled';
  }
  if (latest.some((job) => mapJobStatus(job.status) === 'queued')) {
    return 'queued';
  }

  const parse = latestJobForKind(jobs, 'parse');
  if (!parse || mapJobStatus(parse.status) !== 'succeeded') {
    return mapJobStatus(parse?.status) === 'pending' ? 'queued' : String(parse?.status || 'queued');
  }

  const materialize = latestJobForKind(jobs, 'materialize');
  if (!materialize) {
    return 'processing';
  }
  if (mapJobStatus(materialize.status) !== 'succeeded') {
    return mapJobStatus(materialize.status) === 'queued' ? 'queued' : 'processing';
  }

  const checks = latestJobForKind(jobs, 'checks');
  if (!checks) {
    return 'processing';
  }
  if (mapJobStatus(checks.status) === 'succeeded') {
    return 'succeeded';
  }
  return mapJobStatus(checks.status) === 'queued' ? 'queued' : 'processing';
}

export function buildUploadPipelineSummary(jobs: PipelineJobLike[]): UploadPipelineSummary {
  const stages: PipelineStageView[] = STAGE_META.map((meta) => {
    const job = latestJobForKind(jobs, meta.key);
    if (!job) {
      return {
        key: meta.key,
        label: meta.label,
        shortLabel: meta.shortLabel,
        description: meta.description,
        status: 'pending' as PipelineStageStatus,
        progress: 0,
        step_code: null,
        step_name: null,
        error_code: null,
        error_message: null,
        retry_count: 0,
        max_retries: 0,
        attempt: 0,
      };
    }

    const status = mapJobStatus(job.status);
    const retryCount = Number(job.retry_count || 0);
    const maxRetries = Number(job.max_retries || 0);
    return {
      key: meta.key,
      label: stageLabel(meta, job),
      shortLabel: meta.key === 'parse' && String(job.kind) === 'structured_import' ? '导入' : meta.shortLabel,
      description:
        meta.key === 'parse' && String(job.kind) === 'structured_import'
          ? '校验材料包并写入 parsed_json（不调用 AI）'
          : meta.description,
      status,
      progress: Number(job.progress || 0),
      step_code: job.step_code ? String(job.step_code) : null,
      step_name: job.step_name ? String(job.step_name) : null,
      error_code: job.error_code ? String(job.error_code) : null,
      error_message: job.error_message ? String(job.error_message) : null,
      retry_count: retryCount,
      max_retries: maxRetries,
      attempt: retryCount + 1,
    };
  });

  const failed = stages.find((s) => s.status === 'failed');
  const running = stages.find((s) => s.status === 'running');
  const queued = stages.find((s) => s.status === 'queued');
  const pendingAfterSuccess = stages.find((s, idx) => {
    if (s.status !== 'pending') return false;
    if (idx === 0) return true;
    return stages[idx - 1].status === 'succeeded';
  });

  const current =
    failed || running || queued || pendingAfterSuccess || stages.find((s) => s.status !== 'succeeded') || null;

  const allSucceeded = stages.every((s) => s.status === 'succeeded');

  let headline = '等待开始';
  if (allSucceeded) {
    headline = '解析 · 入库 · 校验 已全部完成';
  } else if (failed) {
    headline = `卡在「${failed.shortLabel}」：${failed.error_code || failed.step_name || '失败'}`;
  } else if (running) {
    headline = `正在「${running.shortLabel}」${running.step_name ? `（${running.step_name}）` : ''}`;
  } else if (queued) {
    headline = `排队等待「${queued.shortLabel}」`;
  } else if (pendingAfterSuccess) {
    headline = `「${pendingAfterSuccess.shortLabel}」尚未创建任务`;
  }

  return {
    stages,
    current_stage_key: current?.key || null,
    current_stage_label: current?.label || null,
    headline,
    all_core_succeeded: allSucceeded,
  };
}

export function computePipelineOverallProgress(jobs: PipelineJobLike[]): number {
  const summary = buildUploadPipelineSummary(jobs);
  if (summary.all_core_succeeded) return 100;

  const weights: Record<PipelineStageKey, number> = {
    parse: 50,
    materialize: 25,
    checks: 25,
  };

  let total = 0;
  for (const stage of summary.stages) {
    const w = weights[stage.key];
    if (stage.status === 'succeeded') {
      total += w;
    } else if (stage.status === 'running' || stage.status === 'queued') {
      const pct = Math.min(100, Math.max(0, stage.progress || 0));
      total += Math.round((w * pct) / 100);
    } else if (stage.status === 'failed') {
      total += Math.round((w * Math.min(100, Math.max(10, stage.progress || 30))) / 100);
    }
  }
  return Math.min(100, Math.max(0, total));
}
