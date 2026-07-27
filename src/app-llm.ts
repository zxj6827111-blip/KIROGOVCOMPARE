import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { dbType } from './config/database-llm';
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
import issuesSummaryRouter from './routes/issues-summary';
import reportMaintenanceRouter from './routes/report-maintenance';
import dataCenterRouter from './routes/data-center';
import govInsightRouter from './routes/gov-insight';
import govInsightPdfRouter from './routes/gov-insight-pdf';
import retiredCompareTasksRouter from './routes/retired-compare-tasks';
import filingsRouter from './routes/filings';
import { createRateLimiter, createRedisStore } from './middleware/rateLimit';
import { redactSensitive } from './utils/logRedactor';

dotenv.config();

export function createLlmApp(): express.Express {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
  app.set('trust proxy', trustProxy ? 1 : false);
  const defaultCorsOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
  const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins;
  const allowAnyOrigin = allowedOrigins.includes('*');
  if (isProduction && allowAnyOrigin) {
    throw new Error('CORS_ALLOWED_ORIGINS must not contain "*" in production');
  }
  const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 300);
  const rateLimitStore = (process.env.RATE_LIMIT_STORE || 'memory').toLowerCase();
  const useRedis = rateLimitStore === 'redis';
  const store = useRedis ? createRedisStore() : undefined;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(
    createRateLimiter({
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      store,
      skip: (req) => req.path === '/api/health',
    })
  );

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const originAllowed = Boolean(origin && (allowAnyOrigin || allowedOrigins.includes(origin)));
    if (origin) {
      res.setHeader('Vary', 'Origin');
    }
    if (originAllowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      if (origin && !originAllowed) {
        res.sendStatus(403);
        return;
      }
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/api', llmHealthRouter);
  app.use('/api/gov-insight', govInsightRouter);
  app.use('/api/gov-insight', govInsightPdfRouter);

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

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/v1/tasks/compare', retiredCompareTasksRouter);
  app.use('/api/regions', regionsImportRouter);
  app.use('/api/regions', llmRegionsRouter);
  app.use('/api/jobs', llmJobsRouter);
  app.use('/api/comparisons', comparisonHistoryRouter);
  app.use('/api/comparisons', pdfExportRouter);
  app.use('/api', llmComparisonsRouter);
  app.use('/api', reportsRouter);
  app.use('/api', filingsRouter);
  app.use('/api', require('./routes/consistency').default);
  app.use('/api', issuesSummaryRouter);
  app.use('/api', dataCenterRouter);
  app.use('/api/report-maintenance', reportMaintenanceRouter);
  app.use('/api/pdf-jobs', pdfJobsRouter);
  app.use('/api/ai', require('./routes/ai').default);
  app.use('/api/ai', require('./routes/ai-models').default);

  const publicDir = path.resolve(process.cwd(), 'dist', 'public');
  const indexHtmlPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexHtmlPath)) {
    app.use(express.static(publicDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Error:', redactSensitive(err));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
