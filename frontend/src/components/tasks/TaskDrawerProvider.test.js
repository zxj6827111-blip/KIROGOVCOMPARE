import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskDrawerProvider, useTaskDrawer } from './TaskDrawerProvider';
import { apiClient } from '../../apiClient';
import { ToastProvider } from '../common/ToastProvider';

jest.mock('../../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

function Harness() {
  const taskDrawer = useTaskDrawer();
  return (
    <button
      type="button"
      onClick={() => {
        taskDrawer.trackPdfJob({
          job_id: 7,
          comparison_id: 4670,
          status: 'done',
          progress: 100,
          export_title: '淮安市 2024-2025 年报比对',
          file_name: 'comparison.pdf',
          file_exists: false,
        });
        taskDrawer.openDrawer();
      }}
    >
      add expired job
    </button>
  );
}

describe('TaskDrawerProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockImplementation((url) => {
      if (url === '/jobs') {
        return Promise.resolve({ data: { jobs: [] } });
      }
      if (url === '/pdf-jobs') {
        return Promise.resolve({ data: { jobs: [] } });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  test('shows expired PDF jobs with regenerate action', async () => {
    apiClient.post.mockResolvedValue({
      data: {
        success: true,
        job_id: 7,
        file_name: 'comparison_4670_retry.pdf',
      },
    });

    render(
      <ToastProvider>
        <TaskDrawerProvider navigate={jest.fn()}>
          <Harness />
        </TaskDrawerProvider>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'add expired job' }));

    expect(screen.getByText('淮安市 2024-2025 年报比对')).toBeInTheDocument();
    expect(screen.getByText('文件已过期')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /重新生成/ }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/pdf-jobs/7/regenerate');
    });
  });

  test('uses a small PDF polling window for tracked drawer tasks', async () => {
    render(
      <ToastProvider>
        <TaskDrawerProvider navigate={jest.fn()}>
          <Harness />
        </TaskDrawerProvider>
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'add expired job' }));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/pdf-jobs', { params: { page: 1, limit: 20 } });
    });
  });

  test('does not render the drawer entry when disabled', () => {
    render(
      <ToastProvider>
        <TaskDrawerProvider navigate={jest.fn()} disabled>
          <Harness />
        </TaskDrawerProvider>
      </ToastProvider>
    );

    expect(screen.queryByRole('button', { name: '打开任务抽屉' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'add expired job' }));

    expect(screen.queryByLabelText('任务进度抽屉')).not.toBeInTheDocument();
  });
});
