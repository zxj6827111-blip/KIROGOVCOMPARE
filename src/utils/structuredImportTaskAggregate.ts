/**
 * Pure helpers for structured-import task aggregate display.
 * Used by jobs route GET /task/:id so drawer status can be unit-tested without HTTP.
 */
import {
  buildUploadPipelineSummary,
  computePipelineOverallProgress,
  determineCorePipelineStatus,
  type PipelineJobLike,
} from '../utils/jobPipeline';

export type TaskAggregateDisplay = {
  status: string;
  progress: number;
  step_code: string | null;
  step_name: string | null;
  error_code: string | null;
  error_message: string | null;
  overall: string;
  all_core_succeeded: boolean;
};

/**
 * Build drawer-facing status for a structured_import job given all jobs on the version.
 * If structured_import itself succeeded but materialize/checks have not, stays processing.
 */
export function aggregateStructuredImportTaskDisplay(
  structuredJob: PipelineJobLike & { kind?: string | null },
  versionJobs: PipelineJobLike[]
): TaskAggregateDisplay {
  const pipeline = buildUploadPipelineSummary(versionJobs);
  const overall = determineCorePipelineStatus(versionJobs);
  let status: string = String(structuredJob.status || 'queued');
  if (status === 'running') status = 'processing';

  let progress = computePipelineOverallProgress(versionJobs);
  let stepCode: string | null = pipeline.current_stage_key;
  let stepName: string | null = pipeline.headline;
  let errorCode: string | null = structuredJob.error_code ? String(structuredJob.error_code) : null;
  let errorMessage: string | null = structuredJob.error_message
    ? String(structuredJob.error_message)
    : null;

  if (overall === 'failed') {
    status = 'failed';
    const failedStage = pipeline.stages.find((s) => s.status === 'failed');
    errorCode = failedStage?.error_code || errorCode;
    errorMessage = failedStage?.error_message || errorMessage;
    stepName = pipeline.headline || stepName;
  } else if (overall === 'succeeded') {
    status = 'succeeded';
    progress = 100;
    stepName = pipeline.headline || 'pipeline complete';
  } else if (overall === 'processing' || overall === 'queued') {
    status = overall === 'processing' ? 'processing' : 'queued';
    stepName = pipeline.headline || stepName;
    // structured_import row may already be succeeded while downstream runs
    if (String(structuredJob.status || '').toLowerCase() === 'succeeded') {
      status = 'processing';
    }
  }

  return {
    status,
    progress,
    step_code: stepCode,
    step_name: stepName,
    error_code: errorCode,
    error_message: errorMessage,
    overall,
    all_core_succeeded: pipeline.all_core_succeeded,
  };
}
