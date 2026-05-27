import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsistencyCheckView from './ConsistencyCheckView';
import { apiClient } from '../apiClient';

const mockToast = {
  showToast: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  info: jest.fn(),
};
const mockConfirmAction = jest.fn();

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('./common/ToastProvider', () => ({
  useToast: () => mockToast,
}));

jest.mock('./common/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => mockConfirmAction,
}));

const baseData = {
  latest_run: { id: 1 },
  groups: [
    {
      group_key: 'quality',
      items: [
        {
          id: 101,
          check_key: 'narrative_sec5_gap',
          title: '语义审计：第五部分存在问题及改进情况空缺',
          auto_status: 'FAIL',
          human_status: 'pending',
          evidence: { paths: ['sections[5].content'] },
        },
      ],
    },
    {
      group_key: 'table3',
      items: [
        {
          id: 201,
          check_key: 't3_result_total_total',
          title: '表三勾稽问题',
          auto_status: 'FAIL',
          human_status: 'pending',
          left_value: 193,
          right_value: 217,
          delta: -24,
          evidence: {
            leftPaths: ['tableData.total.result'],
            rightPaths: ['tableData.total.detail'],
            values: {
              reason: 'mismatch',
              originalValue: '193',
              parsedValue: 193,
              comparedValue: 217,
            },
          },
        },
      ],
    },
  ],
};

const renderWithFeedback = (ui) => render(ui);

describe('ConsistencyCheckView quality mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { data: baseData } });
    apiClient.patch.mockResolvedValue({ data: { success: true } });
    apiClient.post.mockResolvedValue({ data: { success: true } });
    mockConfirmAction.mockResolvedValue(true);
  });

  test('quality mode shows amber summary and does not reuse consistency numbering label', async () => {
    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['visual', 'structure', 'quality']}
      />
    );

    await screen.findByText('数据质量审计');
    expect(screen.getAllByText('风险提示 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('需复核 1').length).toBeGreaterThan(0);
    expect(screen.getByText('数据质量提示不计入勾稽问题，也不会改变表三/表四的问题编号与定位。')).toBeInTheDocument();
    expect(screen.getByText('提示 1｜语义审计：第五部分存在问题及改进情况空缺')).toBeInTheDocument();
  });

  test('review items show readable evidence summary without changing numbering', async () => {
    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['table3']}
      />
    );

    await screen.findByText('勾稽关系校验');
    expect(screen.getAllByText('证据说明').length).toBeGreaterThan(0);
    expect(screen.getByText('比对值不一致')).toBeInTheDocument();
    expect(screen.getByText('tableData.total.result')).toBeInTheDocument();
    expect(screen.getAllByText('193').length).toBeGreaterThan(0);
    expect(screen.getAllByText('217').length).toBeGreaterThan(0);
  });

  test('pure not assessable groups still render conservative evidence summary', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          latest_run: { id: 2 },
          groups: [
            {
              group_key: 'table2',
              items: [
                {
                  id: 401,
                  check_key: 't2_no_rules',
                  title: '表二暂不具备可评估规则',
                  auto_status: 'NOT_ASSESSABLE',
                  human_status: 'pending',
                  evidence: { paths: ['activeDisclosureData.total'] },
                },
              ],
            },
          ],
        },
      },
    });

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['table2']}
      />
    );

    expect((await screen.findAllByText('暂无可评估规则')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('证据说明').length).toBeGreaterThan(0);
    expect(screen.getByText('字段为空或未抽取')).toBeInTheDocument();
    expect(screen.getAllByText('activeDisclosureData.total').length).toBeGreaterThan(0);
    expect(screen.queryByText('问题 1｜表二暂不具备可评估规则')).toBeNull();
  });

  test('hierarchy group surfaces delta count and renders compact business rows', async () => {
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          latest_run: { id: 3 },
          groups: [
            {
              group_key: 'hierarchy',
              displayName: '层级汇总一致性',
              items: [
                {
                  id: 501,
                  check_key: 'hierarchy_sum_v2_active__punishment__processed_count',
                  title: '层级汇总一致性：淮安市 表二 行政处罚-处理决定数量',
                  auto_status: 'UNCERTAIN',
                  human_status: 'pending',
                  left_value: 4289602,
                  right_value: 4128940,
                  delta: 160662,
                  tolerance: 0,
                  evidence: {
                    leftPaths: ['hierarchy.parent.721.active__punishment__processed_count'],
                    rightPaths: ['hierarchy.child.801.active__punishment__processed_count'],
                    values: {
                      reason: 'hierarchy_sum_incomplete_inputs',
                      table: '表二',
                      metricLabel: '行政处罚-处理决定数量',
                      childCount: 21,
                      childReportCount: 16,
                      childMetricCount: 16,
                      missingReports: [
                        { regionId: 9001, regionName: '涟水县' },
                        { regionId: 9002, regionName: '淮安区' },
                        { regionId: 9004, regionName: '金湖县' },
                        { regionId: 9005, regionName: '盱眙县' },
                        { regionId: 9006, regionName: '洪泽区' },
                        { regionId: 9007, regionName: '淮安经济技术开发区' },
                      ],
                      missingMetricChildren: [
                        { regionId: 9003, regionName: '生态文旅区' },
                        { regionId: 9008, regionName: '农业农村局' },
                      ],
                      context: '很长的旧上下文不应默认展示 hierarchy.child.801.active__punishment__processed_count',
                    },
                  },
                },
                {
                  id: 502,
                  check_key: 'hierarchy_sum_v2_legal__review__maintained',
                  title: '层级汇总一致性：淮安市 表四 复议后起诉-结果维持',
                  auto_status: 'UNCERTAIN',
                  human_status: 'pending',
                  left_value: 20,
                  right_value: 12,
                  delta: 8,
                  tolerance: 0,
                  evidence: {
                    values: {
                      reason: 'hierarchy_sum_incomplete_inputs',
                      table: '表四',
                      metricLabel: '复议后起诉-结果维持',
                      childCount: 50,
                      childReportCount: 24,
                      childMetricCount: 24,
                      missingReports: [],
                      missingMetricChildren: [],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['hierarchy']}
      />
    );

    await screen.findByRole('heading', { name: /层级汇总一致性/ });
    expect(screen.getByText('层级差额 2')).toBeInTheDocument();
    expect(screen.getByText('差额项 2')).toBeInTheDocument();
    expect(screen.getByText('缺报告单位 6')).toBeInTheDocument();
    expect(screen.getByText('缺字段单位 2')).toBeInTheDocument();
    expect(screen.queryByText('受资料缺口影响')).toBeNull();
    expect(screen.getByText('有差额的指标')).toBeInTheDocument();
    expect(screen.getByText('行政处罚-处理决定数量')).toBeInTheDocument();
    expect(screen.getByText('4,289,602')).toBeInTheDocument();
    expect(screen.getByText('4,128,940')).toBeInTheDocument();
    expect(screen.getByText('160,662')).toBeInTheDocument();
    expect(screen.getAllByText('有差额，待核查')).toHaveLength(2);
    expect(screen.queryByText(/hierarchy\.child/)).toBeNull();
    const tableSections = document.querySelectorAll('.hierarchy-table-section');
    expect(tableSections).toHaveLength(2);
    expect(tableSections[0]).toHaveTextContent('表二');
    expect(tableSections[0]).toHaveTextContent('行政处罚-处理决定数量');
    expect(tableSections[1]).toHaveTextContent('表四');
    expect(tableSections[1]).toHaveTextContent('复议后起诉-结果维持');
    expect(screen.getByText('涟水县、淮安区、金湖县、盱眙县、洪泽区、淮安经济技术开发区')).toBeInTheDocument();
    expect(screen.getByText('生态文旅区、农业农村局')).toBeInTheDocument();
    expect(screen.queryByText(/等 \d+ 个/)).toBeNull();
  });

  test('bulk confirm in quality mode updates quality items with one request', async () => {
    const user = userEvent.setup();

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['visual', 'structure', 'quality']}
      />
    );

    await screen.findByText('数据质量审计');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '一键标记为已处理' }));
    });
    expect(mockConfirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.any(String),
      confirmText: expect.any(String),
    }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/1/checks/items/bulk-status', {
        version_id: 2,
        item_ids: [101],
        human_status: 'confirmed',
        human_comment: '批量标记为已处理',
      });
    });

    expect(apiClient.patch).not.toHaveBeenCalled();
  });
});

describe('ConsistencyCheckView onChecksUpdated callback', () => {
  const consistencyData = {
    latest_run: { id: 1 },
    groups: [
      {
        group_key: 'table3',
        items: [
          {
            id: 201,
            check_key: 't3_identity_1',
            title: 'identity check',
            auto_status: 'FAIL',
            human_status: 'pending',
            evidence: {
              leftPaths: ['tableData.naturalPerson.newReceived'],
              rightPaths: ['tableData.naturalPerson.results.totalProcessed'],
            },
          },
          {
            id: 202,
            check_key: 't3_identity_2',
            title: 'identity check 2',
            auto_status: 'FAIL',
            human_status: 'pending',
            evidence: {
              leftPaths: ['tableData.legalPerson.newReceived'],
              rightPaths: ['tableData.legalPerson.results.totalProcessed'],
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { data: consistencyData } });
    apiClient.patch.mockResolvedValue({ data: { success: true } });
    apiClient.post.mockResolvedValue({ data: { success: true, updated_count: 2 } });
    mockConfirmAction.mockResolvedValue(true);
  });

  test('onChecksUpdated is called after bulk confirm completes', async () => {
    const user = userEvent.setup();
    const onChecksUpdated = jest.fn();

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['table3']}
        onChecksUpdated={onChecksUpdated}
      />
    );

    await screen.findByText('勾稽关系校验');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '一键确认' }));
    });
    expect(mockConfirmAction).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.any(String),
      confirmText: expect.any(String),
    }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/1/checks/items/bulk-status', {
        version_id: 2,
        item_ids: [201, 202],
        human_status: 'confirmed',
        human_comment: '批量确认',
      });
      expect(onChecksUpdated).toHaveBeenCalledTimes(1);
    });
  });

  test('bulk confirm excludes PASS items even when legacy data still marks them pending', async () => {
    const user = userEvent.setup();
    const onChecksUpdated = jest.fn();
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          latest_run: { id: 1 },
          groups: [
            {
              group_key: 'table3',
              items: [
                {
                  id: 401,
                  check_key: 't3_pass_legacy_pending',
                  title: 'pass check',
                  auto_status: 'PASS',
                  human_status: 'pending',
                  evidence: { paths: ['tableData.total.meta.pass'] },
                },
                {
                  id: 402,
                  check_key: 't3_uncertain_pending',
                  title: 'uncertain check',
                  auto_status: 'UNCERTAIN',
                  human_status: 'pending',
                  evidence: { paths: ['tableData.total.meta.uncertain'] },
                },
              ],
            },
          ],
        },
      },
    });
    apiClient.post.mockResolvedValue({ data: { success: true, updated_count: 1 } });

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['table3']}
        onChecksUpdated={onChecksUpdated}
      />
    );

    await screen.findByText('勾稽关系校验');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '一键确认' }));
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/1/checks/items/bulk-status', {
        version_id: 2,
        item_ids: [402],
        human_status: 'confirmed',
        human_comment: '批量确认',
      });
      expect(onChecksUpdated).toHaveBeenCalledTimes(1);
    });
  });

  test('bulk confirm excludes hierarchy completeness prompts from actionable ids', async () => {
    const user = userEvent.setup();
    const onChecksUpdated = jest.fn();
    apiClient.get.mockResolvedValue({
      data: {
        data: {
          latest_run: { id: 1 },
          groups: [
            {
              group_key: 'hierarchy',
              items: [
                {
                  id: 501,
                  check_key: 'hierarchy_sum_v2_application__total__new_received',
                  title: 'hierarchy delta',
                  auto_status: 'FAIL',
                  human_status: 'pending',
                  evidence: { values: { table: 'hierarchy' } },
                },
                {
                  id: 502,
                  check_key: 'hierarchy_missing_child_reports',
                  title: 'missing child reports',
                  auto_status: 'UNCERTAIN',
                  human_status: 'pending',
                  evidence: {
                    values: {
                      missingReports: [{ regionId: 1, regionName: 'A' }],
                    },
                  },
                },
                {
                  id: 503,
                  check_key: 'hierarchy_missing_child_metrics',
                  title: 'missing child metrics',
                  auto_status: 'UNCERTAIN',
                  human_status: 'pending',
                  evidence: {
                    values: {
                      missingMetricChildren: [{ regionId: 2, regionName: 'B' }],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });
    apiClient.post.mockResolvedValue({ data: { success: true, updated_count: 1 } });

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['hierarchy']}
        onChecksUpdated={onChecksUpdated}
      />
    );

    await screen.findByText('hierarchy delta');
    await act(async () => {
      await user.click(screen.getAllByRole('button')[0]);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/1/checks/items/bulk-status', {
        version_id: 2,
        item_ids: [501],
        human_status: 'confirmed',
        human_comment: expect.any(String),
      });
      expect(onChecksUpdated).toHaveBeenCalledTimes(1);
    });
  });

  test('onChecksUpdated is not called when no pending items exist', async () => {
    const user = userEvent.setup();
    const onChecksUpdated = jest.fn();
    const allConfirmedData = {
      latest_run: { id: 1 },
      groups: [
        {
          group_key: 'table3',
          items: [
            {
              id: 301,
              check_key: 't3_identity_1',
              title: 'identity check',
              auto_status: 'FAIL',
              human_status: 'confirmed',
              evidence: { paths: ['tableData.total.result'] },
            },
          ],
        },
      ],
    };
    apiClient.get.mockResolvedValue({ data: { data: allConfirmedData } });

    renderWithFeedback(
      <ConsistencyCheckView
        reportId={1}
        versionId={2}
        filterGroups={['table3']}
        onChecksUpdated={onChecksUpdated}
      />
    );

    await screen.findByText('勾稽关系校验');
    expect(screen.queryByRole('button', { name: '一键确认' })).toBeNull();
    expect(onChecksUpdated).not.toHaveBeenCalled();
  });
});
