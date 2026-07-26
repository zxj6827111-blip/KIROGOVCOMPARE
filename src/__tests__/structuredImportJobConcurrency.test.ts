/**
 * ensureStructuredImportJob: concurrency-safe ensure of the structured_import job.
 * Covers queued/running reuse, succeeded reuse (+ best-effort downstream heal),
 * fresh INSERT, and 23505 unique-violation convergence onto the concurrent
 * winner instead of creating a second active job.
 */
jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/PipelineRecoveryService', () => ({
  recoverVersionDownstream: jest
    .fn()
    .mockResolvedValue({ action: 'none', reason: 'nothing_to_retry' }),
}));

jest.mock('../services/ParseRunService', () => ({
  buildParseConfigSnapshot: jest.fn((x) => x),
  parseRunService: {},
}));

import pool from '../config/database-llm';
import { recoverVersionDownstream } from '../services/PipelineRecoveryService';
import { ensureStructuredImportJob } from '../services/structured-import/StructuredImportService';

const mockedQuery = pool.query as jest.Mock;
const mockedRecover = recoverVersionDownstream as jest.Mock;

const REPORT_ID = 3;
const VERSION_ID = 42;

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function isFindReusableSelect(sql: string): boolean {
  return (
    sql.includes('SELECT id, status FROM jobs') &&
    sql.includes("kind = 'structured_import'") &&
    sql.includes('ORDER BY id DESC LIMIT 1')
  );
}

function isInsertStructuredImportJob(sql: string): boolean {
  return sql.includes('INSERT INTO jobs') && sql.includes("'structured_import', 'queued'");
}

function insertCallCount(): number {
  return mockedQuery.mock.calls.filter(([sql]) =>
    isInsertStructuredImportJob(normalizeSql(sql))
  ).length;
}

function selectCallCount(): number {
  return mockedQuery.mock.calls.filter(([sql]) =>
    isFindReusableSelect(normalizeSql(sql))
  ).length;
}

interface QueryScript {
  /** Sequential results for the findReusable SELECT; extra SELECTs throw. */
  selectResults: Array<{ rows: any[] }>;
  /** Handler for the INSERT ... RETURNING id; omit when no INSERT is expected. */
  insert?: () => { rows: any[] };
}

function installQueryScript(script: QueryScript): void {
  let selectIndex = 0;
  mockedQuery.mockImplementation(async (sql: string) => {
    const norm = normalizeSql(sql);
    if (isFindReusableSelect(norm)) {
      if (selectIndex >= script.selectResults.length) {
        throw new Error(`unexpected extra findReusable SELECT (#${selectIndex + 1})`);
      }
      const result = script.selectResults[selectIndex];
      selectIndex += 1;
      return result;
    }
    if (isInsertStructuredImportJob(norm)) {
      if (!script.insert) {
        throw new Error(`unexpected INSERT INTO jobs: ${norm}`);
      }
      return script.insert();
    }
    throw new Error(`unexpected SQL in ensureStructuredImportJob test: ${norm}`);
  });
}

function unique23505Error(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  });
}

describe('ensureStructuredImportJob concurrency behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('inserts a fresh queued job when no reusable job exists', async () => {
    installQueryScript({
      selectResults: [{ rows: [] }],
      insert: () => ({ rows: [{ id: 11 }] }),
    });

    const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID);

    expect(result).toEqual({ jobId: 11, reusedJob: false, status: 'queued' });
    expect(insertCallCount()).toBe(1);
    expect(mockedRecover).not.toHaveBeenCalled();
  });

  it('reuses an existing queued job without INSERT or downstream heal', async () => {
    installQueryScript({
      selectResults: [{ rows: [{ id: 5, status: 'queued' }] }],
    });

    const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID);

    expect(result).toEqual({ jobId: 5, reusedJob: true, status: 'queued' });
    expect(insertCallCount()).toBe(0);
    expect(mockedRecover).not.toHaveBeenCalled();
  });

  it('reuses a succeeded job by default and triggers the downstream heal hook once', async () => {
    installQueryScript({
      selectResults: [{ rows: [{ id: 6, status: 'succeeded' }] }],
    });

    const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID);

    expect(result).toEqual({ jobId: 6, reusedJob: true, status: 'succeeded' });
    expect(insertCallCount()).toBe(0);
    expect(mockedRecover).toHaveBeenCalledTimes(1);
    expect(mockedRecover).toHaveBeenCalledWith(VERSION_ID);
  });

  it('inserts a fresh job when allowReuseSucceeded=false despite a succeeded job', async () => {
    installQueryScript({
      selectResults: [{ rows: [{ id: 6, status: 'succeeded' }] }],
      insert: () => ({ rows: [{ id: 12 }] }),
    });

    const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID, false);

    expect(result).toEqual({ jobId: 12, reusedJob: false, status: 'queued' });
    expect(insertCallCount()).toBe(1);
    expect(mockedRecover).not.toHaveBeenCalled();
  });

  it('converges onto the concurrent winner after a 23505 unique violation', async () => {
    installQueryScript({
      selectResults: [{ rows: [] }, { rows: [{ id: 9, status: 'queued' }] }],
      insert: () => {
        throw unique23505Error();
      },
    });

    const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID);

    expect(result).toEqual({ jobId: 9, reusedJob: true, status: 'queued' });
    // Exactly one INSERT attempt: unique index + re-check converges,
    // no second active job is ever created.
    expect(insertCallCount()).toBe(1);
    expect(selectCallCount()).toBe(2);
    expect(mockedRecover).not.toHaveBeenCalled();
  });

  it('throws an explicit conflict error when the 23505 re-check finds nothing', async () => {
    installQueryScript({
      selectResults: [{ rows: [] }, { rows: [] }],
      insert: () => {
        throw unique23505Error();
      },
    });

    await expect(ensureStructuredImportJob(REPORT_ID, VERSION_ID)).rejects.toThrow(
      /structured_import job conflict/
    );
    expect(insertCallCount()).toBe(1);
    expect(selectCallCount()).toBe(2);
  });

  it('still reuses the succeeded job when the downstream heal hook fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      mockedRecover.mockRejectedValueOnce(new Error('boom'));
      installQueryScript({
        selectResults: [{ rows: [{ id: 6, status: 'succeeded' }] }],
      });

      const result = await ensureStructuredImportJob(REPORT_ID, VERSION_ID);

      expect(result).toEqual({ jobId: 6, reusedJob: true, status: 'succeeded' });
      expect(mockedRecover).toHaveBeenCalledTimes(1);
      expect(insertCallCount()).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
