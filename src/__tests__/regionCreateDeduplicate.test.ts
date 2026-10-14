import express from 'express';
import request from 'supertest';
import llmRegionsRouter from '../routes/llm-regions';

const mockQuery = jest.fn();

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: (...args: any[]) => mockQuery(...args),
    connect: jest.fn(),
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

const regionRow = {
  id: 3002,
  code: 'manual_1',
  name: '伊金霍洛旗林业和草原局',
  province: null,
  parent_id: 2747,
  level: 3,
  sort_order: 2113,
  is_department: true,
};

/** Answer by SQL shape so the test asserts on which statements actually ran. */
function routeQueries(existingRows: any[] = [], parentLevel = 2) {
  mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
    const text = String(sql).replace(/\s+/g, ' ');
    if (text.includes('SELECT level FROM regions WHERE id')) {
      return { rows: [{ level: parentLevel }] };
    }
    if (text.includes('FROM regions') && text.includes('IS NOT DISTINCT FROM')) {
      return { rows: existingRows };
    }
    if (text.includes('MAX(sort_order)')) {
      return { rows: [{ max_order: 10 }] };
    }
    if (text.startsWith('INSERT INTO regions')) {
      return { rows: [{ ...regionRow, id: 3003, name: params[1], parent_id: params[3] }] };
    }
    return { rows: [] };
  });
}

describe('POST /api/regions duplicate guard', () => {
  beforeEach(() => mockQuery.mockReset());

  it('returns the existing node instead of inserting a same-name sibling', async () => {
    routeQueries([{ ...regionRow }]);

    const res = await request(createApp()).post('/api/regions').send({
      code: 'manual_2',
      name: '伊金霍洛旗林业和草原局',
      parent_id: 2747,
      is_department: true,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 3002, deduplicated: true, is_department: true });
    expect(mockQuery.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO regions'))).toHaveLength(0);
  });

  it('creates the row when the same name sits under a different parent', async () => {
    routeQueries([]);

    const res = await request(createApp()).post('/api/regions').send({
      code: 'manual_3',
      name: '财政局',
      parent_id: 9999,
      is_department: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBeUndefined();
    const insert = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO regions'));
    expect(insert?.[1]).toEqual(['manual_3', '财政局', null, 9999, 3, 11, true]);
  });

  it('matches root nodes with a null parent through IS NOT DISTINCT FROM', async () => {
    routeQueries([{ ...regionRow, id: 10, parent_id: null, level: 1 }]);

    const res = await request(createApp()).post('/api/regions').send({
      code: 'manual_4',
      name: '内蒙古自治区',
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 10, deduplicated: true });

    const dedup = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('IS NOT DISTINCT FROM')
    );
    expect(dedup?.[1]).toEqual(['内蒙古自治区', null]);
  });
});
