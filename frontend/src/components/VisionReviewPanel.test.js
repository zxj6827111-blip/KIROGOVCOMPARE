import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VisionReviewPanel from './VisionReviewPanel';
import { apiClient } from '../apiClient';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const buildResponse = () => ({
  data: {
    data: {
      reviews: [
        {
          id: 1,
          tableId: 'table_2',
          status: 'completed',
          conclusion: 'source_table_anomaly',
          model: 'gpt-5.5',
          apiMode: 'responses',
          updatedAt: '2026-05-15T08:00:00.000Z',
          comparison: {
            conclusion: 'source_table_anomaly',
            differences: [],
            unreadableCells: [],
          },
        },
        {
          id: 2,
          tableId: 'table_3',
          status: 'completed',
          conclusion: 'parse_mapping_anomaly',
          model: 'gpt-5.5',
          apiMode: 'responses',
          updatedAt: '2026-05-15T08:01:00.000Z',
          comparison: {
            conclusion: 'parse_mapping_anomaly',
            differences: [
              {
                path: 'tableData.total.results.totalProcessed',
                parsedValue: 12,
                ocrValue: 21,
              },
            ],
            unreadableCells: [],
          },
        },
        {
          id: 3,
          tableId: 'table_4',
          status: 'completed',
          conclusion: 'source_table_matches_parse',
          model: 'gpt-5.5',
          apiMode: 'responses',
          updatedAt: '2026-05-15T08:02:00.000Z',
          comparison: {
            conclusion: 'source_table_matches_parse',
            differences: [],
            unreadableCells: [],
          },
        },
      ],
      corrections: [
        {
          id: 11,
          tableId: 'table_3',
          fieldPath: 'tableData.total.results.totalProcessed',
          parsedValue: 12,
          ocrValue: 21,
          status: 'pending',
        },
        {
          id: 12,
          tableId: 'table_4',
          fieldPath: 'reviewLitigationData.review.total',
          parsedValue: 3,
          ocrValue: 4,
          status: 'confirmed',
        },
      ],
    },
  },
});

describe('VisionReviewPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiClient.get.mockResolvedValue(buildResponse());
    apiClient.post.mockResolvedValue({ data: { success: true } });
  });

  test('renders OCR summary and scope boundary with current data model', async () => {
    render(<VisionReviewPanel reportId={3670} versionId={3448} />);

    await screen.findByText('OCR / 视觉复核');

    expect(screen.getByText('不计入勾稽问题')).toBeInTheDocument();
    expect(screen.getByText('不计入数据质量风险')).toBeInTheDocument();
    expect(screen.getByText('待复核')).toBeInTheDocument();
    expect(screen.getAllByText('已确认修正').length).toBeGreaterThan(0);
    expect(screen.getAllByText('源表异常').length).toBeGreaterThan(0);
    expect(screen.getByText('表格解析风险')).toBeInTheDocument();
    expect(screen.getByText('source_anomaly')).toBeInTheDocument();
    expect(screen.getByText('确认采用修正值')).toBeInTheDocument();
  });

  test('confirms pending OCR corrections through existing resolve action', async () => {
    const user = userEvent.setup();
    render(<VisionReviewPanel reportId={4304} versionId={3964} />);

    await screen.findByText('确认采用修正值');
    await user.click(screen.getByText('确认采用修正值'));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith('/reports/4304/vision-review/corrections/resolve', {
        version_id: 3964,
        correction_ids: [11],
        action: 'confirm',
      });
    });
  });
});
