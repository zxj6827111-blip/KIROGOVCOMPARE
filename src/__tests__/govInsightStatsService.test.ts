import pool from '../config/database-llm';
import { govInsightStatsService } from '../services/GovInsightStatsService';
import { govInsightStatsV2Service } from '../services/GovInsightStatsV2Service';

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/GovInsightStatsV2Service', () => ({
  govInsightStatsV2Service: {
    materialize: jest.fn(),
  },
}));

const mockedPool = pool as unknown as {
  query: jest.Mock;
  connect: jest.Mock;
};
const mockedMaterialize = govInsightStatsV2Service.materialize as jest.Mock;

function mockLockClient() {
  const client = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
  };
  mockedPool.connect.mockResolvedValue(client);
  return client;
}

describe('GovInsightStatsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedMaterialize.mockResolvedValue({ deleted: 0, inserted: 1 });
  });

  it('refreshes gov_open_annual_stats_v2 for the published report region and year', async () => {
    const lockClient = mockLockClient();
    mockedPool.query
      .mockResolvedValueOnce({ rows: [{ region_id: 819, year: 2025 }] })
      .mockResolvedValueOnce({ rows: [{ relkind: 'r' }] });

    const refreshed = await govInsightStatsService.refreshAnnualStats({
      reason: 'single_upload',
      reportId: 7001,
      versionId: 9001,
    });

    expect(refreshed).toBe(true);
    expect(mockedMaterialize).toHaveBeenCalledTimes(1);
    expect(mockedMaterialize).toHaveBeenCalledWith({ regionId: 819, year: 2025 });
    expect(lockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_lock($1)', [917361]);
    expect(lockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock($1)', [917361]);
    expect(lockClient.release).toHaveBeenCalledTimes(1);
  });

  it('refreshes gov_open_annual_stats_v2 by year when a batch completes', async () => {
    mockLockClient();
    mockedPool.query
      .mockResolvedValueOnce({ rows: [{ year: 2025 }, { year: 2024 }] })
      .mockResolvedValueOnce({ rows: [{ relkind: 'm' }] })
      .mockResolvedValueOnce({ rows: [] });

    const refreshed = await govInsightStatsService.refreshAnnualStats({
      reason: 'batch_complete',
      batchId: 501,
    });

    expect(refreshed).toBe(true);
    expect(mockedMaterialize).toHaveBeenCalledTimes(2);
    expect(mockedMaterialize).toHaveBeenNthCalledWith(1, { year: 2025 });
    expect(mockedMaterialize).toHaveBeenNthCalledWith(2, { year: 2024 });
    expect(mockedPool.query).toHaveBeenLastCalledWith('REFRESH MATERIALIZED VIEW gov_open_annual_stats');
  });
});
