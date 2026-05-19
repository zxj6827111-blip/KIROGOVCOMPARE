import { buildReportFlowState } from './ReportFlowStatusBar';

describe('buildReportFlowState', () => {
  test('shows pending review when a pending version exists', () => {
    const state = buildReportFlowState({
      pending_review_version: {
        version_id: 12,
        review_status: 'pending_review',
        parsed_json: { sections: [] },
      },
      active_version: null,
    });

    expect(state.label).toBe('待复核');
    expect(state.activeKey).toBe('review');
    expect(state.nextAction.label).toBe('处理问题');
  });

  test('does not invent exported status for a published report', () => {
    const state = buildReportFlowState({
      active_version: {
        version_id: 34,
        review_status: 'published',
        parsed_json: { sections: [] },
      },
      pending_review_version: null,
    });

    expect(state.label).toBe('可比对');
    expect(state.activeKey).toBe('comparable');
    expect(state.completedKeys).not.toContain('exportable');
    expect(state.nextAction.label).toBe('生成比对');
  });

  test('shows compared status when a reliable comparison signal exists', () => {
    const state = buildReportFlowState({
      active_version: {
        version_id: 34,
        review_status: 'published',
        parsed_json: { sections: [] },
      },
      pending_review_version: null,
      flow_signals: {
        latestComparison: { id: 1143, yearA: 2024, yearB: 2025 },
      },
    });

    expect(state.label).toBe('已比对');
    expect(state.activeKey).toBe('comparable');
    expect(state.completedKeys).toContain('comparable');
    expect(state.nextAction.label).toBe('查看比对');
    expect(state.nextAction.href).toBe('/comparison/1143');
  });

  test('shows exportable status when a completed PDF job is available', () => {
    const state = buildReportFlowState({
      active_version: {
        version_id: 34,
        review_status: 'published',
        parsed_json: { sections: [] },
      },
      pending_review_version: null,
      flow_signals: {
        latestComparison: { id: 1143, yearA: 2024, yearB: 2025 },
        latestCompletedPdfJob: { job_id: 18386 },
      },
    });

    expect(state.label).toBe('可导出');
    expect(state.activeKey).toBe('exportable');
    expect(state.completedKeys).toContain('exportable');
    expect(state.nextAction.label).toBe('查看导出任务');
    expect(state.nextAction.href).toBe('/jobs?tab=download');
  });

  test('falls back to uploaded when there is no parsed version', () => {
    const state = buildReportFlowState({
      latest_job: { status: 'succeeded' },
      active_version: null,
      pending_review_version: null,
    });

    expect(state.label).toBe('已上传');
    expect(state.activeKey).toBe('uploaded');
    expect(state.nextAction.label).toBe('自动解析');
  });
});
