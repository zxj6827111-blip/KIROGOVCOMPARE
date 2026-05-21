import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import dataCenterRouter from '../routes/data-center';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

let mockPermissions: Record<string, boolean> = { view_reports: true };

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 9,
      username: 'scoped-user',
      permissions: mockPermissions,
      dataScope: { regions: ['Scoped'] },
    };
    next();
  },
  requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
    if (req.user?.permissions?.[permission] === true) {
      next();
      return;
    }
    res.status(403).json({ error: '权限不足', required: permission });
  },
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn(),
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/report-factory/ReportFactoryService', () => ({
  __esModule: true,
  default: {
    generate: jest.fn().mockResolvedValue('# report'),
  },
}));

jest.mock('../services/DerivedMetricsService', () => ({
  __esModule: true,
  default: {
    run: jest.fn().mockResolvedValue({ unitUpserts: 0, regionUpserts: 0 }),
  },
}));

const mockedQuery = pool.query as jest.Mock;
const mockedGetAllowedRegionIds = getAllowedRegionIdsAsync as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', dataCenterRouter);
  return app;
}

describe('Data center permission hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = { view_reports: true };
    mockedGetAllowedRegionIds.mockResolvedValue([101]);
  });

  it('filters report list by the authenticated data scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get('/api/v2/reports');

    expect(response.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('r.region_id = ANY($1::int[])'),
      [[101]]
    );
  });

  it('blocks report detail access outside the authenticated data scope', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [{ region_id: 202 }] });

    const response = await request(buildApp()).get('/api/v2/reports/42/facts/active_disclosure');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: 'forbidden' });
  });

  it('requires manage_jobs before retrying a data center batch', async () => {
    const response = await request(buildApp()).post('/api/v2/batches/batch-1/retry');

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: 'manage_jobs' });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('does not expose batch metadata when no rows are visible in the authenticated data scope', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 77,
          batch_uuid: 'batch-hidden',
          created_by: 'admin',
          created_at: '2026-05-21T00:00:00.000Z',
          source: 'upload',
          note: 'hidden',
          report_count: 1,
          success_count: 1,
          fail_count: 0,
          status: 'completed',
          completed_at: '2026-05-21T00:01:00.000Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp()).get('/api/v2/batches/batch-hidden');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: 'Batch not found' });
  });

  it('scopes data center dashboard aggregates to allowed regions', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        report_count: 1,
        active_report_count: 1,
        materialize_succeeded: 1,
        quality_issue_count_total: 0,
        derived_risk_avg: 0,
      }],
    });

    const response = await request(buildApp()).get('/api/v2/dashboard/kpis');

    expect(response.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('region_id = ANY($1::int[])'),
      [[101]]
    );
  });
});
