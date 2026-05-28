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
  requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
    if (req.user?.permissions?.[permission] === true) {
      next();
      return;
    }
    res.status(403).json({ error: 'permission_denied', required: permission });
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

  it('keeps confirmed issues abnormal without marking the report as pending review', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 102, name: 'test-unit', parent_id: null, level: 4, code: '102' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_id: 502,
          region_id: 102,
          year: 2025,
          unit_name: 'test-unit',
          report_created_at: '2026-05-22T02:33:11.000Z',
          report_updated_at: '2026-05-22T02:33:11.000Z',
          effective_version_id: 702,
          file_name: 'confirmed-issues.pdf',
          file_size: 2048,
          version_created_at: '2026-05-22T02:33:11.000Z',
          version_updated_at: '2026-05-22T02:33:11.000Z',
          parsed_json: {
            sections: [
              { type: 'text', title: 'section', content: 'content ready' },
              { type: 'table_2', activeDisclosureData: { regulations: { made: 1, repealed: 0, valid: 1 } } },
            ],
          },
          raw_text: 'content ready '.repeat(20),
          version_review_status: 'published',
          version_state: 'published',
          approved_at: '2026-05-22T03:00:00.000Z',
          cached_check_total: 1,
          cached_check_visual: 0,
          cached_check_structure: 1,
          cached_check_quality: 0,
          cached_checks_updated_at: '2026-05-22T02:40:00.000Z',
          parse_run_id: 802,
          parse_run_status: 'accepted',
          parse_created_at: '2026-05-22T02:33:00.000Z',
          parse_started_at: '2026-05-22T02:33:00.000Z',
          parse_finished_at: '2026-05-22T02:33:11.000Z',
          parse_accepted_at: '2026-05-22T02:33:11.000Z',
          parse_error_code: null,
          parse_error_message: null,
          latest_job_id: 902,
          latest_job_kind: 'checks',
          latest_job_status: 'succeeded',
          latest_job_progress: 100,
          latest_job_error_code: null,
          latest_job_error_message: null,
          latest_job_updated_at: '2026-05-22T02:40:00.000Z',
          open_issue_count: 1,
          pending_issue_count: 0,
          confirmed_issue_count: 1,
          dismissed_issue_count: 0,
          table2_issue_count: 1,
          table3_issue_count: 0,
          table4_issue_count: 0,
          structure_issue_count: 1,
          visual_issue_count: 0,
          quality_issue_count: 0,
          text_issue_count: 0,
          abnormal_types: ['table2'],
        }],
      });

    const response = await request(buildApp()).get('/api/report-maintenance?year=2025');

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      compare_abnormal_count: 1,
      pending_review_count: 0,
      archived_count: 1,
    });
    expect(response.body.data.regions[0]).toMatchObject({
      compare_status: 'abnormal',
      review_status: 'archived',
      archive_status: 'archived',
      maintenance_status: 'completed',
      abnormal_count: 1,
    });
  });

  it('treats compatible passed review status as completed in the summary', async () => {
    mockedQuery
      .mockResolvedValueOnce({
        rows: [{ id: 103, name: 'passed-unit', parent_id: null, level: 4, code: '103' }],
      })
      .mockResolvedValueOnce({
        rows: [{
          report_id: 503,
          region_id: 103,
          year: 2025,
          unit_name: 'passed-unit',
          report_created_at: '2026-05-22T02:33:11.000Z',
          report_updated_at: '2026-05-22T02:33:11.000Z',
          effective_version_id: 703,
          file_name: 'passed-review.pdf',
          file_size: 2048,
          version_created_at: '2026-05-22T02:33:11.000Z',
          version_updated_at: '2026-05-22T02:33:11.000Z',
          parsed_json: {
            sections: [
              { type: 'text', title: 'section', content: 'content ready' },
              { type: 'table_2', activeDisclosureData: { regulations: { made: 1, repealed: 0, valid: 1 } } },
            ],
          },
          raw_text: 'content ready '.repeat(20),
          version_review_status: 'passed',
          version_state: 'passed',
          approved_at: '2026-05-22T03:00:00.000Z',
          cached_check_total: 0,
          cached_check_visual: 0,
          cached_check_structure: 0,
          cached_check_quality: 0,
          cached_checks_updated_at: '2026-05-22T02:40:00.000Z',
          parse_run_id: 803,
          parse_run_status: 'accepted',
          parse_created_at: '2026-05-22T02:33:00.000Z',
          parse_started_at: '2026-05-22T02:33:00.000Z',
          parse_finished_at: '2026-05-22T02:33:11.000Z',
          parse_accepted_at: '2026-05-22T02:33:11.000Z',
          parse_error_code: null,
          parse_error_message: null,
          latest_job_id: 903,
          latest_job_kind: 'checks',
          latest_job_status: 'succeeded',
          latest_job_progress: 100,
          latest_job_error_code: null,
          latest_job_error_message: null,
          latest_job_updated_at: '2026-05-22T02:40:00.000Z',
          open_issue_count: 0,
          pending_issue_count: 0,
          confirmed_issue_count: 0,
          dismissed_issue_count: 0,
          table2_issue_count: 0,
          table3_issue_count: 0,
          table4_issue_count: 0,
          structure_issue_count: 0,
          visual_issue_count: 0,
          quality_issue_count: 0,
          text_issue_count: 0,
          abnormal_types: [],
        }],
      });

    const response = await request(buildApp()).get('/api/report-maintenance?year=2025');

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toMatchObject({
      pending_review_count: 0,
      archived_count: 1,
    });
    expect(response.body.data.regions[0]).toMatchObject({
      review_status: 'passed',
      archive_status: 'archived',
      maintenance_status: 'completed',
    });
  });
});
