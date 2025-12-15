import { Pool } from 'pg';

// 优先支持 DATABASE_URL，无则回退到 DB_* 环境变量
const getPoolConfig = () => {
  if (process.env.DATABASE_URL) {
    console.log('[Database] 使用 DATABASE_URL 连接');
    return {
      connectionString: process.env.DATABASE_URL,
    };
  }

  console.log('[Database] 使用 DB_* 环境变量连接');
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
};

const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

pool.on('connect', () => {
  console.log('✓ Database connection successful');
});

export default pool;
