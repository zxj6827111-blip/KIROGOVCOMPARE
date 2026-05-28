import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import consistencyRouter from '../routes/consistency';
import comparisonHistoryRouter from '../routes/comparison-history';
import pdfJobsRouter from '../routes/pdf-jobs';
import govInsightRouter from '../routes/gov-insight';

let mockPermissions: Record<string, boolean> = { view_reports: true };

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 77,
      username: 'security-hardening-user',
      permissions: mockPermissions,
      dataScope: {},
    };
    next();
  },
  requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
    if (req.user?.permissions?.[permission] === true) {
      next();
      return;
    }
    res.status(403).json({ error: 'permission_denied', required: permission });
  },
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

jest.mock('../services/ConsistencyCheckService', () => ({
  consistencyCheckService: {
    runAndPersist: jest.fn(),
  },
}));

jest.mock('../services/VisionReviewService', () => ({
  visionReviewService: {
    enqueueForConsistencyItems: jest.fn(),
    listReviews: jest.fn().mockResolvedValue([]),
    listCorrections: jest.fn().mockResolvedValue([]),
    normalizeTableIds: jest.fn().mockReturnValue([]),
    runNow: jest.fn(),
  },
}));

jest.mock('../services/OcrCorrectionService', () => ({
  ocrCorrectionService: {
    resolveCorrections: jest.fn(),
  },
}));

jest.mock('../services/PdfExportService', () => ({
  __esModule: true,
  default: {
    generateComparisonPdf: jest.fn(),
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
  app.use('/api', consistencyRouter);
  app.use('/api/comparisons', comparisonHistoryRouter);
  app.use('/api/pdf-jobs', pdfJobsRouter);
  app.use('/api/gov-insight', govInsightRouter);
  return app;
}

describe('security hardening route permissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = { view_reports: true };
  });

  it.each([
    ['post', '/api/reports/1/checks/run', 'upload_reports'],
    ['post', '/api/reports/1/vision-review/run', 'manage_jobs'],
    ['post', '/api/reports/1/vision-review/corrections/resolve', 'upload_reports'],
    ['post', '/api/reports/1/checks/items/bulk-status', 'upload_reports'],
    ['patch', '/api/reports/1/checks/items/1', 'upload_reports'],
    ['post', '/api/comparisons/create', 'upload_reports'],
    ['post', '/api/comparisons/1/alignment-rules', 'upload_reports'],
    ['delete', '/api/comparisons/1', 'delete_reports'],
    ['post', '/api/comparisons/1/export/pdf', 'manage_jobs'],
    ['post', '/api/comparisons/retry-jobs', 'manage_jobs'],
    ['post', '/api/pdf-jobs', 'manage_jobs'],
    ['delete', '/api/pdf-jobs/1', 'manage_jobs'],
    ['post', '/api/pdf-jobs/1/regenerate', 'manage_jobs'],
  ])('blocks %s %s without %s', async (method, path, required) => {
    const response = await (request(buildApp()) as any)[method](path).send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['post', '/api/gov-insight/ai-report/jobs', ['upload_reports', 'manage_jobs']],
    ['post', '/api/gov-insight/ai-report/save', ['upload_reports', 'manage_jobs']],
    ['get', '/api/gov-insight/leader-cockpit/model', ['system_admin', 'manage_users']],
    ['get', '/api/gov-insight/leader-cockpit/comparison', ['system_admin', 'manage_users']],
  ])('blocks %s %s without any of %p', async (method, path, required) => {
    const response = await (request(buildApp()) as any)[method](path).send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required });
    expect(mockedQuery).not.toHaveBeenCalled();
  });

  it('allows upload_reports users to create GovInsight AI report jobs without manage_jobs', async () => {
    mockPermissions = { view_reports: true, upload_reports: true };
    mockedQuery.mockResolvedValueOnce({ rows: [] });
    mockedQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp())
      .post('/api/gov-insight/ai-report/jobs')
      .send({ org_id: 'city_721', year: 2024 });

    expect(response.status).not.toBe(403);
    expect(mockedQuery).toHaveBeenCalled();
  });

  it.each([
    '/api/gov-insight/annual-data',
    '/api/gov-insight/years',
    '/api/gov-insight/orgs',
    '/api/gov-insight/annual-report-summary',
    '/api/gov-insight/ai-report',
    '/api/gov-insight/ai-report/jobs/latest',
    '/api/gov-insight/ai-report/jobs/1',
    '/api/gov-insight/ai-report/payload',
  ])('requires view_reports for GET %s', async (path) => {
    mockPermissions = {};

    const response = await request(buildApp()).get(path);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ required: 'view_reports' });
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
