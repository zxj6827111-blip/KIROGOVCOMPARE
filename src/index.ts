import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { initializeDatabase } from './db/init';
import { setupAllProcessors } from './queue/processors';
import healthRouter from './routes/health';
import tasksRouter from './routes/tasks';
import assetsRouter from './routes/assets';
import suggestionsRouter from './routes/suggestions';
import batchJobsRouter from './routes/batch-jobs';
import adminRouter from './routes/admin';
import reportsRouter from './routes/reports';
import comparisonsRouter from './routes/comparisons';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 提供静态文件
app.use(express.static(path.join(__dirname, 'public')));

// 健康检查
app.use('/api', healthRouter);
app.use('/api', reportsRouter);

// 根路由
app.get('/', (_req, res) => {
  res.json({ 
    message: '政府信息公开年度报告差异比对系统 API',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      admin: '/admin',
      tasks: '/api/v1/tasks',
      assets: '/api/v1/assets',
      suggestions: '/api/v1/tasks/suggestions',
      batchJobs: '/api/v1/admin/batch-jobs'
    }
  });
});

// 后台管理页面
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API路由
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/tasks', suggestionsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/admin/batch-jobs', batchJobsRouter);
app.use('/api/comparisons', comparisonsRouter);

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
