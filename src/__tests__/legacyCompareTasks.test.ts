import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import pool from '../config/database-llm';
import comparisonHistoryRouter from '../routes/comparison-history';
import llmComparisonsRouter from '../routes/llm-comparisons';
import retiredCompareTasksRouter from '../routes/retired-compare-tasks';
import pdfExportService from '../services/PdfExportService';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 1,
      username: 'route-smoke-user',
      permissions: {
        view_reports: true,
        upload_reports: true,
        manage_jobs: true,
        delete_reports: true,
      },
      dataScope: { regions: [] },
    };
    next();
  },
  requirePermission: (permission: string) => (req: any, res: any, next: () => void) => {
    if (!req.user?.permissions?.[permission]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  },
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock('../services/PdfExportService', () => ({
  __esModule: true,
  default: {
    generateComparisonPdf: jest.fn(),
  },
}));

const mockedQuery = pool.query as jest.Mock;
const mockedGenerateComparisonPdf = pdfExportService.generateComparisonPdf as jest.Mock;
const LEGACY_TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function buildLegacyApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/tasks/compare', retiredCompareTasksRouter);
  return app;
}

function buildCompareApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/comparisons', comparisonHistoryRouter);
  app.use('/api', llmComparisonsRouter);
  app.use('/api/v1/tasks/compare', retiredCompareTasksRouter);
  return app;
}

function mockMainCompareQueries() {
  mockedQuery.mockImplementation(async (sql: unknown) => {
    const text = String(sql);

    if (text.includes('COUNT(*) as total') && text.includes('FROM comparisons c')) {
      return { rows: [{ total: '1' }] };
    }

    if (text.includes('FROM comparisons c') && text.includes('ORDER BY c.created_at DESC')) {
      return {
        rows: [{
          id: 1,
          region_id: 10,
          region_name: 'Test Region',
          year_a: 2023,
          year_b: 2024,
          left_report_id: 101,
          right_report_id: 102,
          similarity: 98.5,
          check_status: 'completed',
          created_at: new Date('2026-01-01T00:00:00Z'),
        }],
      };
    }

    if (text.includes('FROM comparisons c') && text.includes('ORDER BY c.id DESC')) {
      return {
        rows: [{
          id: 1,
          region_id: 10,
          year_a: 2023,
          year_b: 2024,
          left_report_id: 101,
          right_report_id: 102,
          similarity: 98.5,
          check_status: 'completed',
        }],
      };
    }

    if (text.includes('FROM comparisons') && text.includes('WHERE id = $1')) {
      return {
        rows: [{
          id: 1,
          region_id: 10,
          year_a: 2023,
          year_b: 2024,
          left_report_id: 101,
          right_report_id: 102,
          similarity: 98.5,
          check_status: 'completed',
        }],
      };
    }

    if (text.includes('FROM comparison_results')) {
      return { rows: [{ diff_json: { sections: [] } }] };
    }

    if (text.includes('FROM jobs') && text.includes('WHERE comparison_id = $1')) {
      return {
        rows: [{
          id: 9001,
          status: 'succeeded',
          progress: 100,
          error_code: null,
          error_message: null,
        }],
      };
    }

    return { rows: [] };
  });
}

function createLegacyTempPdf(): string {
  const tempPdfPath = path.join(
    os.tmpdir(),
    `legacy-ejs-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`
  );
  fs.writeFileSync(tempPdfPath, Buffer.from('%PDF-1.4\n% legacy route test\n'));
  return tempPdfPath;
}

// content must pass hasParsedContent (meaningful text length / table payload), or export returns 409.
function mockLegacyEjsExportQueries(
  sections: any[] = [
    {
      title: 'Overview',
      type: 'text',
      content: 'Legacy comparison export content for smoke testing readiness.',
    },
  ]
) {
  mockedQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);

    if (text.includes('FROM comparisons c') && text.includes('LEFT JOIN regions r ON c.region_id = r.id')) {
      return {
        rows: [{
          id: 1,
          region_id: 10,
          year_a: 2023,
          year_b: 2024,
          left_report_id: 101,
          right_report_id: 102,
          region_name: 'Test Region',
        }],
      };
    }

    if (text.includes('FROM comparison_results')) {
      return { rows: [{ diff_json: { summary: { overallRepetition: 0 }, sections: [] } }] };
    }

    if (text.includes('FROM reports r') && text.includes('LEFT JOIN report_versions rv')) {
      const reportId = Array.isArray(params) ? Number(params[0]) : 0;
      return {
        rows: [{
          report_id: reportId,
          region_id: 10,
          year: reportId === 101 ? 2023 : 2024,
          active_version_id: reportId + 1000,
          version_id: reportId + 1000,
          parsed_json: { sections },
        }],
      };
    }

    if (text.includes('INSERT INTO comparison_exports')) {
      return { rows: [] };
    }

    return { rows: [] };
  });
}

beforeEach(() => {
  mockedQuery.mockReset();
  mockedGenerateComparisonPdf.mockReset();
});

describe('Legacy compare task routes', () => {
  it('returns 410 for retired task compare endpoints', async () => {
    const app = buildLegacyApp();

    const response = await request(app)
      .post('/api/v1/tasks/compare/upload')
      .send({});

    expect(response.status).toBe(410);
    expect(response.body).toMatchObject({
      error: 'legacy_compare_tasks_retired',
      replacement: '/api/comparisons',
    });
  });

  it('keeps main compare routes available while legacy task routes are retired', async () => {
    mockMainCompareQueries();
    const app = buildCompareApp();

    const historyResponse = await request(app).get('/api/comparisons/history');
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body.data[0]).toMatchObject({
      id: 1,
      regionId: 10,
      leftReportId: 101,
      rightReportId: 102,
    });

    const listResponse = await request(app).get('/api/comparisons');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data[0]).toMatchObject({
      id: 1,
      latest_job: {
        job_id: 9001,
        status: 'succeeded',
      },
    });

    const detailResponse = await request(app).get('/api/comparisons/1');
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body).toMatchObject({
      id: 1,
      diff_json: { sections: [] },
    });

    const retiredResponse = await request(app)
      .post('/api/v1/tasks/compare/url')
      .send({ urlA: 'https://example.com/a.pdf', urlB: 'https://example.com/b.pdf' });

    expect(retiredResponse.status).toBe(410);
    expect(retiredResponse.body).toMatchObject({
      error: 'legacy_compare_tasks_retired',
      replacement: '/api/comparisons',
    });
  });

  it('requeues stale existing comparisons from batch create instead of reporting no new tasks', async () => {
    const app = buildCompareApp();

    mockedQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);

      if (text.includes('WITH consecutive_reports') && text.includes('LEFT JOIN LATERAL')) {
        return {
          rows: [{
            region_id: 10,
            year_a: 2024,
            year_b: 2025,
            left_report_id: 101,
            left_version_id: 1001,
            right_report_id: 102,
            right_version_id: 1002,
            existing_comparison_id: 501,
            result_created_at: new Date('2026-01-01T00:00:00Z'),
            source_updated_at: new Date('2026-01-02T00:00:00Z'),
          }],
        };
      }

      if (text.includes('UPDATE comparisons') && text.includes("check_status = 'pending'")) {
        return { rows: [{ id: 501 }] };
      }

      if (text.includes('FROM jobs') && text.includes("kind = 'compare'") && text.includes("status IN ('queued', 'running')")) {
        return { rows: [] };
      }

      if (text.includes('INSERT INTO jobs') && text.includes("kind, status, progress, step_code, step_name, comparison_id")) {
        return { rows: [{ id: 9002 }] };
      }

      return { rows: [] };
    });

    const response = await request(app)
      .post('/api/comparisons/batch-create')
      .send({ refresh_existing: 'stale' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      created_count: 0,
      requeued_count: 1,
      skipped_count: 0,
      refresh_mode: 'stale',
    });
    expect(response.body.message).toContain('刷新 1 个');
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE comparisons'),
      [501, 101, 102]
    );
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      [101, 1001, 501]
    );
  });

  it('keeps confirmed consistency issues in created comparison status', async () => {
    const app = buildCompareApp();

    mockedQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
      const text = String(sql);

      if (text.includes('FROM reports r') && text.includes('LEFT JOIN report_versions rv')) {
        const reportId = Array.isArray(params) ? Number(params[0]) : 0;
        return {
          rows: [{
            report_id: reportId,
            region_id: 10,
            year: reportId === 101 ? 2024 : 2025,
            active_version_id: reportId === 101 ? 1001 : 1002,
            version_id: reportId === 101 ? 1001 : 1002,
            parsed_json: {
              sections: [
                {
                  type: 'table_2',
                  activeDisclosureData: {
                    regulations: { valid: 1, made: 0, repealed: 0 },
                    normativeDocuments: { valid: 1, made: 0, repealed: 0 },
                  },
                },
              ],
            },
          }],
        };
      }

      if (text.includes('FROM report_consistency_items') && text.includes("COALESCE(human_status, 'pending') != 'dismissed'")) {
        return { rows: [{ count: Array.isArray(params) && Number(params[0]) === 1002 ? '1' : '0' }] };
      }

      if (text.includes('INSERT INTO comparisons') && text.includes('RETURNING id')) {
        return { rows: [{ id: 777 }] };
      }

      if (text.includes('FROM jobs') && text.includes("kind = 'compare'") && text.includes("status IN ('queued', 'running')")) {
        return { rows: [] };
      }

      if (text.includes('INSERT INTO jobs') && text.includes("kind, status, progress, step_code, step_name, comparison_id")) {
        return { rows: [{ id: 9003 }] };
      }

      return { rows: [] };
    });

    const response = await request(app)
      .post('/api/comparisons/create')
      .send({
        region_id: 10,
        year_a: 2024,
        year_b: 2025,
        left_report_id: 101,
        right_report_id: 102,
      });

    expect(response.status).toBe(200);
    const insertCall = mockedQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO comparisons'));
    expect(insertCall?.[1]?.[6]).toBe('异常(2025年校验1项)');
  });

  it('keeps legacy EJS PDF export compatible and reuses a valid request trace id', async () => {
    const app = buildCompareApp();
    const traceId = 'REQ-123.alpha_1:ok';
    const tempPdfPath = createLegacyTempPdf();

    mockedGenerateComparisonPdf.mockResolvedValue(tempPdfPath);
    mockLegacyEjsExportQueries();

    try {
      const response = await request(app)
        .post('/api/comparisons/1/export/pdf')
        .set('X-Request-Id', traceId)
        .send({ watermark_text: 'legacy-check' });

      expect(response.status).toBe(200);
      expect(response.headers.deprecation).toBe('true');
      expect(response.headers['x-kiro-deprecated-route']).toBe('POST /api/comparisons/:id/export/pdf');
      expect(response.headers['x-kiro-replacement-route']).toBe('/api/pdf-jobs');
      expect(response.headers['x-kiro-legacy-export-path']).toBe('comparison-ejs');
      expect(response.headers['x-kiro-legacy-export-trace']).toBe(traceId);
      expect(response.headers.link).toBe('</api/pdf-jobs>; rel="successor-version"');
      expect(String(response.headers['access-control-expose-headers'] || '')).toContain('X-Kiro-Legacy-Export-Trace');
      expect(mockedGenerateComparisonPdf).toHaveBeenCalledWith(expect.objectContaining({
        comparisonId: 1,
        traceId: response.headers['x-kiro-legacy-export-trace'],
      }));
    } finally {
      fs.unlinkSync(tempPdfPath);
    }
  });

  it('falls back to a generated trace id for invalid or overlong legacy request ids', async () => {
    const app = buildCompareApp();
    const tempPdfPath = createLegacyTempPdf();
    const unsafeRequestIds = ['bad trace/with/slash', 'a'.repeat(81)];

    mockedGenerateComparisonPdf.mockResolvedValue(tempPdfPath);
    mockLegacyEjsExportQueries();

    try {
      for (const unsafeRequestId of unsafeRequestIds) {
        mockedGenerateComparisonPdf.mockClear();

        const response = await request(app)
          .post('/api/comparisons/1/export/pdf')
          .set('X-Request-Id', unsafeRequestId)
          .send({ watermark_text: 'legacy-check' });
        const responseTraceId = response.headers['x-kiro-legacy-export-trace'];

        expect(response.status).toBe(200);
        expect(response.headers.deprecation).toBe('true');
        expect(response.headers['x-kiro-deprecated-route']).toBe('POST /api/comparisons/:id/export/pdf');
        expect(response.headers['x-kiro-replacement-route']).toBe('/api/pdf-jobs');
        expect(responseTraceId).toMatch(LEGACY_TRACE_ID_PATTERN);
        expect(responseTraceId).not.toBe(unsafeRequestId);
        expect(mockedGenerateComparisonPdf).toHaveBeenCalledWith(expect.objectContaining({
          comparisonId: 1,
          traceId: responseTraceId,
        }));
      }
    } finally {
      fs.unlinkSync(tempPdfPath);
    }
  });
});
