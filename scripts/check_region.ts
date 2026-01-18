
import { DATA_DIR, ensureSqliteMigrations, querySqlite, sqlValue, SQLITE_DB_PATH, UPLOADS_DIR } from '../src/config/sqlite';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// Mock database-llm config if needed, but we can use sqlite direct
const dbPath = path.join(__dirname, '../data/llm.db');
const Database = require('better-sqlite3');
const db = new Database(dbPath, { verbose: console.log });

const regionId = 3117;
const row = db.prepare('SELECT * FROM regions WHERE id = ?').get(regionId);
console.log('Region ' + regionId + ':', row);
