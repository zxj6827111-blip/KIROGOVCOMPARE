import express from 'express';
import dotenv from 'dotenv';
import { dbType } from './config/database-llm';
import { runLLMMigrations } from './db/migrations-llm';
import llmHealthRouter from './routes/llm-health';
import llmRegionsRouter from './routes/llm-regions';
import regionsImportRouter from './routes/regions-import';
import llmJobsRouter from './routes/jobs';
import reportsRouter from './routes/reports';
import llmComparisonsRouter from './routes/llm-comparisons';
import comparisonHistoryRouter from './routes/comparison-history';
import authRouter from './routes/auth';
import { llmJobRunner } from './services/LlmJobRunner';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康检查
app.use('/api', llmHealthRouter);

// 根路由
app.get('/', (_req, res) => {
  res.json({
    message: 'LLM 解析与入库系统 API',
    version: '1.0.0',
    database: dbType,
    endpoints: {
      health: '/api/health',
      regions: '/api/regions',
      reports: '/api/reports',
      jobs: '/api/jobs/:id'
    }
  });
});

// API 路由
// IMPORTANT: regionsImportRouter has /template and /export routes, must come BEFORE llmRegionsRouter
app.use('/api/regions', regionsImportRouter);
app.use('/api/regions', llmRegionsRouter);
app.use('/api/jobs', llmJobsRouter);
// IMPORTANT: Mount comparison-history BEFORE llm-comparisons to avoid route conflicts
app.use('/api/comparisons', comparisonHistoryRouter);
app.use('/api', llmComparisonsRouter);
app.use('/api', reportsRouter);
app.use('/api/auth', authRouter);

// 错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 启动服务器
async function start(): Promise<void> {
  try {
    console.log(`Starting LLM ingestion system with ${dbType} database...`);

    // 运行迁移
    await runLLMMigrations();

    llmJobRunner.start();

    app.listen(PORT, () => {
      console.log(`✓ LLM API server running on port ${PORT}`);
      console.log(`✓ Database type: ${dbType}`);
      console.log(`✓ Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
