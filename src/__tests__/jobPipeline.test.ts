import {
  buildUploadPipelineSummary,
  computePipelineOverallProgress,
  determineCorePipelineStatus,
} from '../utils/jobPipeline';

describe('jobPipeline', () => {
  it('reports running parse as processing with parse as current stage', () => {
    const jobs = [
      { kind: 'parse', status: 'running', progress: 50, step_name: 'AI parsing', retry_count: 0, max_retries: 2 },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('processing');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.current_stage_key).toBe('parse');
    expect(summary.headline).toContain('解析');
    expect(summary.stages[0].status).toBe('running');
    expect(summary.stages[1].status).toBe('pending');
  });

  it('surfaces materialize failure even if parse succeeded', () => {
    const jobs = [
      { kind: 'parse', status: 'succeeded', progress: 100 },
      {
        kind: 'materialize',
        status: 'failed',
        progress: 70,
        error_code: 'MATERIALIZE_EMPTY_FACTS',
        error_message: 'empty facts',
      },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('failed');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.current_stage_key).toBe('materialize');
    expect(summary.headline).toContain('入库');
    expect(summary.stages[1].error_code).toBe('MATERIALIZE_EMPTY_FACTS');
  });

  it('is succeeded only when parse+materialize+checks all succeeded', () => {
    const jobs = [
      { kind: 'parse', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'succeeded', progress: 100 },
      { kind: 'checks', status: 'succeeded', progress: 100 },
      { kind: 'compare', status: 'queued', progress: 0 },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('succeeded');
    const summary = buildUploadPipelineSummary(jobs);
    expect(summary.all_core_succeeded).toBe(true);
    expect(computePipelineOverallProgress(jobs)).toBe(100);
  });

  it('ignores compare jobs for core status when core still incomplete', () => {
    const jobs = [
      { kind: 'parse', status: 'succeeded', progress: 100 },
      { kind: 'materialize', status: 'queued', progress: 0 },
      { kind: 'compare', status: 'running', progress: 10 },
    ];
    expect(determineCorePipelineStatus(jobs)).toBe('queued');
  });
});
