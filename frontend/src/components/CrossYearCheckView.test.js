import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CrossYearCheckView from './CrossYearCheckView';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

const buildChecksResponse = (items, groupOverrides = {}) => ({
  data: {
    data: {
      groups: [
        {
          group_key: 'text',
          ...groupOverrides,
          items: Array.isArray(items) ? items : [items],
        },
      ],
    },
  },
});

const issue = {
  id: 'issue-1',
  title: '层级汇总一致性：淮安市 表二 行政事业性收费-收费金额',
  auto_status: 'FAIL',
  human_status: 'pending',
  left_value: 96171.6,
  right_value: 86489.36290000001,
  delta: 9682.237099999998,
  evidence: {
    leftPaths: ['hierarchy.parent.721.active__fees__amount'],
    rightPaths: ['hierarchy.child.784.active__fees__amount'],
    paths: [
      'hierarchy.parent.721.active__fees__amount',
      'hierarchy.child.784.active__fees__amount',
      'hierarchy.child.785.active__fees__amount',
    ],
    values: {},
  },
};

const decimalIssue = {
  id: 'issue-decimal',
  title: '表三勾稽问题',
  auto_status: 'FAIL',
  human_status: 'pending',
  left_value: 96171.6,
  right_value: 86489.36290000001,
  delta: 9682.237099999998,
  evidence: {
    leftPaths: ['tableData.total.results.totalProcessed'],
    rightPaths: ['tableData.total.carriedOver'],
    values: {},
  },
};

const normalIssue = {
  id: 'issue-2',
  title: '表三勾稽问题',
  auto_status: 'FAIL',
  human_status: 'pending',
  left_value: 15,
  right_value: 21,
  delta: -6,
  evidence: {
    leftPaths: ['tableData.total.results.totalProcessed'],
    rightPaths: ['tableData.total.carriedOver'],
    values: {},
  },
};

describe('CrossYearCheckView', () => {
  beforeEach(() => {
    apiClient.get.mockReset();
    apiClient.get.mockResolvedValue(buildChecksResponse(decimalIssue));
  });

  test('hides technical table path lists and formats noisy decimal values', async () => {
    apiClient.get.mockResolvedValue(buildChecksResponse(decimalIssue));

    render(
      <CrossYearCheckView
        leftReportId={721}
        rightReportId={784}
        leftContent={{ sections: [] }}
        rightContent={{ sections: [] }}
        yearA={2023}
        yearB={2024}
      />
    );

    expect(await screen.findAllByText(/96171\.6/)).not.toHaveLength(0);

    await waitFor(() => {
      expect(screen.queryByText('表格具体位置')).not.toBeInTheDocument();
      expect(screen.queryByText(/86489\.36290000001/)).not.toBeInTheDocument();
      expect(screen.queryByText(/9682\.237099999998/)).not.toBeInTheDocument();
    });

    expect(screen.getAllByText('86489.36')).not.toHaveLength(0);
    expect(screen.getAllByText('9682.24')).not.toHaveLength(0);
  });

  test('omits hierarchy consistency issues from comparison report output', async () => {
    apiClient.get.mockResolvedValue(buildChecksResponse([issue, normalIssue], { group_key: 'hierarchy' }));

    render(
      <CrossYearCheckView
        leftReportId={721}
        rightReportId={784}
        leftContent={{ sections: [] }}
        rightContent={{ sections: [] }}
        yearA={2023}
        yearB={2024}
      />
    );

    expect(await screen.findAllByText('层级汇总一致性存在问题，详见具体报告内')).toHaveLength(2);
    expect(screen.queryByText(/层级汇总一致性：淮安市/)).not.toBeInTheDocument();
    expect(screen.queryByText(/左值:/)).not.toBeInTheDocument();
  });

  test('summarizes hidden hierarchy issues instead of marking the year as no issue', async () => {
    apiClient.get.mockResolvedValue(buildChecksResponse(issue, { group_key: 'hierarchy' }));

    render(
      <CrossYearCheckView
        leftReportId={721}
        rightReportId={784}
        leftContent={{ sections: [] }}
        rightContent={{ sections: [] }}
        yearA={2023}
        yearB={2024}
      />
    );

    expect(await screen.findAllByText('层级汇总一致性存在问题，详见具体报告内')).toHaveLength(2);
    expect(screen.queryByText(/层级汇总一致性：淮安市/)).not.toBeInTheDocument();
    expect(screen.queryByText(/左值:/)).not.toBeInTheDocument();
    expect(screen.queryByText('无问题')).not.toBeInTheDocument();
  });

  test('keeps non-hierarchy issues visible in comparison report output', async () => {
    apiClient.get.mockResolvedValue(buildChecksResponse(normalIssue));

    render(
      <CrossYearCheckView
        leftReportId={721}
        rightReportId={784}
        leftContent={{ sections: [] }}
        rightContent={{ sections: [] }}
        yearA={2023}
        yearB={2024}
      />
    );

    expect(await screen.findAllByText('表三勾稽问题')).not.toHaveLength(0);
    expect(screen.getAllByText(/左值: 15/)).not.toHaveLength(0);
  });
});
