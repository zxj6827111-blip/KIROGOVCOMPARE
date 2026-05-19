import {
  MigrationPool,
  RegisteredMigration,
  rollbackRegisteredMigrations,
  runRegisteredMigrations,
} from '../db/migrationRunner';

function createMockPool(rowsBySql: Array<{ match: string; rows: any[] }> = []): MigrationPool & { query: jest.Mock } {
  const query = jest.fn(async (sql: string) => {
    const normalizedSql = String(sql);
    const matched = rowsBySql.find((entry) => normalizedSql.includes(entry.match));
    return { rows: matched?.rows ?? [], rowCount: matched?.rows?.length ?? 0 };
  });
  return { query };
}

function createMigration(overrides: Partial<RegisteredMigration> = {}): RegisteredMigration {
  return {
    id: '0002_reversible_test',
    name: 'Reversible test migration',
    reversible: true,
    up: jest.fn(async (client) => {
      await client.query('CREATE TABLE IF NOT EXISTS test_table (id BIGSERIAL PRIMARY KEY)');
    }),
    down: jest.fn(async (client) => {
      await client.query('DROP TABLE IF EXISTS test_table');
    }),
    ...overrides,
  };
}

describe('migration runner guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs forward migrations and records the action in ledger', async () => {
    const pool = createMockPool([{ match: 'SELECT DISTINCT migration_id', rows: [] }]);
    const migration = createMigration();

    const report = await runRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
    });

    expect(report.steps).toEqual([
      expect.objectContaining({
        migrationId: '0002_reversible_test',
        direction: 'up',
        status: 'succeeded',
      }),
    ]);
    expect(migration.up).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['test_system', 'run_forward_migration'])
    );
  });

  it('dry-run reports forward plan without executing migration body or writing ledger', async () => {
    const pool = createMockPool();
    const migration = createMigration();

    const report = await runRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
      dryRun: true,
    });

    expect(report.dryRun).toBe(true);
    expect(report.steps).toEqual([
      expect.objectContaining({
        migrationId: '0002_reversible_test',
        direction: 'up',
        status: 'planned',
      }),
    ]);
    expect(migration.up).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('executes run-on-every-start migration without duplicating rollback candidates after first record', async () => {
    const pool = createMockPool([
      { match: 'latest_effective_migration_state', rows: [{ migration_id: '0001_legacy' }] },
    ]);
    const migration = createMigration({
      id: '0001_legacy',
      name: 'Legacy schema ensure',
      reversible: false,
      runOnEveryStart: true,
      down: undefined,
    });

    const report = await runRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
    });

    expect(migration.up).toHaveBeenCalledTimes(1);
    expect(report.steps).toEqual([
      expect.objectContaining({
        migrationId: '0001_legacy',
        direction: 'up',
        status: 'skipped',
      }),
    ]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['test_system', 'run_forward_migration_check'])
    );
  });

  it('blocks rollback when the latest migration has no down script', async () => {
    const migration = createMigration({
      id: '0003_forward_only',
      name: 'Forward only migration',
      reversible: false,
      down: undefined,
    });
    const pool = createMockPool([
      {
        match: 'FROM schema_migration_ledger',
        rows: [{ id: 10, migration_id: '0003_forward_only', checksum: 'abc' }],
      },
    ]);

    await expect(
      rollbackRegisteredMigrations({
        pool,
        migrations: [migration],
        systemName: 'test_system',
        steps: 1,
      })
    ).rejects.toThrow('rollback_blocked_without_down_migration');

    expect(migration.up).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['test_system', 'rollback_blocked'])
    );
  });

  it('executes down migration and records rollback when down script exists', async () => {
    const migration = createMigration();
    const pool = createMockPool([
      {
        match: 'FROM schema_migration_ledger',
        rows: [{ id: 11, migration_id: '0002_reversible_test', checksum: 'abc' }],
      },
    ]);

    const report = await rollbackRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
      steps: 1,
    });

    expect(report.steps).toEqual([
      expect.objectContaining({
        migrationId: '0002_reversible_test',
        direction: 'down',
        status: 'succeeded',
      }),
    ]);
    expect(migration.down).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schema_migration_ledger'),
      expect.arrayContaining(['test_system', 'rollback_migration'])
    );
  });

  it('reruns forward migration after latest effective state is down succeeded', async () => {
    const migration = createMigration();
    const pool = createMockPool([
      {
        match: 'latest_effective_migration_state',
        rows: [],
      },
    ]);

    const report = await runRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
    });

    expect(report.steps).toEqual([
      expect.objectContaining({
        migrationId: '0002_reversible_test',
        direction: 'up',
        status: 'succeeded',
      }),
    ]);
    expect(migration.up).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("direction IN ('up', 'down')"),
      expect.arrayContaining(['test_system'])
    );
  });

  it('does not rollback a migration whose latest effective state is already down succeeded', async () => {
    const migration = createMigration();
    const pool = createMockPool([
      {
        match: 'latest_effective_migration_state',
        rows: [],
      },
    ]);

    const report = await rollbackRegisteredMigrations({
      pool,
      migrations: [migration],
      systemName: 'test_system',
      steps: 1,
    });

    expect(report.steps).toEqual([]);
    expect(migration.down).not.toHaveBeenCalled();
  });

  it('rolls back only the most recent currently applied migrations in a multi-migration ledger', async () => {
    const oldApplied = createMigration({
      id: '0001_old_applied',
      name: 'Old applied migration',
    });
    const downed = createMigration({
      id: '0002_already_downed',
      name: 'Already downed migration',
    });
    const latestApplied = createMigration({
      id: '0003_latest_applied',
      name: 'Latest applied migration',
    });
    const pool = createMockPool([
      {
        match: 'latest_effective_migration_state',
        rows: [
          { id: 30, migration_id: '0003_latest_applied', checksum: 'c' },
          { id: 10, migration_id: '0001_old_applied', checksum: 'a' },
        ],
      },
    ]);

    const report = await rollbackRegisteredMigrations({
      pool,
      migrations: [oldApplied, downed, latestApplied],
      systemName: 'test_system',
      steps: 2,
    });

    expect(report.steps).toEqual([
      expect.objectContaining({ migrationId: '0003_latest_applied', status: 'succeeded' }),
      expect.objectContaining({ migrationId: '0001_old_applied', status: 'succeeded' }),
    ]);
    expect(latestApplied.down).toHaveBeenCalledTimes(1);
    expect(oldApplied.down).toHaveBeenCalledTimes(1);
    expect(downed.down).not.toHaveBeenCalled();
  });

  it('blocks production rollback without explicit confirmation variables', async () => {
    const migration = createMigration();
    const pool = createMockPool([
      {
        match: 'FROM schema_migration_ledger',
        rows: [{ id: 12, migration_id: '0002_reversible_test', checksum: 'abc' }],
      },
    ]);

    await expect(
      rollbackRegisteredMigrations({
        pool,
        migrations: [migration],
        systemName: 'test_system',
        steps: 1,
        env: { NODE_ENV: 'production' },
      })
    ).rejects.toThrow('production_rollback_blocked');

    expect(migration.down).not.toHaveBeenCalled();
  });
});
