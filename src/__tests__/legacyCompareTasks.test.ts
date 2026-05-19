import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import comparisonHistoryRouter from '../routes/comparison-history';
import llmComparisonsRouter from '../routes/llm-comparisons';
import retiredCompareTasksRouter from '../routes/retired-compare-tasks';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 1,
      username: 'route-smoke-user',
      dataScope: { regions: [] },
    };
    next();
  },
}));

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

const mockedQuery = pool.query as jest.Mock;

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

beforeEach(() => {
  mockedQuery.mockReset();
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
});
