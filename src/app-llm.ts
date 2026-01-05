import express from 'express';
import dotenv from 'dotenv';
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
import { createRateLimiter, createRedisStore } from './middleware/rateLimit';
import { redactSensitive } from './utils/logRedactor';

dotenv.config();

export function createLlmApp(): express.Express {
  const app = express();
  const defaultCorsOrigins = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
  const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredCorsOrigins.length > 0 ? configuredCorsOrigins : defaultCorsOrigins;
  const allowAnyOrigin = allowedOrigins.includes('*');
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
    if (origin && (allowAnyOrigin || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use('/api', llmHealthRouter);

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

  app.use('/api/regions', regionsImportRouter);
  app.use('/api/regions', llmRegionsRouter);
  app.use('/api/jobs', llmJobsRouter);
  app.use('/api/comparisons', comparisonHistoryRouter);
  app.use('/api/comparisons', pdfExportRouter);
  app.use('/api', llmComparisonsRouter);
  app.use('/api', reportsRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/pdf-jobs', pdfJobsRouter);

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Error:', redactSensitive(err));
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
