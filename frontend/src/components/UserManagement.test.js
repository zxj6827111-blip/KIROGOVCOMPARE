import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserManagement from './UserManagement';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
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

describe('UserManagement permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    apiClient.get.mockImplementation((url) => {
      if (url === '/users') {
        return Promise.resolve({
          data: [
            {
              id: 2,
              username: 'auditor',
              displayName: '审计账号',
              permissions: {
                view_reports: true,
                upload_reports: true,
                delete_reports: false,
              },
              dataScope: { regions: [] },
              last_login_at: null,
            },
          ],
        });
      }
      if (url === '/regions') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  test('saves delete_reports when the delete report permission is selected', async () => {
    const user = userEvent.setup();
    render(<UserManagement />);

    await screen.findByText('auditor');
    await user.click(screen.getByRole('button', { name: /编辑/i }));

    const deleteReportPermission = screen.getByRole('checkbox', { name: '删除报告' });
    expect(deleteReportPermission).not.toBeChecked();

    await user.click(deleteReportPermission);
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/users/2',
        expect.objectContaining({
          permissions: expect.objectContaining({
            delete_reports: true,
          }),
        })
      );
    });
  });
});
