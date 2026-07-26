/**
 * POST /jobs/:version_id/retry — legacy full-reset path gates on CORE pipeline
 * jobs only (parse / structured_import / materialize / checks).
 *
 * Regression coverage:
 *   1. A queued side job (vision_review left over from an earlier successful
 *      checks run) must not block retrying an all-failed core pipeline, and the
 *      clone loop must recreate the failed core job — never a kind='parse' job
 *      for a structured version.
 *   2. A non-terminal CORE job still blocks the legacy reset.
 *   3. Cancelled core jobs count as terminal and are recreated (matches the
 *      long-standing failed-or-cancelled clone filter).
 */
import express from 'express';
import request from 'supertest';

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/LlmJobRunner', () => ({
  llmJobRunner: {
    cancelJob: jest.fn(),
  },
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    (req as any).user = { id: 1, permissions: { manage_jobs: true } };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/SourceFileGuardService', () => ({
  checkVersionSourceFileExists: jest.fn(),
}));

jest.mock('../services/PipelineRecoveryService', () => ({
  recoverVersionDownstream: jest.fn(),
}));

import pool from '../config/database-llm';
import { recoverVersionDownstream } from '../services/PipelineRecoveryService';

const mockedQuery = pool.query as jest.Mock;
const mockedRecover = recoverVersionDownstream as jest.Mock;

const VERSION_ID = 9;
const REPORT_ID = 7;

function norm(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

type JobRow = { id: number; status: string; kind: string };

function installScenario(jobRows: JobRow[]): void {
  mockedQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const s = norm(sql);
    if (s.includes('SELECT r.region_id') && s.includes('FROM report_versions rv')) {
      return { rows: [{ region_id: 10 }] };
    }
    if (s.includes('SELECT id, status, kind') && s.includes('FROM jobs')) {
      return { rows: jobRows };
    }
    if (s.includes('SELECT * FROM jobs WHERE id =')) {
      const id = Number((params as unknown[])?.[0]);
      const row = jobRows.find((j) => j.id === id);
      return {
        rows: [
          {
            id,
            report_id: REPORT_ID,
            version_id: VERSION_ID,
            kind: row?.kind || 'unknown',
            status: row?.status || 'failed',
            ingestion_batch_id: null,
            max_retries: 1,
            provider: 'structured_import',
            model: 'none',
          },
        ],
      };
    }
    if (s.includes('INSERT INTO jobs')) {
      return { rows: [{ id: 501 }] };
    }
    return { rows: [] };
  });
}

function insertedKinds(): string[] {
  return mockedQuery.mock.calls
    .filter(([sql]: unknown[]) => norm(sql).includes('INSERT INTO jobs'))
    .map(([, params]: any[]) => String(params?.[2] ?? ''));
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/jobs', require('../routes/jobs').default);
  return app;
}

describe('POST /jobs/:version_id/retry core-kind gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Force the legacy path: downstream recovery reports the parse stage failed.
    mockedRecover.mockResolvedValue({ action: 'none', reason: 'upstream_failed' });
  });

  it('retries an all-failed core pipeline even when a side vision_review job is still queued', async () => {
    installScenario([
      { id: 1, status: 'failed', kind: 'structured_import' },
      { id: 2, status: 'queued', kind: 'vision_review' },
    ]);

    const response = await request(buildApp()).post(`/jobs/${VERSION_ID}/retry`);

    expect(response.status).toBe(200);
    expect(response.body.jobs_reset).toBe(1);
    expect(insertedKinds()).toEqual(['structured_import']);
    // Never invent an AI parse job for a structured version.
    expect(insertedKinds()).not.toContain('parse');
  });

  it('still blocks when a CORE job is queued or running', async () => {
    installScenario([
      { id: 1, status: 'failed', kind: 'structured_import' },
      { id: 2, status: 'queued', kind: 'materialize' },
    ]);

    const response = await request(buildApp()).post(`/jobs/${VERSION_ID}/retry`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Cannot retry: not all jobs are in failed state');
    expect(insertedKinds()).toHaveLength(0);
  });

  it('treats cancelled core jobs as terminal and recreates them', async () => {
    installScenario([{ id: 1, status: 'cancelled', kind: 'structured_import' }]);

    const response = await request(buildApp()).post(`/jobs/${VERSION_ID}/retry`);

    expect(response.status).toBe(200);
    expect(response.body.jobs_reset).toBe(1);
    expect(insertedKinds()).toEqual(['structured_import']);
  });

  it('returns 400 when the version has only side jobs and nothing core to retry', async () => {
    installScenario([{ id: 2, status: 'failed', kind: 'vision_review' }]);

    const response = await request(buildApp()).post(`/jobs/${VERSION_ID}/retry`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('No failed or cancelled jobs to retry');
    expect(insertedKinds()).toHaveLength(0);
  });
});
