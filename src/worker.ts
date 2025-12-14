import dotenv from 'dotenv';
import { initializeDatabase } from './db/init';
import { setupAllProcessors } from './queue/processors';

dotenv.config();

// 启动 Worker 进程
async function start(): Promise<void> {
  try {
    // 初始化数据库
    await initializeDatabase();

    // 设置所有队列处理器
    // 注意：禁止在 Worker 进程中启动 HTTP Server
    await setupAllProcessors();

    console.log('✓ Worker process started and listening to queues');
    console.log(`✓ Worker concurrency: ${process.env.WORKER_CONCURRENCY || 2}`);
  } catch (error) {
    console.error('Failed to start Worker process:', error);
    process.exit(1);
  }
}

start();
