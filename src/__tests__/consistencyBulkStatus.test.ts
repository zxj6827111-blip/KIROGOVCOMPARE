import express from 'express';
import request from 'supertest';
import pool from '../config/database-llm';
import consistencyRouter from '../routes/consistency';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.user = {
      id: 7,
      username: 'consistency-bulk-user',
      dataScope: { regions: ['Scoped'] },
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

jest.mock('../services/ConsistencyCheckService', () => ({
  consistencyCheckService: {
    runChecks: jest.fn(),
  },
}));

jest.mock('../services/VisionReviewService', () => ({
  visionReviewService: {},
}));

jest.mock('../services/OcrCorrectionService', () => ({
  ocrCorrectionService: {},
}));

const mockedQuery = pool.query as jest.Mock;
const mockedGetAllowedRegionIds = getAllowedRegionIdsAsync as jest.Mock;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', consistencyRouter);
  return app;
}

describe('Consistency check bulk status route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAllowedRegionIds.mockResolvedValue([101]);
  });

  it('updates multiple check items in a single scoped query', async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ region_id: 101 }] })
      .mockResolvedValueOnce({ rows: [{ id: 222 }] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: '10' }, { id: '11' }] })
      .mockResolvedValueOnce({ rows: [{ total: '0', visual: '0', structure: '0', quality: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const response = await request(buildApp())
      .post('/api/reports/44/checks/items/bulk-status')
      .send({
        version_id: 222,
        item_ids: [10, '11', 11, 0, 'bad'],
        human_status: 'confirmed',
        human_comment: 'batch confirm',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      report_id: 44,
      version_id: 222,
      requested_count: 2,
      updated_count: 2,
      missing_count: 0,
      updated_item_ids: [10, 11],
    });
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE report_consistency_items rci'),
      ['confirmed', 'batch confirm', 222, [10, 11]]
    );
  });

  it('rejects empty item lists before touching the database', async () => {
    const response = await request(buildApp())
      .post('/api/reports/44/checks/items/bulk-status')
      .send({
        version_id: 222,
        item_ids: [],
        human_status: 'confirmed',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'No valid item_ids' });
    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
