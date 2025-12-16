import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const dataDir = path.join(process.cwd(), 'data');
export const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(dataDir, 'llm_dev.db');

let migrationsRan = false;

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function runSqlStatements(sql: string): any[] {
  ensureDataDir();
  const output = execFileSync('sqlite3', ['-json', SQLITE_DB_PATH, sql], { encoding: 'utf-8' }).trim();
  if (!output) {
    return [];
  }

  return output
    .split(/\n+/)
    .filter(Boolean)
    .flatMap((line) => JSON.parse(line));
}

export function ensureSqliteMigrations(): void {
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

  migrationsRan = true;
}

function escapeValue(value: string | number | null): string {
  if (value === null) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export function querySqlite(sql: string): any[] {
  return runSqlStatements(sql);
}

export function executeSqlite(sql: string): void {
  runSqlStatements(sql);
}

export function sqlValue(value: string | number | null): string {
  return escapeValue(value);
}
