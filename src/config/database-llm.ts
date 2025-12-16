/// <reference path="../types/sqlite3.d.ts" />
import { Pool } from 'pg';
import path from 'path';
import { SQLITE_DB_PATH, querySqlite } from './sqlite';

const dbType = process.env.DATABASE_TYPE || 'sqlite';

let pool: any;

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
  // SQLite 配置 - 统一使用 SQLITE_DB_PATH，优先原生模块，回退到 CLI
  const dbPath = process.env.SQLITE_PATH || SQLITE_DB_PATH;
  
  // 创建数据目录
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 尝试加载 sqlite3 原生模块
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqlite3 = require('sqlite3');
    pool = new sqlite3.Database(dbPath, (err: any) => {
      if (err) {
        console.error('SQLite connection error:', err);
      } else {
        console.log('✓ SQLite database connected:', dbPath);
      }
    });

    // 启用外键约束
    pool.run('PRAGMA foreign_keys = ON');
  } catch (error) {
    console.warn('sqlite3 native module unavailable, using CLI-backed adapter');
    pool = {
      run: (statement: string, callback: (err?: any) => void) => {
        try {
          querySqlite(statement);
          callback?.(null);
        } catch (err) {
          callback?.(err);
        }
      },
      query: (statement: string) => Promise.resolve(querySqlite(statement)),
    };
  }
}

export default pool;
export { dbType };
