import { runMigrations } from './migrations';

export async function initializeDatabase(): Promise<void> {
  const pool = (await import('../config/database')).default;

  try {
    // 测试数据库连接
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful:', result.rows[0]);

    // 运行迁移
    await runMigrations();

    console.log('✓ Database initialization completed');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  const pool = (await import('../config/database')).default;
  await pool.end();
  console.log('✓ Database connection closed');
}
