const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockPoolQuery = jest.fn();

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(async () => ({
      query: mockClientQuery,
      release: mockClientRelease,
    })),
    query: mockPoolQuery,
  },
}));

const mockMaterializeVersion = jest.fn();
jest.mock('../services/data-center/MaterializeService', () => ({
  materializeService: {
    materializeVersion: mockMaterializeVersion,
  },
}));

const mockRunAndPersist = jest.fn();
jest.mock('../services/ConsistencyCheckService', () => ({
  consistencyCheckService: {
    runAndPersist: mockRunAndPersist,
  },
}));

const mockEnqueueForConsistencyItems = jest.fn();
jest.mock('../services/VisionReviewService', () => ({
  visionReviewService: {
    enqueueForConsistencyItems: mockEnqueueForConsistencyItems,
  },
}));

import { ocrCorrectionService } from '../services/OcrCorrectionService';

describe('OcrCorrectionService', () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    mockPoolQuery.mockReset();
    mockMaterializeVersion.mockReset();
    mockRunAndPersist.mockReset();
    mockEnqueueForConsistencyItems.mockReset();
  });

  it('materializes, reruns consistency checks, and queues follow-up OCR after confirming corrections', async () => {
    const originalParsed = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            total: { results: { totalProcessed: 2 } },
          },
        },
      ],
    };

    mockClientQuery.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (String(sql).includes('FROM report_versions')) {
        return {
          rows: [{ id: 20, report_id: 10, parsed_json: originalParsed }],
        };
      }
      if (String(sql).includes('FROM ocr_corrections')) {
        return {
          rows: [
            {
              id: 30,
              report_id: 10,
              report_version_id: 20,
              field_path: 'tableData.total.results.totalProcessed',
              ocr_value: 3,
              status: 'pending',
            },
          ],
        };
      }
      return { rows: [] };
    });

    mockMaterializeVersion.mockResolvedValue({ success: true, factsCreated: 5, cellsCreated: 6 });
    mockRunAndPersist.mockResolvedValue({
      runId: 77,
      items: [
        { autoStatus: 'PASS' },
        { autoStatus: 'FAIL' },
        { autoStatus: 'UNCERTAIN' },
      ],
    });
    mockEnqueueForConsistencyItems.mockResolvedValue(1);
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          id: 30,
          report_id: 10,
          report_version_id: 20,
          review_id: 40,
          table_id: 'table_3',
          field_path: 'tableData.total.results.totalProcessed',
          parsed_value: '2',
          ocr_value: '3',
          status: 'confirmed',
        },
      ],
    });

    const result = await ocrCorrectionService.resolveCorrections(10, 20, [30], 'confirm', 1);

    expect(mockMaterializeVersion).toHaveBeenCalledWith(20);
    expect(mockRunAndPersist).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            tableData: expect.objectContaining({
              total: { results: { totalProcessed: 3 } },
            }),
          }),
        ],
      })
    );
    expect(mockEnqueueForConsistencyItems).toHaveBeenCalledWith(
      10,
      20,
      [{ autoStatus: 'PASS' }, { autoStatus: 'FAIL' }, { autoStatus: 'UNCERTAIN' }],
      true
    );
    expect(result.materialized).toBe(true);
    expect(result.checksRunId).toBe(77);
    expect(result.checksSummary).toEqual({ fail: 1, uncertain: 1, pass: 1, notAssessable: 0, total: 3 });
    expect(result.visionReviewsQueued).toBe(1);
  });
});
