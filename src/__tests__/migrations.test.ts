jest.mock('../config/database-llm', () => ({
  query: jest.fn(),
}));

jest.mock('../db/migrations-llm', () => ({
  runLLMMigrations: jest.fn(),
}));

import pool from '../config/database-llm';
import { runLLMMigrations } from '../db/migrations-llm';
import { rollbackMigration, runMigrations } from '../db/migrations';

const mockedQuery = pool.query as jest.Mock;
const mockedRunLLMMigrations = runLLMMigrations as jest.Mock;

describe('migration runner guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mockedRunLLMMigrations.mockResolvedValue(undefined);
  });

  it('runs forward migrations and records the action', async () => {
    await runMigrations();

    expect(mockedRunLLMMigrations).toHaveBeenCalledTimes(1);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['llm_schema_idempotent', 'run_forward_migration'])
    );
  });

  it('records and blocks rollback without a reviewed down migration', async () => {
    await expect(rollbackMigration(2)).rejects.toThrow('rollback_not_supported_without_down_migrations');

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['llm_schema_idempotent', 'rollback_blocked'])
    );
  });
});
