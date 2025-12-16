/// <reference path="../types/sqlite3.d.ts" />
import { Pool } from 'pg';
import sqlite3 from 'sqlite3';
import path from 'path';
import { SQLITE_DB_PATH } from './sqlite';

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
  // SQLite 配置
  const dbPath =
    process.env.SQLITE_PATH || process.env.SQLITE_DB_PATH || SQLITE_DB_PATH || path.join(process.cwd(), 'data', 'llm_ingestion.db');
  
  // 创建数据目录
  const fs = require('fs');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  pool = new sqlite3.Database(dbPath, (err: any) => {
    if (err) {
      console.error('SQLite connection error:', err);
    } else {
      console.log('✓ SQLite database connected:', dbPath);
    }
  });

  // 启用外键约束
  pool.run('PRAGMA foreign_keys = ON');
}

export default pool;
export { dbType };
