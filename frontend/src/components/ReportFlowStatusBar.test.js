import { buildReportFlowState } from './ReportFlowStatusBar';

describe('buildReportFlowState', () => {
  test('shows pending review when a pending version exists', () => {
    const state = buildReportFlowState({
      pending_review_version: {
        version_id: 12,
        review_status: 'pending_review',
        parsed_json: { sections: [] },
        open_issue_count: 5,
      },
      active_version: null,
    });

    expect(state.label).toBe('待复核');
    expect(state.activeKey).toBe('review');
    expect(state.nextAction.label).toBe('处理问题');
    expect(state.description).toContain('还有 5 个复核项');
  });

  test('shows publish action when pending review issues are resolved', () => {
    const state = buildReportFlowState({
      pending_review_version: {
        version_id: 12,
        review_status: 'pending_review',
        parsed_json: { sections: [] },
        open_issue_count: 0,
      },
      active_version: null,
    });

    expect(state.label).toBe('待发布');
    expect(state.activeKey).toBe('publish');
    expect(state.nextAction.label).toBe('发布正式版本');
    expect(state.nextAction.target).toBe('publishPending');
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
    expect(state.stepLabelOverrides.comparable).toBe('已比对');
    expect(state.description).toContain('生成 PDF 后才会进入可导出');
    expect(state.nextAction.label).toBe('查看比对详情');
    expect(state.nextAction.href).toBe('/comparison/1143');
  });

  test('shows PDF progress when an export job is still running', () => {
    const state = buildReportFlowState({
      active_version: {
        version_id: 34,
        review_status: 'published',
        parsed_json: { sections: [] },
      },
      pending_review_version: null,
      flow_signals: {
        latestComparison: { id: 1143, yearA: 2024, yearB: 2025 },
        latestPdfJob: { job_id: 18386, status: 'processing', file_exists: false },
      },
    });

    expect(state.label).toBe('PDF生成中');
    expect(state.activeKey).toBe('exportable');
    expect(state.completedKeys).not.toContain('exportable');
    expect(state.stepLabelOverrides.exportable).toBe('PDF生成中');
    expect(state.nextAction.label).toBe('查看生成进度');
    expect(state.nextAction.href).toBe('/jobs?tab=download');
  });

  test('shows downloadable PDF status when a completed PDF job is available', () => {
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

    expect(state.label).toBe('PDF可下载');
    expect(state.activeKey).toBe('exportable');
    expect(state.completedKeys).toContain('exportable');
    expect(state.stepLabelOverrides.exportable).toBe('PDF可下载');
    expect(state.nextAction.label).toBe('查看下载任务');
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

  test('keeps pending review for unresolved versions when open_issue_count is missing', () => {
    const state = buildReportFlowState({
      pending_review_version: {
        version_id: 12,
        review_status: 'pending_review',
        parsed_json: { sections: [] },
      },
      active_version: null,
    });

    expect(state.label).toBe('待复核');
    expect(state.nextAction.label).toBe('处理问题');
  });
});
