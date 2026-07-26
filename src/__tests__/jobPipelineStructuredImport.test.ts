/**
 * Pipeline awareness of structured_import jobs (parse-stage only).
 */
import {
  buildUploadPipelineSummary,
  computePipelineOverallProgress,
  determineCorePipelineStatus,
} from '../utils/jobPipeline';

describe('jobPipeline structured_import', () => {
  it('treats running structured_import as processing on parse stage', () => {
    const jobs = [
      { kind: 'structured_import', status: 'running', progress: 40, step_name: 'importing' },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('processing');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.stages[0].status).toBe('running');
    expect(summary.stages[0].label).toContain('材料包');
    expect(summary.stages[1].status).toBe('pending');
    expect(summary.all_core_succeeded).toBe(false);
  });

  it('requires materialize+checks after structured_import succeeds', () => {
    const jobs = [
      { kind: 'structured_import', status: 'succeeded', progress: 100, step_name: 'done' },
    ];
    // parse done, materialize not yet enqueued/visible as processing
    expect(determineCorePipelineStatus(jobs)).toBe('processing');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.stages[0].status).toBe('succeeded');
    expect(summary.stages[1].status).toBe('pending');
    expect(summary.all_core_succeeded).toBe(false);
  });

  it('full success when structured_import + materialize + checks succeeded', () => {
    const jobs = [
      { kind: 'structured_import', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'succeeded', progress: 100 },
      { kind: 'checks', status: 'succeeded', progress: 100 },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('succeeded');
    expect(buildUploadPipelineSummary(jobs).all_core_succeeded).toBe(true);
    expect(computePipelineOverallProgress(jobs)).toBe(100);
  });

  it('surfaces structured_import failure on parse stage', () => {
    const jobs = [
      {
        kind: 'structured_import',
        status: 'failed',
        progress: 70,
        error_code: 'PDF_HASH_MISMATCH',
        error_message: 'hash',
      },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('failed');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.current_stage_key).toBe('parse');
    expect(summary.stages[0].error_code).toBe('PDF_HASH_MISMATCH');
  });

  it('keeps classic AI parse path working', () => {
    const jobs = [
      { kind: 'parse', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'succeeded', progress: 100 },
      { kind: 'checks', status: 'succeeded', progress: 100 },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('succeeded');
  });
});
