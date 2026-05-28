import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CityIndex, { __resetCityIndexCacheForTests, buildCatalogReturnPath } from './CityIndex';
import { apiClient, getCurrentUser } from '../apiClient';

const mockToast = {
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
    delete: jest.fn(),
  },
  getCurrentUser: jest.fn(),
}));

jest.mock('./common/ToastProvider', () => ({
  useToast: () => mockToast,
}));

jest.mock('./common/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => mockConfirmAction,
}));

describe('buildCatalogReturnPath', () => {
  test('preserves the current catalog hierarchy as a return target', () => {
    expect(buildCatalogReturnPath([12, '34'], '?tab=all')).toBe('/catalog?tab=all&region=12%2C34');
  });

  test('drops stale region when returning from the root catalog layer', () => {
    expect(buildCatalogReturnPath([], '?region=12%2C34&tab=all')).toBe('/catalog?tab=all');
  });

  test('does not carry nested returnTo parameters back into catalog links', () => {
    expect(buildCatalogReturnPath([12], '?returnTo=%2Fjobs&tab=all')).toBe('/catalog?tab=all&region=12');
  });
});

describe('CityIndex report actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetCityIndexCacheForTests();
    mockConfirmAction.mockResolvedValue(true);
    getCurrentUser.mockReturnValue({
      username: 'viewer',
      permissions: { view_reports: true },
    });

    window.history.replaceState({}, '', '/catalog?region=1');

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 1, name: '测试区', parent_id: null, level: 3 },
          ],
        });
      }
      if (url === '/reports') {
        return Promise.resolve({
          data: [
            {
              report_id: 123,
              region_id: 1,
              year: 2025,
              created_at: '2026-05-22T00:00:00Z',
            },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: { checked: true, total: 0, has_content: true },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
  });

  test('hides report delete action when current user lacks delete_reports', async () => {
    render(<CityIndex />);

    await screen.findByText('2025年度');

    await waitFor(() => {
      expect(screen.queryByTitle('删除报告')).not.toBeInTheDocument();
    });
  });

  test('splits pending report card issues into non-overlapping categories', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 90,
              has_content: true,
              consistency: 90,
              hierarchy_pending: 75,
              consistency_other: 15,
              hierarchy_delta: 75,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('待复核 90')).toBeInTheDocument();
    expect(screen.getByText('勾稽问题 15')).toBeInTheDocument();
    expect(screen.getByText('层级统计问题 75')).toBeInTheDocument();
    expect(screen.queryByText('勾稽 90')).not.toBeInTheDocument();
    expect(screen.queryByText('层级差额 75')).not.toBeInTheDocument();
    expect(screen.queryByText('发现 90 个问题')).not.toBeInTheDocument();
  });

  test('shows confirmed abnormalities without labeling them as pending problems', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 200,
              confirmed_consistency: 119,
              confirmed_hierarchy: 81,
              confirmed_hierarchy_delta: 81,
              reviewed_count: 200,
              dismissed_count: 0,
              hierarchy_delta: 0,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核·问题 200')).toBeInTheDocument();
    expect(await screen.findByText('勾稽问题 119')).toBeInTheDocument();
    expect(screen.getByText('层级统计问题 81')).toBeInTheDocument();
    expect(screen.queryByText('已确认异常 200')).not.toBeInTheDocument();
    expect(screen.queryByText('层级差额 81')).not.toBeInTheDocument();
    expect(screen.queryByText('发现 200 个问题')).not.toBeInTheDocument();
    expect(screen.queryByText('无待复核项')).not.toBeInTheDocument();
  });

  test('keeps the same issue type labels after review when confirmed split is missing', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 90,
              reviewed_count: 90,
              dismissed_count: 0,
              consistency: 90,
              hierarchy_pending: 75,
              consistency_other: 15,
              hierarchy_delta: 75,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核·问题 90')).toBeInTheDocument();
    expect(screen.getByText('勾稽问题 15')).toBeInTheDocument();
    expect(screen.getByText('层级统计问题 75')).toBeInTheDocument();
    expect(screen.queryByText('保留问题 90')).not.toBeInTheDocument();
    expect(screen.queryByText('保留层级统计问题 75')).not.toBeInTheDocument();
  });

  test('infers reviewed issue categories when confirmed split fields are zero', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 90,
              confirmed_consistency: 0,
              confirmed_hierarchy: 0,
              confirmed_hierarchy_delta: 0,
              reviewed_count: 90,
              dismissed_count: 0,
              consistency: 90,
              hierarchy_pending: 75,
              consistency_other: 15,
              hierarchy_delta: 75,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核·问题 90')).toBeInTheDocument();
    expect(screen.getByText('勾稽问题 15')).toBeInTheDocument();
    expect(screen.getByText('层级统计问题 75')).toBeInTheDocument();
    expect(screen.queryByText('问题 90')).not.toBeInTheDocument();
    expect(screen.queryByText('保留问题 90')).not.toBeInTheDocument();
  });

  test('keeps reviewed inference based on issue items while displaying missing report units', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 3,
              confirmed_consistency: 0,
              confirmed_hierarchy: 0,
              confirmed_hierarchy_delta: 0,
              reviewed_count: 3,
              dismissed_count: 0,
              consistency: 3,
              consistency_other: 2,
              hierarchy_pending: 1,
              hierarchy_delta: 0,
              hierarchy_completeness: 1,
              hierarchy_missing_report: 1,
              hierarchy_missing_report_units: 56,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核·问题 3')).toBeInTheDocument();
    expect(screen.getByText('勾稽问题 2')).toBeInTheDocument();
    expect(screen.getByText('缺报告单位 56')).toBeInTheDocument();
    expect(screen.queryByText('问题 3')).not.toBeInTheDocument();
  });

  test('uses hierarchy delta as reviewed hierarchy count and keeps uncertain hierarchy in consistency bucket', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 90,
              confirmed_consistency: 8,
              confirmed_hierarchy: 82,
              confirmed_hierarchy_delta: 75,
              reviewed_count: 90,
              dismissed_count: 0,
              consistency: 90,
              consistency_other: 15,
              hierarchy_pending: 75,
              hierarchy_delta: 75,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核·问题 90')).toBeInTheDocument();
    expect(screen.getByText('勾稽问题 15')).toBeInTheDocument();
    expect(screen.getByText('层级统计问题 75')).toBeInTheDocument();
    expect(screen.queryByText('层级统计问题 82')).not.toBeInTheDocument();
    expect(screen.queryByText('勾稽问题 8')).not.toBeInTheDocument();
    expect(screen.queryByText('问题 90')).not.toBeInTheDocument();
  });

  test('shows hierarchy completeness separately from consistency and delta issues', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 2,
              has_content: true,
              consistency: 1,
              consistency_other: 0,
              hierarchy_pending: 1,
              hierarchy_delta: 0,
              hierarchy_completeness: 1,
              hierarchy_missing_report: 1,
              hierarchy_missing_report_units: 56,
              quality_review: 1,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('待复核 2')).toBeInTheDocument();
    expect(screen.getByText('缺报告单位 56')).toBeInTheDocument();
    expect(screen.getByText('质量问题 1')).toBeInTheDocument();
    expect(screen.queryByText('勾稽问题 1')).not.toBeInTheDocument();
    expect(screen.queryByText('层级统计问题 1')).not.toBeInTheDocument();
  });

  test('marks reviewed reports even when all reviewed items were dismissed', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 0,
              has_content: true,
              confirmed_abnormal: 0,
              reviewed_count: 4,
              dismissed_count: 4,
              hierarchy_delta: 0,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已复核 4')).toBeInTheDocument();
    expect(screen.getByText('无待复核项')).toBeInTheDocument();
    expect(screen.queryByText('已复核·问题 4')).not.toBeInTheDocument();
  });

  test('runs top batch check for all reports from root catalog', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/catalog');

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 1, name: '江苏省', parent_id: null, level: 1 },
          ],
        });
      }
      if (url === '/reports') {
        return Promise.resolve({
          data: [
            { report_id: 101, region_id: 1, year: 2024 },
            { report_id: 102, region_id: 2, year: 2024 },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            101: { checked: true, total: 0, has_content: true },
            102: { checked: true, total: 0, has_content: true },
          },
        });
      }
      if (url === '/reports/batch-checks/run') {
        return Promise.resolve({ data: { processed: 2, skipped: 0, failed: 0 } });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    const batchButton = await screen.findByRole('button', { name: '批量校验' });
    await act(async () => {
      await user.click(batchButton);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/batch-checks/run', { report_ids: [101, 102] });
    });
    expect(mockConfirmAction).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('全库的 2 份报告'),
    }));
  });

  test('runs top batch check for current region and descendants', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/catalog?region=1');

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 1, name: '宿迁市', parent_id: null, level: 2 },
            { id: 2, name: '宿城区', parent_id: 1, level: 3 },
            { id: 3, name: '宿城区教育局', parent_id: 2, level: 4 },
            { id: 9, name: '其他市', parent_id: null, level: 2 },
          ],
        });
      }
      if (url === '/reports') {
        return Promise.resolve({
          data: [
            { report_id: 201, region_id: 1, year: 2024 },
            { report_id: 202, region_id: 2, year: 2024 },
            { report_id: 203, region_id: 3, year: 2024 },
            { report_id: 999, region_id: 9, year: 2024 },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            201: { checked: true, total: 0, has_content: true },
            202: { checked: true, total: 0, has_content: true },
            203: { checked: true, total: 0, has_content: true },
            999: { checked: true, total: 0, has_content: true },
          },
        });
      }
      if (url === '/reports/batch-checks/run') {
        return Promise.resolve({ data: { processed: 3, skipped: 0, failed: 0 } });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    const batchButton = await screen.findByRole('button', { name: '批量校验' });
    await act(async () => {
      await user.click(batchButton);
    });

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/batch-checks/run', { report_ids: [201, 202, 203] });
    });
    expect(apiClient.post).not.toHaveBeenCalledWith('/reports/batch-checks/run', { report_ids: expect.arrayContaining([999]) });
    expect(screen.queryByTitle('对当前筛选报告批量运行勾稽校验')).not.toBeInTheDocument();
  });

  test('shows batch progress and warns before refreshing while running', async () => {
    const user = userEvent.setup();
    let resolveBatchCheck;
    window.history.replaceState({}, '', '/catalog');

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 1, name: '江苏省', parent_id: null, level: 1 },
          ],
        });
      }
      if (url === '/reports') {
        return Promise.resolve({
          data: [
            { report_id: 101, region_id: 1, year: 2024 },
            { report_id: 102, region_id: 2, year: 2024 },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            101: { checked: true, total: 0, has_content: true },
            102: { checked: true, total: 0, has_content: true },
          },
        });
      }
      if (url === '/reports/batch-checks/run') {
        return new Promise((resolve) => {
          resolveBatchCheck = resolve;
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    const batchButton = await screen.findByRole('button', { name: '批量校验' });
    await act(async () => {
      await user.click(batchButton);
    });

    expect(await screen.findByText('校验 0%')).toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();

    const beforeUnloadEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    await act(async () => {
      resolveBatchCheck({ data: { processed: 2, skipped: 0, failed: 0 } });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '批量校验' })).toBeEnabled();
    });
  });
});

describe('CityIndex child search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetCityIndexCacheForTests();
    mockConfirmAction.mockResolvedValue(true);
    getCurrentUser.mockReturnValue({
      username: 'viewer',
      permissions: { view_reports: true },
    });

    window.history.replaceState({}, '', '/catalog?region=715');

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 715, name: '淮安市', parent_id: null, level: 2 },
            { id: 721, name: '教育局', parent_id: 715, level: 4 },
            { id: 801, name: '南通市教育局', parent_id: 800, level: 4 },
            { id: 802, name: '区教育局', parent_id: 803, level: 4 },
          ],
        });
      }
      if (url === '/reports') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({ data: {} });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });
  });

  test('filters only the current hierarchy children instead of searching all regions', async () => {
    const user = userEvent.setup();
    render(<CityIndex />);

    await screen.findByText('教育局');

    await user.type(screen.getByPlaceholderText('搜索名称...'), '教育局');

    expect(screen.getByText('教育局')).toBeInTheDocument();
    expect(screen.queryByText('南通市教育局')).not.toBeInTheDocument();
    expect(screen.queryByText('区教育局')).not.toBeInTheDocument();
  });
});
