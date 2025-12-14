/**
 * 开发模式启动脚本
 * 用于前端测试，跳过数据库初始化
 */

import express from 'express';
import dotenv from 'dotenv';
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

// CORS 支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'development' });
});

// API 路由
app.use('/api/v1/tasks', tasksRouter);
app.use('/api/v1/assets', assetsRouter);
app.use('/api/v1/tasks', suggestionsRouter);
app.use('/api/v1/admin/batch-jobs', batchJobsRouter);

// 错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 启动服务器
async function start(): Promise<void> {
  try {
    console.log('🚀 启动开发模式后端服务...');
    console.log('⚠️  注意: 数据库初始化已跳过，仅用于前端测试');
    console.log('');

    app.listen(PORT, () => {
      console.log(`✅ 服务器运行在 http://localhost:${PORT}`);
      console.log(`📍 健康检查: http://localhost:${PORT}/health`);
      console.log('');
      console.log('📚 API 端点:');
      console.log(`  - GET  /api/v1/tasks - 获取比对任务列表`);
      console.log(`  - POST /api/v1/tasks - 创建新的比对任务`);
      console.log(`  - GET  /api/v1/assets - 获取资产列表`);
      console.log(`  - POST /api/v1/assets - 上传新资产`);
      console.log('');
      console.log('按 Ctrl+C 停止服务器');
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

start();
