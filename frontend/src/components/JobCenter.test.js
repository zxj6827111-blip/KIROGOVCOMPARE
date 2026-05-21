import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import JobCenter, { buildReportDetailPath } from './JobCenter';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  API_BASE_URL: '/api',
}));

jest.mock('./common/ToastProvider', () => ({
  useToast: () => ({
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock('./common/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => jest.fn(),
}));

describe('JobCenter report detail action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [{ id: 11, name: '宿迁高新区' }],
        });
      }
      if (url === '/jobs') {
        return Promise.resolve({
          data: {
            jobs: [
              {
                job_id: 7001,
                version_id: 8001,
                report_id: 9001,
                region_id: 11,
                year: 2025,
                unit_name: '宿迁高新区年政府信息公开工作年度报告',
                status: 'succeeded',
                progress: 100,
                step_name: '完成',
                attempt: 1,
                model: 'gpt-5.5',
                created_at: '2026-05-19T16:45:01Z',
              },
            ],
            pagination: { total: 1, totalPages: 1 },
          },
        });
      }
      if (url === '/pdf-jobs') {
        return Promise.resolve({ data: { jobs: [], pagination: { total: 0, totalPages: 1 } } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  test('opens the uploaded report detail page from the upload task row', async () => {
    render(<JobCenter />);

    const row = await screen.findByText('宿迁高新区年政府信息公开工作年度报告');
    const tableRow = row.closest('tr');
    expect(tableRow).not.toBeNull();

    const reportButton = within(tableRow).getByRole('button', { name: '报告' });
    expect(reportButton).toBeEnabled();
    expect(reportButton).toHaveAttribute('title', '进入报告详情页');
    expect(buildReportDetailPath(9001, '/jobs')).toBe('/catalog/reports/9001?returnTo=%2Fjobs');
  });

  test('disables the report action when a task has no report id', async () => {
    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({ data: [{ id: 11, name: '宿迁高新区' }] });
      }
      if (url === '/jobs') {
        return Promise.resolve({
          data: {
            jobs: [
              {
                job_id: 7002,
                version_id: 8002,
                report_id: null,
                region_id: 11,
                year: 2025,
                unit_name: '无报告编号任务',
                status: 'failed',
                progress: 50,
                step_name: 'AI 解析失败',
                attempt: 1,
                model: 'gpt-5.5',
                created_at: '2026-05-19T16:16:29Z',
                error_message: '解析过程遇到问题，请稍后重试或重新提交任务。',
              },
            ],
            pagination: { total: 1, totalPages: 1 },
          },
        });
      }
      if (url === '/pdf-jobs') {
        return Promise.resolve({ data: { jobs: [], pagination: { total: 0, totalPages: 1 } } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    render(<JobCenter />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '报告' })).toBeDisabled();
    });
  });
});
