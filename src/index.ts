import express from 'express';
import dotenv from 'dotenv';
import { initializeDatabase } from './db/init';
import { setupAllProcessors } from './queue/processors';
import tasksRouter from './routes/tasks';
import assetsRouter from './routes/assets';
import suggestionsRouter from './routes/suggestions';
import batchJobsRouter from './routes/batch-jobs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API路由
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/tasks', suggestionsRouter);
app.use('/api/v1/admin/batch-jobs', batchJobsRouter);

// 错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 启动服务器
async function start(): Promise<void> {
  try {
    // 初始化数据库
    await initializeDatabase();

    // 设置队列处理器
    await setupAllProcessors();

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
