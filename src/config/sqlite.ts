import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const dataDir = path.join(process.cwd(), 'data');
export const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(dataDir, 'llm_ingestion.db');

let migrationsRan = false;

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
