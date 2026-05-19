import { createHash } from 'crypto';

export type MigrationDirection = 'up' | 'down';
export type MigrationStatus = 'planned' | 'skipped' | 'succeeded' | 'blocked' | 'failed';

export interface QueryResultLike<T = any> {
  rows: T[];
  rowCount?: number | null;
}

export interface MigrationClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResultLike<T>>;
}

export interface MigrationPool extends MigrationClient {
  connect?: () => Promise<MigrationClient & { release: () => void }>;
}

export interface MigrationContext {
  dryRun: boolean;
  env: NodeJS.ProcessEnv;
}

export interface RegisteredMigration {
  id: string;
  name: string;
  reversible: boolean;
  runOnEveryStart?: boolean;
  transaction?: boolean;
  notes?: string;
  up: (client: MigrationClient, context: MigrationContext) => Promise<void>;
  down?: (client: MigrationClient, context: MigrationContext) => Promise<void>;
}

export interface MigrationStepResult {
  migrationId: string;
  name: string;
  direction: MigrationDirection;
  status: MigrationStatus;
  message?: string;
}

export interface MigrationRunReport {
  dryRun: boolean;
  steps: MigrationStepResult[];
}

export interface MigrationRunnerOptions {
  pool: MigrationPool;
  migrations: RegisteredMigration[];
  systemName: string;
  env?: NodeJS.ProcessEnv;
  dryRun?: boolean;
}

export interface RollbackOptions extends MigrationRunnerOptions {
  steps: number;
}

interface LedgerRow {
  id: number;
  migration_id: string | null;
  checksum: string | null;
  created_at?: string;
}

function checksumMigration(migration: RegisteredMigration): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: migration.id,
        name: migration.name,
        reversible: migration.reversible,
        runOnEveryStart: migration.runOnEveryStart === true,
        transaction: migration.transaction !== false,
        hasDown: typeof migration.down === 'function',
      })
    )
    .digest('hex');
}

function isProductionEnvironment(env: NodeJS.ProcessEnv): boolean {
  return [env.NODE_ENV, env.APP_ENV, env.DB_ENV, env.DATABASE_ENV]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase() === 'production');
}

function assertProductionRollbackAllowed(env: NodeJS.ProcessEnv): void {
  if (!isProductionEnvironment(env)) return;

  if (env.ALLOW_PRODUCTION_ROLLBACK !== '1') {
    throw new Error('production_rollback_blocked: set ALLOW_PRODUCTION_ROLLBACK=1 after backup approval');
  }

  if (env.DB_ROLLBACK_BACKUP_CONFIRMED !== '1') {
    throw new Error('production_rollback_backup_required: set DB_ROLLBACK_BACKUP_CONFIRMED=1 after verifying a fresh backup');
  }
}

export async function ensureMigrationLedger(pool: MigrationPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration_ledger (
      id BIGSERIAL PRIMARY KEY,
      system_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE schema_migration_ledger
      ADD COLUMN IF NOT EXISTS migration_id TEXT,
      ADD COLUMN IF NOT EXISTS direction TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT,
      ADD COLUMN IF NOT EXISTS checksum TEXT,
      ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS error_message TEXT;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_migration_ledger_system_created
    ON schema_migration_ledger(system_name, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_schema_migration_ledger_migration_status
    ON schema_migration_ledger(system_name, migration_id, direction, status, id DESC);
  `);
}

async function recordLedger(
  client: MigrationClient,
  input: {
    systemName: string;
    migration: RegisteredMigration;
    action: string;
    direction: MigrationDirection;
    status: Exclude<MigrationStatus, 'planned'>;
    details?: Record<string, unknown>;
    errorMessage?: string;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO schema_migration_ledger
       (system_name, action, details, migration_id, direction, status, checksum, started_at, finished_at, error_message)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, NOW(), NOW(), $8)`,
    [
      input.systemName,
      input.action,
      JSON.stringify(input.details ?? {}),
      input.migration.id,
      input.direction,
      input.status,
      checksumMigration(input.migration),
      input.errorMessage ?? null,
    ]
  );
}

async function withMigrationClient<T>(
  pool: MigrationPool,
  useTransaction: boolean,
  work: (client: MigrationClient) => Promise<T>
): Promise<T> {
  if (!useTransaction) {
    return work(pool);
  }

  if (pool.connect) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await pool.query('BEGIN');
  try {
    const result = await work(pool);
    await pool.query('COMMIT');
    return result;
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

async function readAppliedMigrationIds(pool: MigrationPool, systemName: string): Promise<Set<string>> {
  const result = await pool.query<{ migration_id: string }>(
    `SELECT DISTINCT migration_id
     FROM schema_migration_ledger
     WHERE system_name = $1
       AND direction = 'up'
       AND status = 'succeeded'
       AND migration_id IS NOT NULL`,
    [systemName]
  );

  return new Set(result.rows.map((row) => row.migration_id));
}

export async function runRegisteredMigrations(options: MigrationRunnerOptions): Promise<MigrationRunReport> {
  const dryRun = options.dryRun === true;
  const env = options.env ?? process.env;
  const report: MigrationRunReport = { dryRun, steps: [] };

  if (dryRun) {
    for (const migration of options.migrations) {
      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'up',
        status: 'planned',
        message: 'dry-run: migration body and ledger writes were not executed',
      });
    }
    return report;
  }

  await ensureMigrationLedger(options.pool);
  const appliedIds = await readAppliedMigrationIds(options.pool, options.systemName);

  for (const migration of options.migrations) {
    const alreadyApplied = appliedIds.has(migration.id);

    if (!migration.runOnEveryStart && alreadyApplied) {
      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'up',
        status: 'skipped',
        message: 'already recorded as succeeded',
      });
      continue;
    }

    try {
      await withMigrationClient(options.pool, migration.transaction !== false, async (client) => {
        await migration.up(client, { dryRun, env });
        await recordLedger(client, {
          systemName: options.systemName,
          migration,
          action: alreadyApplied ? 'run_forward_migration_check' : 'run_forward_migration',
          direction: 'up',
          status: alreadyApplied ? 'skipped' : 'succeeded',
          details: {
            name: migration.name,
            runOnEveryStart: migration.runOnEveryStart === true,
            alreadyRecorded: alreadyApplied,
            executed: true,
          },
        });
      });

      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'up',
        status: alreadyApplied ? 'skipped' : 'succeeded',
        message: alreadyApplied ? 'run-on-every-start migration executed; rollback candidate was not duplicated' : undefined,
      });
    } catch (error: any) {
      try {
        await recordLedger(options.pool, {
          systemName: options.systemName,
          migration,
          action: 'run_forward_migration',
          direction: 'up',
          status: 'failed',
          details: { name: migration.name },
          errorMessage: error?.message || String(error),
        });
      } catch {
        // Preserve the original migration failure; the ledger write is best effort here.
      }
      throw error;
    }
  }

  return report;
}

async function readRollbackRows(pool: MigrationPool, systemName: string, steps: number): Promise<LedgerRow[]> {
  const result = await pool.query<LedgerRow>(
    `SELECT id, migration_id, checksum, created_at
     FROM schema_migration_ledger
     WHERE system_name = $1
       AND direction = 'up'
       AND status = 'succeeded'
     ORDER BY id DESC
     LIMIT $2`,
    [systemName, steps]
  );
  return result.rows;
}

export async function rollbackRegisteredMigrations(options: RollbackOptions): Promise<MigrationRunReport> {
  if (!Number.isInteger(options.steps) || options.steps < 1) {
    throw new Error('rollback_steps_invalid: steps must be a positive integer');
  }

  const dryRun = options.dryRun === true;
  const env = options.env ?? process.env;
  const report: MigrationRunReport = { dryRun, steps: [] };

  if (!dryRun) {
    assertProductionRollbackAllowed(env);
    await ensureMigrationLedger(options.pool);
  }

  const migrationById = new Map(options.migrations.map((migration) => [migration.id, migration]));
  const rows = await readRollbackRows(options.pool, options.systemName, options.steps);

  for (const row of rows) {
    const migration = row.migration_id ? migrationById.get(row.migration_id) : undefined;
    const fallbackName = row.migration_id ?? `ledger:${row.id}`;

    if (!migration) {
      report.steps.push({
        migrationId: fallbackName,
        name: fallbackName,
        direction: 'down',
        status: 'blocked',
        message: 'migration is not registered in the current code',
      });
      if (!dryRun) {
        throw new Error(`rollback_blocked_unregistered_migration: ${fallbackName}`);
      }
      continue;
    }

    if (!migration.reversible || typeof migration.down !== 'function') {
      const message = 'migration has no reviewed down script';
      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'down',
        status: 'blocked',
        message,
      });

      if (!dryRun) {
        await recordLedger(options.pool, {
          systemName: options.systemName,
          migration,
          action: 'rollback_blocked',
          direction: 'down',
          status: 'blocked',
          details: { sourceLedgerId: row.id, reason: message },
        });
        throw new Error(`rollback_blocked_without_down_migration: ${migration.id}`);
      }
      continue;
    }

    if (dryRun) {
      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'down',
        status: 'planned',
        message: `dry-run: would rollback ledger row ${row.id}`,
      });
      continue;
    }

    try {
      await withMigrationClient(options.pool, migration.transaction !== false, async (client) => {
        await migration.down!(client, { dryRun, env });
        await recordLedger(client, {
          systemName: options.systemName,
          migration,
          action: 'rollback_migration',
          direction: 'down',
          status: 'succeeded',
          details: { sourceLedgerId: row.id },
        });
      });

      report.steps.push({
        migrationId: migration.id,
        name: migration.name,
        direction: 'down',
        status: 'succeeded',
      });
    } catch (error: any) {
      try {
        await recordLedger(options.pool, {
          systemName: options.systemName,
          migration,
          action: 'rollback_migration',
          direction: 'down',
          status: 'failed',
          details: { sourceLedgerId: row.id },
          errorMessage: error?.message || String(error),
        });
      } catch {
        // Preserve the original rollback failure; the ledger write is best effort here.
      }
      throw error;
    }
  }

  return report;
}

export async function readMigrationLedger(
  pool: MigrationPool,
  systemName: string,
  limit = 20
): Promise<QueryResultLike> {
  return pool.query(
    `SELECT id, system_name, migration_id, direction, status, action, checksum, error_message, details, created_at
     FROM schema_migration_ledger
     WHERE system_name = $1
     ORDER BY id DESC
     LIMIT $2`,
    [systemName, limit]
  );
}
