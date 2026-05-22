import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import reportMaintenanceRouter from '../routes/report-maintenance';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 1,
      username: 'maintenance-admin',
      role: 'admin',
      permissions: { view_reports: true },
      dataScope: {},
    };
    next();
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

const mockedQuery = pool.query as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-maintenance', reportMaintenanceRouter);
  return app;
}

describe('Report maintenance route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('classifies accepted parse runs with empty display content as parse failed', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 101, name: '泌河镇', parent_id: null, level: 4, code: '101' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_id: 501,
          region_id: 101,
          year: 2025,
          unit_name: '泌河镇',
          report_created_at: '2026-05-22T02:33:11.000Z',
          report_updated_at: '2026-05-22T02:33:11.000Z',
          effective_version_id: 701,
          file_name: 'empty-report.pdf',
          file_size: 1024,
          version_created_at: '2026-05-22T02:33:11.000Z',
          version_updated_at: '2026-05-22T02:33:11.000Z',
          parsed_json: {
            sections: [
              { type: 'text', title: '一、总体情况', content: '' },
              {
                type: 'table_2',
                activeDisclosureData: {
                  regulations: { made: 0, repealed: 0, valid: 0 },
                },
              },
            ],
          },
          raw_text: '',
          version_review_status: 'published',
          version_state: 'published',
          approved_at: null,
          cached_check_total: null,
          cached_check_visual: null,
          cached_check_structure: null,
          cached_check_quality: null,
          cached_checks_updated_at: null,
          parse_run_id: 801,
          parse_run_status: 'accepted',
          parse_created_at: '2026-05-22T02:33:00.000Z',
          parse_started_at: '2026-05-22T02:33:00.000Z',
          parse_finished_at: '2026-05-22T02:33:11.000Z',
          parse_accepted_at: '2026-05-22T02:33:11.000Z',
          parse_error_code: null,
          parse_error_message: null,
          latest_job_id: 901,
          latest_job_kind: 'parse',
          latest_job_status: 'completed',
          latest_job_progress: 100,
          latest_job_error_code: null,
          latest_job_error_message: null,
          latest_job_updated_at: '2026-05-22T02:33:11.000Z',
          open_issue_count: null,
          pending_issue_count: null,
          confirmed_issue_count: null,
          dismissed_issue_count: null,
          table2_issue_count: null,
          table3_issue_count: null,
          table4_issue_count: null,
          structure_issue_count: null,
          visual_issue_count: null,
          quality_issue_count: null,
          text_issue_count: null,
          abnormal_types: [],
        }],
      });

    const response = await request(buildApp()).get('/api/report-maintenance?year=2025');

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      parse_success_count: 0,
      parse_failed_count: 1,
      empty_count: 1,
      text_empty_count: 1,
    });
    expect(response.body.data.regions[0]).toMatchObject({
      unit_name: '泌河镇',
      parse_status: 'failed',
      maintenance_status: 'parse_failed',
      review_status: 'pending_review',
    });
  });
});
