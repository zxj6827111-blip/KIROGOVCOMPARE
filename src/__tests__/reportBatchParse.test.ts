import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import reportsRouter from '../routes/reports';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { checkStoragePathExists } from '../services/SourceFileGuardService';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 11,
      username: 'batch-parse-user',
      permissions: { upload_reports: true },
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
    connect: jest.fn(),
  },
}));

jest.mock('../services/SourceFileGuardService', () => ({
  checkStoragePathExists: jest.fn(),
}));

jest.mock('../services/ReportUploadService', () => ({
  reportUploadService: {},
}));

jest.mock('../services/ConsistencyCheckService', () => ({
  consistencyCheckService: {
    runAndPersist: jest.fn(),
  },
}));

jest.mock('../services/data-center/MaterializeService', () => ({
  materializeService: {
    materializeVersion: jest.fn(),
  },
}));

jest.mock('../services/GovInsightStatsService', () => ({
  govInsightStatsService: {
    refreshAnnualStats: jest.fn(),
  },
}));

jest.mock('../services/LlmJobRunner', () => ({
  llmJobRunner: {
    triggerAutoComparisonForPublishedVersion: jest.fn(),
  },
}));

jest.mock('../services/ParseRunService', () => ({
  parseRunService: {
    getCurrentParsedResult: jest.fn(),
    getHistory: jest.fn(),
  },
}));

jest.mock('../services/PdfParseService', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../services/HtmlParseService', () => ({
  __esModule: true,
  default: {},
}));

const mockedQuery = pool.query as jest.Mock;
const mockedGetAllowedRegionIds = getAllowedRegionIdsAsync as jest.Mock;
const mockedCheckStoragePathExists = checkStoragePathExists as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', reportsRouter);
  return app;
}

function queueSuccessfulSubmit(reportId: number, versionId: number, jobId: number) {
  mockedQuery
    .mockResolvedValueOnce({ rows: [{ id: reportId, region_id: 101, active_version_id: versionId }] })
    .mockResolvedValueOnce({ rows: [{ id: versionId }] })
    .mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        model: 'gpt-test',
        ingestion_batch_id: 501,
        parsed_json: {},
        storage_path: `uploads/${reportId}.pdf`,
      }],
    })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: jobId }] });
}

function queueReusedSubmit(reportId: number, versionId: number, jobId: number) {
  mockedQuery
    .mockResolvedValueOnce({ rows: [{ id: reportId, region_id: 101, active_version_id: versionId }] })
    .mockResolvedValueOnce({ rows: [{ id: versionId }] })
    .mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        model: 'gpt-test',
        ingestion_batch_id: 502,
        parsed_json: {},
        storage_path: `uploads/${reportId}.pdf`,
      }],
    })
    .mockResolvedValueOnce({ rows: [{ id: jobId, status: 'running' }] });
}

function queueMissingSourceSubmit(reportId: number, versionId: number) {
  mockedQuery
    .mockResolvedValueOnce({ rows: [{ id: reportId, region_id: 101, active_version_id: versionId }] })
    .mockResolvedValueOnce({ rows: [{ id: versionId }] })
    .mockResolvedValueOnce({
      rows: [{
        provider: 'openai',
        model: 'gpt-test',
        ingestion_batch_id: 503,
        parsed_json: {},
        storage_path: `uploads/${reportId}.pdf`,
      }],
    })
    .mockResolvedValueOnce({ rows: [] });
}

describe('Report batch parse route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAllowedRegionIds.mockResolvedValue([101]);
    mockedCheckStoragePathExists.mockReturnValue({
      ok: true,
      storagePath: 'uploads/source.pdf',
      resolvedPath: 'E:/tmp/source.pdf',
    });
  });

  it('submits parse jobs, reuses active jobs, and reports per-row failures', async () => {
    queueSuccessfulSubmit(41, 4101, 9001);
    queueReusedSubmit(42, 4201, 9002);
    queueMissingSourceSubmit(43, 4301);
    mockedCheckStoragePathExists
      .mockReturnValueOnce({ ok: true, storagePath: 'uploads/41.pdf', resolvedPath: 'E:/tmp/41.pdf' })
      .mockReturnValueOnce({ ok: true, storagePath: 'uploads/42.pdf', resolvedPath: 'E:/tmp/42.pdf' })
      .mockReturnValueOnce({
        ok: false,
        storagePath: 'uploads/43.pdf',
        resolvedPath: 'E:/tmp/43.pdf',
        errorCode: 'SOURCE_FILE_MISSING',
        errorMessage: 'source file missing: E:/tmp/43.pdf',
      });

    const response = await request(buildApp())
      .post('/api/reports/batch-parse')
      .send({ report_ids: [41, 42, 43, 41], force: true });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requested: 3,
      submitted: 1,
      reused: 1,
      failed: 1,
    });
    expect(response.body.results).toEqual([
      expect.objectContaining({ report_id: 41, version_id: 4101, job_id: 9001, status: 'queued', reused: false }),
      expect.objectContaining({ report_id: 42, version_id: 4201, job_id: 9002, status: 'running', reused: true }),
      expect.objectContaining({ report_id: 43, status: 'failed', error: 'SOURCE_FILE_MISSING' }),
    ]);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      [41, 4101, 'openai', 'gpt-test', 501]
    );
  });

  it('rejects an empty report list before touching data scope or database', async () => {
    const response = await request(buildApp())
      .post('/api/reports/batch-parse')
      .send({ report_ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'report_ids is required' });
    expect(mockedGetAllowedRegionIds).not.toHaveBeenCalled();
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
