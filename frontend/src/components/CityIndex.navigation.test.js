import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CityIndex, { __resetCityIndexCacheForTests, buildCatalogReturnPath } from './CityIndex';
import { apiClient, getCurrentUser } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  getCurrentUser: jest.fn(),
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

  test('shows pending review source hints on report cards', async () => {
    apiClient.post.mockImplementation((url) => {
      if (url === '/reports/batch-check-status') {
        return Promise.resolve({
          data: {
            123: {
              checked: true,
              total: 109,
              has_content: true,
              consistency: 109,
              hierarchy_delta: 63,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('待复核 109')).toBeInTheDocument();
    expect(screen.getByText('勾稽 109')).toBeInTheDocument();
    expect(screen.getByText('层级差额 63')).toBeInTheDocument();
    expect(screen.queryByText('发现 109 个问题')).not.toBeInTheDocument();
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
              hierarchy_delta: 81,
            },
          },
        });
      }
      return Promise.reject(new Error(`Unexpected POST ${url}`));
    });

    render(<CityIndex />);

    expect(await screen.findByText('已确认异常 200')).toBeInTheDocument();
    expect(screen.getByText('层级差额 81')).toBeInTheDocument();
    expect(screen.queryByText('发现 200 个问题')).not.toBeInTheDocument();
    expect(screen.queryByText('无待复核项')).not.toBeInTheDocument();
  });
});

describe('CityIndex child search', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetCityIndexCacheForTests();
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
