import pool from '../config/database-llm';
import { MIGRATION_SYSTEM_NAME, getRegisteredMigrations } from '../db/migrationRegistry';
import {
  readMigrationLedger,
  rollbackRegisteredMigrations,
  runRegisteredMigrations,
} from '../db/migrationRunner';

interface CliOptions {
  command: 'up' | 'rollback' | 'ledger' | 'help';
  dryRun: boolean;
  steps: number;
  limit: number;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const exact = process.argv.find((arg) => arg.startsWith(prefix));
  if (exact) return exact.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readArg(name);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name}_invalid: expected a positive integer`);
  }
  return value;
}

function parseOptions(): CliOptions {
  const command = (process.argv[2] ?? 'help') as CliOptions['command'];
  if (!['up', 'rollback', 'ledger', 'help'].includes(command)) {
    throw new Error(`unknown_command: ${command}`);
  }

  return {
    command,
    dryRun: process.argv.includes('--dry-run'),
    steps: readPositiveInteger('steps', 1),
    limit: readPositiveInteger('limit', 20),
  };
}

function printHelp(): void {
  console.log(`
Database migration CLI

Usage:
  npm run db:migrate -- up [--dry-run]
  npm run db:migrate -- rollback --steps=1 [--dry-run]
  npm run db:migrate -- ledger [--limit=20]

Production rollback requires:
  ALLOW_PRODUCTION_ROLLBACK=1
  DB_ROLLBACK_BACKUP_CONFIRMED=1

Before any non-dry-run rollback, create and verify a database backup.
`);
}

async function main(): Promise<void> {
  const options = parseOptions();

  if (options.command === 'help') {
    printHelp();
    return;
  }

  if (options.command === 'up') {
    const report = await runRegisteredMigrations({
      pool,
      migrations: getRegisteredMigrations(),
      systemName: MIGRATION_SYSTEM_NAME,
      dryRun: options.dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (options.command === 'rollback') {
    console.warn(
      '[DB Rollback] Run a verified backup first. Production rollback is blocked unless ALLOW_PRODUCTION_ROLLBACK=1 and DB_ROLLBACK_BACKUP_CONFIRMED=1 are set.'
    );
    const report = await rollbackRegisteredMigrations({
      pool,
      migrations: getRegisteredMigrations(),
      systemName: MIGRATION_SYSTEM_NAME,
      steps: options.steps,
      dryRun: options.dryRun,
    });
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const result = await readMigrationLedger(pool, MIGRATION_SYSTEM_NAME, options.limit);
  console.log(JSON.stringify(result.rows, null, 2));
}

main()
  .catch((error) => {
    console.error('[DB Migration CLI] failed:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
