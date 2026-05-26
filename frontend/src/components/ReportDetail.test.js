import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportDetail from './ReportDetail';
import { apiClient, getCurrentUser } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  },
  getCurrentUser: jest.fn(),
}));

jest.mock('./ConsistencyCheckView', () => ({ onLocate }) => (
  <div data-testid="checks-view">
    <button
      type="button"
      onClick={() =>
        onLocate?.({
          title: '问题 1｜表三勾稽问题',
          leftPaths: ['tableData.total.newReceived'],
          rightPaths: ['tableData.total.results.totalProcessed'],
          item: {
            auto_status: 'FAIL',
            title: '表三勾稽问题',
            left_value: 193,
            right_value: 217,
            evidence: {
              leftPaths: ['tableData.total.newReceived'],
              rightPaths: ['tableData.total.results.totalProcessed'],
              values: {
                reason: 'mismatch',
                originalValue: '193',
                parsedValue: 193,
                comparedValue: 217,
              },
            },
          },
        })
      }
    >
      mock locate
    </button>
  </div>
));
jest.mock('./ParsedDataEditor', () => () => <div data-testid="parsed-editor" />);
jest.mock('./TableViews', () => ({
  Table2View: ({ data }) => <div data-testid="table-2-view">{JSON.stringify(data)}</div>,
  Table3View: ({ data }) => <div data-testid="table-3-view">{JSON.stringify(data)}</div>,
  Table4View: ({ data }) => <div data-testid="table-4-view">{JSON.stringify(data)}</div>,
}));

jest.mock('./VisionReviewPanel', () => {
  const React = require('react');

  return function MockVisionReviewPanel({ onDataChange }) {
    React.useEffect(() => {
      onDataChange?.({
        reviews: [{ id: 1, tableId: 'table_2', conclusion: 'source_table_anomaly' }],
        corrections: [{ id: 1, tableId: 'table_2', status: 'pending' }],
      });
    }, [onDataChange]);

    return <div data-testid="vision-review-panel">mock vision review</div>;
  };
});

const reportPayload = {
  report_id: 123,
  region_id: 1,
  year: 2025,
  region_name: '测试市',
  latest_job: null,
  active_version: {
    version_id: 99,
    parsed_json: {
      sections: [{ type: 'text', title: '概述', content: '测试正文' }],
    },
    review_status: 'published',
    is_active: true,
  },
};

describe('ReportDetail vision review integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCurrentUser.mockReturnValue({
      username: 'admin',
      permissions: {
        upload_reports: true,
        delete_reports: true,
        manage_jobs: true,
      },
    });

    apiClient.get.mockImplementation((url) => {
      switch (url) {
        case '/reports/123':
          return Promise.resolve({ data: { data: reportPayload } });
        case '/v2/reports/123/facts/active_disclosure':
        case '/v2/reports/123/facts/application':
        case '/v2/reports/123/facts/legal_proceeding':
          return Promise.resolve({ data: { data: [] } });
        case '/reports/123/checks':
          return Promise.resolve({ data: { data: { groups: [] } } });
        case '/reports/123/vision-review':
          return Promise.resolve({ data: { data: { reviews: [], corrections: [] } } });
        default:
          return Promise.reject(new Error(`Unexpected GET ${url}`));
      }
    });
  });

  test('switching to vision review does not refresh the whole report when child syncs data', async () => {
    render(<ReportDetail reportId="123" />);

    await screen.findByText('报告详情');

    const initialDetailFetches = apiClient.get.mock.calls.filter(([url]) => url === '/reports/123');
    expect(initialDetailFetches).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '视觉复核' }));

    await screen.findByTestId('vision-review-panel');

    await waitFor(() => {
      const detailFetches = apiClient.get.mock.calls.filter(([url]) => url === '/reports/123');
      expect(detailFetches).toHaveLength(1);
    });
  });

  test('keeps null fact values out of zero-like content rendering', async () => {
    apiClient.get.mockImplementation((url) => {
      switch (url) {
        case '/reports/123':
          return Promise.resolve({ data: { data: reportPayload } });
        case '/v2/reports/123/facts/active_disclosure':
          return Promise.resolve({ data: { data: [] } });
        case '/v2/reports/123/facts/application':
          return Promise.resolve({
            data: {
              data: [
                { applicant_type: 'total', response_type: 'new_received', count: 7 },
                { applicant_type: 'total', response_type: 'unable_no_info', count: null },
              ],
            },
          });
        case '/v2/reports/123/facts/legal_proceeding':
          return Promise.resolve({ data: { data: [] } });
        case '/reports/123/checks':
          return Promise.resolve({ data: { data: { groups: [] } } });
        case '/reports/123/vision-review':
          return Promise.resolve({ data: { data: { reviews: [], corrections: [] } } });
        default:
          return Promise.reject(new Error(`Unexpected GET ${url}`));
      }
    });

    render(<ReportDetail reportId="123" />);

    const table3View = await screen.findByTestId('table-3-view');
    const parsed = JSON.parse(table3View.textContent);
    expect(parsed.total.newReceived).toBe(7);
    expect(parsed.total.results.unableToProvide.noInfo).toBeNull();
  });

  test('locating a check shows evidence summary in the focus banner', async () => {
    const user = userEvent.setup();

    render(<ReportDetail reportId="123" />);

    await screen.findByText('报告详情');
    await user.click(screen.getByRole('button', { name: '勾稽关系校验' }));
    await user.click(screen.getByRole('button', { name: 'mock locate' }));

    expect(await screen.findByText('定位：问题 1｜表三勾稽问题')).toBeInTheDocument();
    expect(screen.getByText('证据说明')).toBeInTheDocument();
    expect(screen.getByText('比对值不一致')).toBeInTheDocument();
    expect(screen.getByText('tableData.total.newReceived')).toBeInTheDocument();
    expect(screen.getByText('217')).toBeInTheDocument();
  });

  test('shows issue badges on the detail tabs', async () => {
    apiClient.get.mockImplementation((url) => {
      switch (url) {
        case '/reports/123':
          return Promise.resolve({ data: { data: reportPayload } });
        case '/v2/reports/123/facts/active_disclosure':
        case '/v2/reports/123/facts/application':
        case '/v2/reports/123/facts/legal_proceeding':
          return Promise.resolve({ data: { data: [] } });
        case '/reports/123/checks':
          return Promise.resolve({
            data: {
              data: {
                groups: [
                  {
                    group_key: 'table3',
                    items: [
                      {
                        id: 1,
                        check_key: 't3_identity',
                        auto_status: 'FAIL',
                        human_status: 'pending',
                        title: '表三勾稽异常',
                        evidence: {},
                      },
                    ],
                  },
                  {
                    group_key: 'quality',
                    items: [
                      {
                        id: 2,
                        check_key: 'narrative_sec5_gap',
                        auto_status: 'FAIL',
                        human_status: 'pending',
                        title: '第五部分缺少说明',
                        evidence: {},
                      },
                    ],
                  },
                ],
              },
            },
          });
        case '/reports/123/vision-review':
          return Promise.resolve({
            data: {
              data: {
                reviews: [{ id: 1, tableId: 'table_2', conclusion: 'source_table_anomaly' }],
                corrections: [{ id: 1, tableId: 'table_2', status: 'pending' }],
              },
            },
          });
        default:
          return Promise.reject(new Error(`Unexpected GET ${url}`));
      }
    });

    render(<ReportDetail reportId="123" />);

    await screen.findByText('报告详情');

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /勾稽关系校验\s*1/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /数据质量审计\s*1/ })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /视觉复核\s*2/ })
      ).toBeInTheDocument();
    });
  });

  test('hides delete report action when current user lacks delete_reports', async () => {
    getCurrentUser.mockReturnValue({
      username: 'uploader',
      permissions: {
        upload_reports: true,
        manage_jobs: true,
      },
    });

    render(<ReportDetail reportId="123" />);

    await screen.findByText('报告详情');

    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '自动解析' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除报告' })).not.toBeInTheDocument();
  });
});
