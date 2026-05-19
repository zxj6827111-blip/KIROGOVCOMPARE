import pool from '../config/database-llm';
import {
  MigrationRunReport,
  ensureMigrationLedger,
  rollbackRegisteredMigrations,
  runRegisteredMigrations,
} from './migrationRunner';
import { MIGRATION_SYSTEM_NAME, getRegisteredMigrations } from './migrationRegistry';

export async function runMigrations(options: { dryRun?: boolean } = {}): Promise<MigrationRunReport> {
  return runRegisteredMigrations({
    pool,
    migrations: getRegisteredMigrations(),
    systemName: MIGRATION_SYSTEM_NAME,
    dryRun: options.dryRun === true,
  });
}

export async function rollbackMigration(
  steps: number = 1,
  options: { dryRun?: boolean } = {}
): Promise<MigrationRunReport> {
  await ensureMigrationLedger(pool);
  return rollbackRegisteredMigrations({
    pool,
    migrations: getRegisteredMigrations(),
    systemName: MIGRATION_SYSTEM_NAME,
    steps,
    dryRun: options.dryRun === true,
  });
}
