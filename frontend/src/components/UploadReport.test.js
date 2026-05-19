import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import UploadReport from './UploadReport';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  __esModule: true,
  default: {
    getDocument: jest.fn(() => ({
      promise: Promise.resolve({
        getPage: jest.fn().mockResolvedValue({
          getTextContent: jest.fn().mockResolvedValue({
            items: [
              { str: '淮安市洪泽区人民政府' },
              { str: '2025年政府信息公开工作年度报告' },
            ],
          }),
        }),
        destroy: jest.fn().mockResolvedValue(undefined),
      }),
    })),
  },
}));

describe('UploadReport pdf auto detect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockImplementation((url) => {
      if (url === '/regions') {
        return Promise.resolve({
          data: [
            { id: 1, name: '江苏省', parent_id: null, level: 1 },
            { id: 2, name: '淮安市', parent_id: 1, level: 2 },
            { id: 3, name: '淮安市洪泽区', parent_id: 2, level: 3 },
          ],
        });
      }
      if (url === '/ai/config') {
        return Promise.resolve({
          data: {
            uploadParse: {
              defaultModel: 'openai/gpt-5.5',
              options: [{ value: 'openai/gpt-5.5', label: 'GPT-5.5' }],
            },
          },
        });
      }
      if (url === '/reports') {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  test('uses first-page pdf text to auto-select matched region', async () => {
    const { container } = render(<UploadReport />);

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(['fake pdf'], 'hzq.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('江苏省')).toBeInTheDocument();
      expect(screen.getByDisplayValue('淮安市')).toBeInTheDocument();
      expect(screen.getByDisplayValue('淮安市洪泽区')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('2025')).toBeInTheDocument();
    });
  });
});
