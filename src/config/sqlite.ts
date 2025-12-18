import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const dataDir = path.join(process.cwd(), 'data');
export const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(dataDir, 'llm_ingestion.db');

let migrationsRan = false;
let loggedDbPath = false;

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function runSqlStatements(sql: string): any[] {
  ensureDataDir();
  const output = execFileSync('sqlite3', ['-json', SQLITE_DB_PATH], { encoding: 'utf-8', input: sql }).trim();
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return output
      .split(/\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .flatMap((chunk) => {
        const value = JSON.parse(chunk);
        return Array.isArray(value) ? value : [value];
      });
  }
}

export function ensureSqliteMigrations(): void {
  if (!loggedDbPath) {
    console.log(`[sqlite] Using database at ${SQLITE_DB_PATH}`);
    loggedDbPath = true;
  }

  if (migrationsRan) {
    return;
  }

  const migrationsDir = path.join(__dirname, '../../migrations/sqlite');
  if (!fs.existsSync(migrationsDir)) {
    migrationsRan = true;
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    runSqlStatements(sql);
  }

  const columns = runSqlStatements('PRAGMA table_info(jobs);') as Array<{ name?: string }>;
  const hasComparisonId = columns.some((column) => column.name === 'comparison_id');
  if (!hasComparisonId) {
    runSqlStatements(
      'ALTER TABLE jobs ADD COLUMN comparison_id INTEGER REFERENCES comparisons(id) ON DELETE SET NULL;'
    );
  }
  runSqlStatements('CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);');

  const regionColumns = runSqlStatements('PRAGMA table_info(regions);') as Array<{ name?: string }>;
  const hasParentId = regionColumns.some((column) => column.name === 'parent_id');
  if (!hasParentId) {
    runSqlStatements('ALTER TABLE regions ADD COLUMN parent_id INTEGER;');
  }

  let levelColumns = hasParentId ? regionColumns : runSqlStatements('PRAGMA table_info(regions);');
  let hasLevel = levelColumns.some((column) => column.name === 'level');
  if (!hasLevel) {
    runSqlStatements('ALTER TABLE regions ADD COLUMN level INTEGER NOT NULL DEFAULT 1;');
    levelColumns = runSqlStatements('PRAGMA table_info(regions);');
    hasLevel = true;
  }
  if (hasLevel) {
    runSqlStatements('UPDATE regions SET level = 1 WHERE level IS NULL OR level < 1;');
  }
  runSqlStatements('CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_id);');

  migrationsRan = true;
}

function escapeValue(value: string | number | boolean | null | Date | Record<string, unknown> | undefined): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

export function querySqlite(sql: string): any[] {
  return runSqlStatements(sql);
}

export function executeSqlite(sql: string): void {
  runSqlStatements(sql);
}

export function sqlValue(value: string | number | boolean | null | Date | Record<string, unknown> | undefined): string {
  return escapeValue(value);
}
