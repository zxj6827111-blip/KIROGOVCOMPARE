/**
 * P1 re-parse guard: report versions ingested from a local structured package
 * (ingestion_mode = 'structured_import') must never be re-enqueued for AI parse.
 *
 * Coverage:
 *   1. enqueueReportParseJob itself rejects with 422 + STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN
 *      before any INSERT INTO jobs — the guard lives in the shared function, not the routes.
 *   2. ai_parse versions keep the existing behaviour (exactly one parse job INSERT).
 *   3. POST /reports/:id/parse surfaces the guard as HTTP 422.
 *   4. POST /reports/batch-parse records structured versions as skipped (not failed)
 *      while ai_parse reports in the same batch still enqueue.
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

// The AI provider factory must never be touched by any re-parse entry point in
// these scenarios. Throwing on call turns an accidental invocation into a loud failure.
jest.mock('../services/LlmProviderFactory', () => ({
  createLlmProvider: jest.fn(() => {
    throw new Error('createLlmProvider must not be called by re-parse guard scenarios');
  }),
  activeProviderName: jest.fn(() => 'mock-provider'),
}));

jest.mock('../services/SourceFileGuardService', () => ({
  checkStoragePathExists: jest.fn(),
}));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    (req as any).user = { id: 1 };
    next();
  },
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));

jest.mock('../utils/dataScope', () => ({
  getAllowedRegionIdsAsync: jest.fn(),
}));

import pool from '../config/database-llm';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { checkStoragePathExists } from '../services/SourceFileGuardService';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
  enqueueReportParseJob,
  STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN,
} from '../routes/reports';

const mockedQuery = pool.query as jest.Mock;
const mockedCreateLlmProvider = createLlmProvider as unknown as jest.Mock;
const mockedCheckStoragePathExists = checkStoragePathExists as jest.Mock;
const mockedGetAllowedRegionIds = getAllowedRegionIdsAsync as jest.Mock;

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function insertIntoJobsCalls(): any[][] {
  return mockedQuery.mock.calls.filter(([sql]: any[]) => normalizeSql(sql).includes('INSERT INTO jobs'));
}

const STRUCTURED_VERSION_ROW = {
  provider: 'structured_import',
  model: 'none',
  ingestion_batch_id: 901,
  parsed_json: { sections: [{ title: '第一部分' }] },
  storage_path: 'uploads/structured/source.pdf',
  ingestion_mode: 'structured_import',
};

const AI_PARSE_VERSION_ROW = {
  provider: 'openai',
  model: 'gpt-test',
  ingestion_batch_id: null,
  parsed_json: null,
  storage_path: 'uploads/ai/source.pdf',
  ingestion_mode: 'ai_parse',
};

/**
 * SQL-shape dispatcher for a single report (id 1) whose preferred version is 55.
 * The reports row deliberately has active_version_id = null so version resolution
 * goes through the pending_review lookup (resolvePreferredVersionId).
 */
function installSingleReportScenario(versionRow: Record<string, unknown>, insertedJobId: number): void {
  mockedQuery.mockImplementation(async (sql: unknown) => {
    const s = normalizeSql(sql);
    if (s.includes('FROM reports r') && s.includes('active_version_id')) {
      return { rows: [{ id: 1, region_id: 10, active_version_id: null }] };
    }
    if (s.includes("review_status = 'pending_review'")) {
      return { rows: [{ id: 55 }] };
    }
    if (s.includes('SELECT provider, model, ingestion_batch_id, parsed_json, storage_path, ingestion_mode')) {
      return { rows: [versionRow] };
    }
    if (s.includes('INSERT INTO jobs')) {
      return { rows: [{ id: insertedJobId }] };
    }
    if (s.includes("kind = 'parse'")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

/**
 * Batch scenario: report 1 -> structured version 55, report 2 -> ai_parse version 56.
 * Dispatches on params[0]: report id for reports/pending_review lookups, version id
 * for the version-row lookup.
 */
function installBatchScenario(): void {
  mockedQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const s = normalizeSql(sql);
    const firstParam = Array.isArray(params) && params.length > 0 ? Number(params[0]) : null;
    if (s.includes('FROM reports r') && s.includes('active_version_id')) {
      return { rows: [{ id: firstParam, region_id: 10, active_version_id: null }] };
    }
    if (s.includes("review_status = 'pending_review'")) {
      return { rows: [{ id: firstParam === 1 ? 55 : 56 }] };
    }
    if (s.includes('SELECT provider, model, ingestion_batch_id, parsed_json, storage_path, ingestion_mode')) {
      if (firstParam === 55) {
        return { rows: [STRUCTURED_VERSION_ROW] };
      }
      if (firstParam === 56) {
        return { rows: [AI_PARSE_VERSION_ROW] };
      }
      return { rows: [] };
    }
    if (s.includes('INSERT INTO jobs')) {
      return { rows: [{ id: 88 }] };
    }
    if (s.includes("kind = 'parse'")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/', require('../routes/reports').default);
  return app;
}

describe('structured_import re-parse guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAllowedRegionIds.mockResolvedValue(null);
    mockedCheckStoragePathExists.mockReturnValue({ ok: true, storagePath: 'x', resolvedPath: 'x' });
  });

  it('enqueueReportParseJob rejects structured_import versions with 422 before any job insert', async () => {
    installSingleReportScenario(STRUCTURED_VERSION_ROW, 999);

    const result = await enqueueReportParseJob({ reportId: 1, allowedRegionIds: null });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected guard rejection, got ok result');
    }
    expect(result.statusCode).toBe(422);
    expect(result.error).toBe(STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN);
    expect(result.versionId).toBe(55);
    expect(result.message).toContain('本地结构化材料包');
    expect(insertIntoJobsCalls()).toHaveLength(0);
    expect(mockedCreateLlmProvider).not.toHaveBeenCalled();
  });

  it('still enqueues exactly one parse job for ai_parse versions', async () => {
    installSingleReportScenario(AI_PARSE_VERSION_ROW, 77);

    const result = await enqueueReportParseJob({ reportId: 1, allowedRegionIds: null });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`expected enqueue success, got ${result.error}`);
    }
    expect(result.versionId).toBe(55);
    expect(result.jobId).toBe(77);
    expect(result.status).toBe('queued');
    expect(result.reused).toBe(false);
    expect(insertIntoJobsCalls()).toHaveLength(1);
  });

  it('POST /reports/:id/parse returns HTTP 422 with the guard error for structured versions', async () => {
    installSingleReportScenario(STRUCTURED_VERSION_ROW, 999);

    const response = await request(buildApp()).post('/reports/1/parse');

    expect(response.status).toBe(422);
    expect(response.body.error).toBe(STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN);
    expect(response.body.message).toContain('本地结构化材料包');
    expect(insertIntoJobsCalls()).toHaveLength(0);
    expect(mockedCreateLlmProvider).not.toHaveBeenCalled();
  });

  it('POST /reports/batch-parse skips structured versions and still submits ai_parse reports', async () => {
    installBatchScenario();

    const response = await request(buildApp())
      .post('/reports/batch-parse')
      .send({ report_ids: [1, 2] });

    expect(response.status).toBe(200);
    expect(response.body.requested).toBe(2);
    expect(response.body.submitted).toBe(1);
    expect(response.body.skipped).toBe(1);
    expect(response.body.failed).toBe(0);
    expect(response.body.skipped_items).toHaveLength(1);
    expect(response.body.skipped_items[0]).toMatchObject({
      report_id: 1,
      report_version_id: 55,
      reason: STRUCTURED_VERSION_AI_REPARSE_FORBIDDEN,
    });
    expect(insertIntoJobsCalls()).toHaveLength(1);
    expect(mockedCreateLlmProvider).not.toHaveBeenCalled();
  });
});
