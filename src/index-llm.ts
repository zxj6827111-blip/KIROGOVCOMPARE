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
import pdfExportRouter from './routes/pdf-export';
import pdfJobsRouter from './routes/pdf-jobs';
import authRouter from './routes/auth';
import usersRouter from './routes/users';
import { llmJobRunner } from './services/LlmJobRunner';
import { startPdfExportWorker } from './services/PdfExportWorker';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - allow cross-origin requests (needed for PDF export print page)
app.use((req, res, next) => {
  // Allow requests from common frontend dev server ports
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

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
// PDF export for comparison reports (Puppeteer-based)
app.use('/api/comparisons', pdfExportRouter);
app.use('/api', llmComparisonsRouter);
app.use('/api', reportsRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
// PDF export async jobs (for Job Center download tasks)
app.use('/api/pdf-jobs', pdfJobsRouter);

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

    // Start PDF export worker for background PDF generation
    startPdfExportWorker();

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
