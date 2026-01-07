/// <reference path="../types/sqlite3.d.ts" />
import dotenv from 'dotenv';
import { Pool } from 'pg';
import path from 'path';
import { SQLITE_DB_PATH, querySqlite, sqlValue } from './sqlite';

dotenv.config();

console.log(`[Config] Initializing DB with DATABASE_TYPE=${process.env.DATABASE_TYPE || 'undefined (defaulting to sqlite)'}`);

const dbType = process.env.DATABASE_TYPE || 'sqlite';

// ⛔ SECURITY: Prevent silent fallback to SQLite when Postgres is expected
if (dbType === 'postgres') {
  const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error(`❌ FATAL: DATABASE_TYPE=postgres but missing required env vars: ${missing.join(', ')}`);
    console.error('⚠️  Refusing to silently fallback to SQLite. Fix your .env configuration!');
    process.exit(1);
  }
}

let pool: any;

function formatParams(statement: string, params?: any[]): string {
  if (!params || params.length === 0) {
    return statement;
  }

  let formatted = statement;

  // 先检查是否使用 $N 格式（PostgreSQL风格）
  const hasPostgresPlaceholders = /\$\d+/.test(formatted);

  if (hasPostgresPlaceholders) {
    // PostgreSQL 风格：$1, $2 等
    params.forEach((param, index) => {
      const placeholder = `$${index + 1}`;
      const value = sqlValue(param as any);
      formatted = formatted.split(placeholder).join(value);
    });
  } else {
    // SQLite 风格：? 占位符
    // 使用 split/reduce 安全替换，避免 regex replace 对 value 中特殊字符($)的处理，
    // 以及避免替换后的 value 中包含 ? 导致后续参数替换错误。
    const parts = formatted.split('?');
    if (parts.length - 1 === params.length) {
      formatted = parts.reduce((acc, part, i) => {
        if (i < params.length) {
          return acc + part + sqlValue(params[i]);
        }
        return acc + part;
      }, '');
    } else {
      // 参数数量不匹配时回退到旧逻辑（或报错），这里保留尽力替换
      console.warn(`[formatParams] Warning: Placeholder count (${parts.length - 1}) does not match param count (${params.length})`);
      for (const param of params) {
        const value = sqlValue(param as any);
        // 使用 function 防止 replacement string 中的 $ 被特殊处理
        formatted = formatted.replace(/\?/, () => value);
      }
    }
  }

  return formatted;
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
        const context: Record<string, unknown> = {};
        if (/insert\s+into/i.test(finalSql)) {
          const lastRow = querySqlite('SELECT last_insert_rowid() AS id;');
          context.lastID = lastRow?.[0]?.id ?? null;
        }
        cb?.call(context, null);
      } catch (err) {
        cb?.(err);
      }
    },
    all: (statement: string, paramsOrCb?: any[] | ((err?: any, rows?: any[]) => void), callback?: (err?: any, rows?: any[]) => void) => {
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : callback;
      const params = Array.isArray(paramsOrCb) ? paramsOrCb : [];
      const finalSql = formatParams(statement, params);
      try {
        const rows = querySqlite(finalSql);
        cb?.(null, rows || []);
      } catch (err) {
        cb?.(err);
      }
    },
    get: (statement: string, paramsOrCb?: any[] | ((err?: any, row?: any) => void), callback?: (err?: any, row?: any) => void) => {
      const cb = typeof paramsOrCb === 'function' ? paramsOrCb : callback;
      const params = Array.isArray(paramsOrCb) ? paramsOrCb : [];
      const finalSql = formatParams(statement, params);
      try {
        const rows = querySqlite(finalSql);
        cb?.(null, rows?.[0]);
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
