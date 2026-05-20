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
          evidence: {
            leftPaths: ['tableData.total.result'],
            rightPaths: ['tableData.total.detail'],
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

  test('bulk confirm in quality mode only patches quality items', async () => {
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
      expect(apiClient.patch).toHaveBeenCalledTimes(1);
    });

    expect(apiClient.patch).toHaveBeenCalledWith('/reports/1/checks/items/101', {
      version_id: 2,
      human_status: 'confirmed',
      human_comment: '批量标记为已处理',
    });
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
