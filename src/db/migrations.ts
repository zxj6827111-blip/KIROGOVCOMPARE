import { runLLMMigrations } from './migrations-llm';
import pool from '../config/database-llm';

export const MIGRATION_SYSTEM_NAME = 'llm_schema_idempotent';

async function ensureMigrationLedger(): Promise<void> {
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
    CREATE INDEX IF NOT EXISTS idx_schema_migration_ledger_system_created
    ON schema_migration_ledger(system_name, created_at DESC);
  `);
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationLedger();
  await runLLMMigrations();
  await pool.query(
    `INSERT INTO schema_migration_ledger (system_name, action, details)
     VALUES ($1, $2, $3::jsonb)`,
    [MIGRATION_SYSTEM_NAME, 'run_forward_migration', JSON.stringify({ runner: 'runLLMMigrations' })]
  );
}

export async function rollbackMigration(steps: number = 1): Promise<void> {
  await ensureMigrationLedger();
  await pool.query(
    `INSERT INTO schema_migration_ledger (system_name, action, details)
     VALUES ($1, $2, $3::jsonb)`,
    [
      MIGRATION_SYSTEM_NAME,
      'rollback_blocked',
      JSON.stringify({
        requestedSteps: steps,
        reason: 'No reviewed down migrations exist for the current idempotent schema runner.',
      }),
    ]
  );
  throw new Error(
    `rollback_not_supported_without_down_migrations: requested ${steps} step(s), but this project only supports forward migrations`
  );
}
