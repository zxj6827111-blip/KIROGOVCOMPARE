import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

console.log('[Config] Initializing DB with DATABASE_TYPE=postgres');

export const dbType = 'postgres';

// ⛔ SECURITY: Enforce required env vars for Postgres
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = requiredEnvVars.filter(v => !process.env[v]);
if (missing.length > 0) {
  console.error(`❌ FATAL: Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'llm_ingestion',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

pool.on('error', (err: any) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;
