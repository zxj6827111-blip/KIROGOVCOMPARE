import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CityIndex, { buildCatalogReturnPath } from './CityIndex';
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
});
