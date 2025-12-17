/// <reference path="../types/sqlite3.d.ts" />
import { Pool } from 'pg';
import path from 'path';
import { SQLITE_DB_PATH, querySqlite, sqlValue } from './sqlite';

const dbType = process.env.DATABASE_TYPE || 'sqlite';

let pool: any;

function formatParams(statement: string, params?: any[]): string {
  if (!params || params.length === 0) {
    return statement;
  }

  return params.reduce((sql, param, index) => {
    const placeholder = `$${index + 1}`;
    const value = sqlValue(param as any);
    return sql.split(placeholder).join(value);
  }, statement);
}

if (dbType === 'postgres') {
  // PostgreSQL 配置
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'llm_ingestion',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  pool.on('error', (err: any) => {
    console.error('Unexpected error on idle client', err);
  });
} else {
  // SQLite 配置（使用 CLI 适配器，避免强依赖 sqlite3 原生模块）
  const dbPath =
    process.env.SQLITE_PATH || process.env.SQLITE_DB_PATH || SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'llm_ingestion.db');

  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  pool = {
    run: (statement: string, paramsOrCb?: any[] | ((err?: any) => void), callback?: (err?: any) => void) => {
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : callback;
      const params = Array.isArray(paramsOrCb) ? paramsOrCb : [];
      const finalSql = formatParams(statement, params);
      try {
        querySqlite(finalSql);
        cb?.(null);
      } catch (err) {
        cb?.(err);
      }
    },
    query: (statement: string, params?: any[]) => {
      const finalSql = formatParams(statement, params);
      try {
        const rows = querySqlite(finalSql);
        return Promise.resolve({ rows });
      } catch (err) {
        return Promise.reject(err);
      }
    },
    execute: (statement: string, params?: any[]) => {
      const finalSql = formatParams(statement, params);
      try {
        querySqlite(finalSql);
        return Promise.resolve({ rows: [] });
      } catch (err) {
        return Promise.reject(err);
      }
    },
  };
}

export default pool;
export { dbType };
