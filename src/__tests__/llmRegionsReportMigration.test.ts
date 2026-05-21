import express from 'express';
import request from 'supertest';
import llmRegionsRouter from '../routes/llm-regions';

const mockQuery = jest.fn();
const mockClientQuery = jest.fn();
const mockRelease = jest.fn();
const mockConnect = jest.fn(() => ({
  query: mockClientQuery,
  release: mockRelease,
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: (...args: any[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/regions', llmRegionsRouter);
  return app;
}

function reportRow(id: number, year: number, unitName: string, activeVersionId: number, uploadTime: string) {
  return {
    id,
    year,
    unit_name: unitName,
    active_version_id: activeVersionId,
    created_at: uploadTime,
    upload_time: uploadTime,
  };
}

function queuePreviewQueries(options: {
  source2024Time?: string;
  target2024Time?: string;
} = {}) {
  const source2024Time = options.source2024Time || '2026-01-04T00:00:00.000Z';
  const target2024Time = options.target2024Time || '2026-01-05T00:00:00.000Z';

  mockQuery
    .mockResolvedValueOnce({
      rows: [
        { id: 1120, name: '苏州宿迁工业园区', parent_id: 783, level: 4 },
        { id: 783, name: '苏州宿迁工业园区', parent_id: 720, level: 3 },
      ],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({
      rows: [
        reportRow(3787, 2021, '园区 2021', 3565, '2026-01-01T00:00:00.000Z'),
        reportRow(3788, 2022, '园区 2022', 3566, '2026-01-02T00:00:00.000Z'),
        reportRow(3789, 2023, '园区 2023', 3567, '2026-01-03T00:00:00.000Z'),
        reportRow(3786, 2024, '园区 2024', 3564, source2024Time),
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        reportRow(138, 2024, '上级已有 2024', 137, target2024Time),
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        { id: 3543, region_id: 1120, year_a: 2021, year_b: 2022, left_report_id: 3787, right_report_id: 3788, created_at: '2026-01-01' },
        { id: 3545, region_id: 1120, year_a: 2022, year_b: 2023, left_report_id: 3788, right_report_id: 3789, created_at: '2026-01-01' },
        { id: 3546, region_id: 1120, year_a: 2023, year_b: 2024, left_report_id: 3789, right_report_id: 3786, created_at: '2026-01-01' },
      ],
    })
    .mockResolvedValueOnce({ rows: [] });
}

describe('llm regions report migration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockConnect.mockClear();
    mockRelease.mockClear();
  });

  it('previews conflicts and keeps the newer target report by upload time', async () => {
    queuePreviewQueries();

    const response = await request(createApp())
      .post('/api/regions/report-migration/preview')
      .send({ source_region_id: 1120, target_region_id: 783 });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      source_report_count: 4,
      movable_report_count: 3,
      conflict_report_count: 1,
      target_wins_count: 1,
      deleted_report_count: 1,
      movable_comparison_count: 2,
      blocked_comparison_count: 1,
    });
    expect(response.body.data.movable_reports.map((report: any) => report.year)).toEqual([2021, 2022, 2023]);
    expect(response.body.data.target_conflicts[0].source_report.year).toBe(2024);
    expect(response.body.data.target_conflicts[0].resolution).toBe('keep_target');
    expect(response.body.data.source_reports_to_delete.map((report: any) => report.id)).toEqual([3786]);
  });

  it('executes moves and deletes source reports when target conflict is newer', async () => {
    queuePreviewQueries();
    queuePreviewQueries();
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
      if (sql.includes('SELECT id, region_id, year, unit_name')) {
        return Promise.resolve({
          rows: [{ id: 3786, region_id: 1120, year: 2024, unit_name: '园区 2024' }],
        });
      }
      if (sql.includes('SELECT id') && sql.includes('FROM report_versions')) {
        return Promise.resolve({ rows: [{ id: 3564 }] });
      }
      if (sql.includes('UPDATE reports')) {
        return Promise.resolve({
          rows: [
            { id: 3787, year: 2021, unit_name: '园区 2021' },
            { id: 3788, year: 2022, unit_name: '园区 2022' },
            { id: 3789, year: 2023, unit_name: '园区 2023' },
          ],
        });
      }
      if (sql.includes('UPDATE comparisons')) {
        return Promise.resolve({
          rows: [
            { id: 3543, year_a: 2021, year_b: 2022 },
            { id: 3545, year_a: 2022, year_b: 2023 },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await request(createApp())
      .post('/api/regions/report-migration/execute')
      .send({ source_region_id: 1120, target_region_id: 783 });

    expect(response.status).toBe(200);
    expect(response.body.moved_reports.map((report: any) => report.year)).toEqual([2021, 2022, 2023]);
    expect(response.body.moved_comparisons.map((comparison: any) => comparison.id)).toEqual([3543, 3545]);
    expect(response.body.deleted_reports.map((report: any) => report.id)).toEqual([3786]);
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reports'),
      [[3786]]
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE comparisons'),
      [783, 1120, [3543, 3545]]
    );
  });

  it('previews source replacement when source conflict is newer', async () => {
    queuePreviewQueries({
      source2024Time: '2026-01-06T00:00:00.000Z',
      target2024Time: '2026-01-05T00:00:00.000Z',
    });

    const response = await request(createApp())
      .post('/api/regions/report-migration/preview')
      .send({ source_region_id: 1120, target_region_id: 783 });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      movable_report_count: 4,
      source_wins_count: 1,
      deleted_report_count: 1,
    });
    expect(response.body.data.target_conflicts[0].resolution).toBe('keep_source');
    expect(response.body.data.target_reports_to_delete.map((report: any) => report.id)).toEqual([138]);
    expect(response.body.data.movable_reports.find((report: any) => report.id === 3786).migration_action).toBe('replace_target');
  });
});
