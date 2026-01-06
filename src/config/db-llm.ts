import pool, { dbType } from './database-llm';
import { ensureSqliteMigrations } from './sqlite';

export { dbType };

export function ensureDbMigrations(): void {
  if (dbType === 'sqlite') {
    ensureSqliteMigrations();
  }
}

export async function dbQuery(sql: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(sql, params);
  return result?.rows ?? [];
}

export async function dbExecute(sql: string, params: any[] = []): Promise<void> {
  await pool.query(sql, params);
}

export function dbNowExpression(): string {
  return dbType === 'postgres' ? 'NOW()' : "datetime('now')";
}

export function dbBool(value: boolean): string {
  return dbType === 'postgres' ? (value ? 'true' : 'false') : (value ? '1' : '0');
}

export function parseDbJson<T = any>(value: any): T | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
