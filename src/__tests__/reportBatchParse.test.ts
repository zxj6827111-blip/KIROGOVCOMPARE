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

describe('Report batch check status route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAllowedRegionIds.mockResolvedValue(null);
  });

  it('keeps confirmed abnormal items out of pending totals and exposes them separately', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          report_id: 4763,
          version_id: 4477,
          review_status: 'published',
          has_content_db: true,
          check_total: 0,
          check_visual: 0,
          check_structure: 0,
          check_quality: 0,
          checks_updated_at: '2026-05-21T15:47:02.000Z',
          parsed_json: { sections: [] },
          section_title_active_issue_count: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_version_id: 4477,
          total: '0',
          consistency: '0',
          hierarchy_pending: '0',
          consistency_other: '0',
          visual: '0',
          quality: '0',
          quality_review: '0',
          structure: '0',
          confirmed_abnormal: '200',
          confirmed_consistency: '119',
          confirmed_hierarchy: '81',
          confirmed_hierarchy_delta: '81',
          confirmed_hierarchy_completeness: '0',
          reviewed_count: '203',
          dismissed_count: '3',
          hierarchy_delta: '0',
          hierarchy_completeness: '0',
        }],
      });

    const response = await request(buildApp())
      .post('/api/reports/batch-check-status')
      .send({ report_ids: [4763] });

    expect(response.status).toBe(200);
    expect(response.body['4763']).toMatchObject({
      checked: true,
      total: 0,
      consistency: 0,
      hierarchy_pending: 0,
      consistency_other: 0,
      structure: 0,
      confirmed_abnormal: 200,
      confirmed_consistency: 119,
      confirmed_hierarchy: 81,
      confirmed_hierarchy_delta: 81,
      confirmed_hierarchy_completeness: 0,
      reviewed_count: 203,
      dismissed_count: 3,
      hierarchy_delta: 0,
      hierarchy_completeness: 0,
    });
    expect(mockedQuery.mock.calls[1][0]).toContain("COALESCE(human_status, 'pending') = 'pending'");
    expect(mockedQuery.mock.calls[1][0]).toContain('consistency_other');
    expect(mockedQuery.mock.calls[1][0]).toContain('hierarchy_pending');
    expect(mockedQuery.mock.calls[1][0]).toContain('confirmed_abnormal');
    expect(mockedQuery.mock.calls[1][0]).toContain('confirmed_consistency');
    expect(mockedQuery.mock.calls[1][0]).toContain('confirmed_hierarchy');
    expect(mockedQuery.mock.calls[1][0]).toContain('confirmed_hierarchy_delta');
    expect(mockedQuery.mock.calls[1][0]).toContain('confirmed_hierarchy_completeness');
    expect(mockedQuery.mock.calls[1][0]).toContain('reviewed_count');
    expect(mockedQuery.mock.calls[1][0]).toContain('dismissed_count');
    expect(mockedQuery.mock.calls[1][0]).toContain('hierarchy_delta');
    expect(mockedQuery.mock.calls[1][0]).toContain('hierarchy_completeness');
  });

  it('keeps pending FAIL and UNCERTAIN in pending totals and exposes non-overlapping issue groups', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          report_id: 4762,
          version_id: 4451,
          review_status: 'published',
          has_content_db: true,
          check_total: 109,
          check_visual: 0,
          check_structure: 109,
          check_quality: 0,
          checks_updated_at: '2026-05-26T16:26:41.000Z',
          parsed_json: { sections: [] },
          section_title_active_issue_count: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_version_id: 4451,
          total: '90',
          consistency: '90',
          hierarchy_pending: '75',
          consistency_other: '15',
          visual: '0',
          quality: '0',
          quality_review: '0',
          structure: '90',
          confirmed_abnormal: '0',
          confirmed_consistency: '0',
          confirmed_hierarchy: '0',
          confirmed_hierarchy_delta: '0',
          confirmed_hierarchy_completeness: '0',
          reviewed_count: '0',
          dismissed_count: '0',
          hierarchy_delta: '75',
          hierarchy_completeness: '0',
        }],
      });

    const response = await request(buildApp())
      .post('/api/reports/batch-check-status')
      .send({ report_ids: [4762] });

    expect(response.status).toBe(200);
    expect(response.body['4762']).toMatchObject({
      checked: true,
      total: 90,
      consistency: 90,
      hierarchy_pending: 75,
      consistency_other: 15,
      structure: 90,
      confirmed_abnormal: 0,
      confirmed_consistency: 0,
      confirmed_hierarchy: 0,
      confirmed_hierarchy_delta: 0,
      hierarchy_delta: 75,
      hierarchy_completeness: 0,
    });
  });

  it('uses hierarchy delta as hierarchy issue count and keeps uncertain hierarchy in consistency bucket', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          report_id: 215,
          version_id: 210,
          review_status: 'published',
          has_content_db: true,
          check_total: 0,
          check_visual: 0,
          check_structure: 0,
          check_quality: 0,
          checks_updated_at: '2026-05-27T09:29:38.288Z',
          parsed_json: { sections: [] },
          section_title_active_issue_count: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_version_id: 210,
          total: '0',
          consistency: '0',
          hierarchy_pending: '0',
          consistency_other: '0',
          visual: '0',
          quality: '0',
          quality_review: '0',
          structure: '0',
          confirmed_abnormal: '90',
          confirmed_consistency: '15',
          confirmed_hierarchy: '75',
          confirmed_hierarchy_delta: '75',
          confirmed_hierarchy_completeness: '0',
          reviewed_count: '90',
          dismissed_count: '0',
          hierarchy_delta: '0',
          hierarchy_completeness: '0',
        }],
      });

    const response = await request(buildApp())
      .post('/api/reports/batch-check-status')
      .send({ report_ids: [215] });

    expect(response.status).toBe(200);
    expect(response.body['215']).toMatchObject({
      checked: true,
      total: 0,
      confirmed_abnormal: 90,
      confirmed_consistency: 15,
      confirmed_hierarchy: 75,
      confirmed_hierarchy_delta: 75,
      confirmed_hierarchy_completeness: 0,
      reviewed_count: 90,
      dismissed_count: 0,
    });
    expect(mockedQuery.mock.calls[1][0]).toContain('ABS(COALESCE(delta, 0)) > COALESCE(tolerance, 0)');
    expect(mockedQuery.mock.calls[1][0]).toContain("group_key IN ('table2','table3','table4','text','hierarchy')");
    expect(mockedQuery.mock.calls[1][0]).toContain('hierarchy_missing_report_units');
    expect(mockedQuery.mock.calls[1][0]).toContain('jsonb_array_length');
  });

  it('exposes hierarchy completeness separately from hierarchy delta and consistency', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{
          report_id: 217,
          version_id: 3756,
          review_status: 'published',
          has_content_db: true,
          check_total: 2,
          check_visual: 0,
          check_structure: 1,
          check_quality: 1,
          checks_updated_at: '2026-05-27T11:11:12.408Z',
          parsed_json: { sections: [] },
          section_title_active_issue_count: 0,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_version_id: 3756,
          total: '2',
          consistency: '1',
          hierarchy_pending: '1',
          hierarchy_completeness: '1',
          hierarchy_missing_report: '1',
          hierarchy_missing_report_units: '56',
          hierarchy_missing_field: '0',
          hierarchy_missing_field_units: '0',
          consistency_other: '0',
          visual: '0',
          quality: '1',
          quality_review: '1',
          structure: '1',
          confirmed_abnormal: '0',
          confirmed_consistency: '0',
          confirmed_hierarchy: '0',
          confirmed_hierarchy_delta: '0',
          confirmed_hierarchy_completeness: '0',
          confirmed_hierarchy_missing_report: '0',
          confirmed_hierarchy_missing_report_units: '0',
          confirmed_hierarchy_missing_field: '0',
          confirmed_hierarchy_missing_field_units: '0',
          reviewed_count: '0',
          dismissed_count: '0',
          hierarchy_delta: '0',
        }],
      });

    const response = await request(buildApp())
      .post('/api/reports/batch-check-status')
      .send({ report_ids: [217] });

    expect(response.status).toBe(200);
    expect(response.body['217']).toMatchObject({
      checked: true,
      total: 2,
      consistency: 1,
      consistency_other: 0,
      hierarchy_pending: 1,
      hierarchy_delta: 0,
      hierarchy_completeness: 1,
      hierarchy_missing_report: 1,
      hierarchy_missing_report_units: 56,
      hierarchy_missing_field: 0,
      hierarchy_missing_field_units: 0,
      quality_review: 1,
    });
  });
});
