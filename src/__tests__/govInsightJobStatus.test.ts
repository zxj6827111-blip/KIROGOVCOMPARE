import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import govInsightRouter from '../routes/gov-insight';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

jest.mock('../middleware/auth', () => ({
  optionalAuthMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 3,
      username: 'govinsight-user',
      permissions: { view_reports: true },
      dataScope: {},
    };
    next();
  },
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 3,
      username: 'govinsight-user',
      permissions: { view_reports: true, manage_jobs: true },
      dataScope: {},
    };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/GovInsightReportPayloadService', () => ({
  govInsightReportPayloadService: {
    build: jest.fn(),
    buildPrompt: jest.fn(),
  },
}));

jest.mock('../services/GovInsightLeaderCockpitService', () => ({
  govInsightLeaderCockpitService: {},
}));

const mockedQuery = pool.query as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/gov-insight', govInsightRouter);
  return app;
}

describe('GovInsight job status hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAllowedRegionIdsAsync as jest.Mock).mockResolvedValue(null);
  });

  it('returns a readable status for the latest failed AI report job', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 17,
        region_id: 721,
        org_id: 'city_721',
        org_name: '淮安市',
        year: 2025,
        status: 'failed',
        progress: 0,
        step_code: 'ERROR',
        step_name: 'Generation failed',
        model: 'test-model',
        error_code: 'REPORT_GENERATION_FAILED',
        error_message: 'overrides?.overallJudgments?.filter is not a function',
        retry_count: 0,
        max_retries: 0,
        created_at: '2026-05-21T00:00:00.000Z',
        started_at: '2026-05-21T00:00:01.000Z',
        finished_at: '2026-05-21T00:00:02.000Z',
      }],
    });

    const response = await request(buildApp())
      .get('/api/gov-insight/ai-report/jobs/latest?org_id=city_721&year=2025');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: 17,
      status: 'failed',
      isFailed: true,
      readableStatus: expect.stringContaining('报告生成失败'),
      errorMessage: 'overrides?.overallJudgments?.filter is not a function',
    });
  });
});
