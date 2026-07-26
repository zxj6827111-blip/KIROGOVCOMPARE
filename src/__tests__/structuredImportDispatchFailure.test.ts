/**
 * Failure-path coverage for structured_import dispatch in the real worker:
 *   - StructuredPackageError.code must be preserved on the job row
 *   - Deterministic import errors must NOT trigger automatic requeue
 *   - step_code/step_name must not be labelled as "AI parsing"
 *
 * Goes through LlmJobRunner.processNextQueuedJob (claim + process + failure)
 * with mocked DB pool and mocked runStructuredImportJob that throws.
 */
import { StructuredPackageError, STRUCTURED_PACKAGE_ERROR_CODES } from '../config/structuredPackage';

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

// Mock the structured import worker entry so we can force failures without
// touching the LLM factory. The real wiring (runStructuredImportJob, no LLM)
// is covered by structuredImportExecuteJob.test.ts.
jest.mock('../services/structured-import/runStructuredImportJob', () => ({
  __esModule: true,
  runStructuredImportJob: jest.fn(),
}));

// Hide background ticker side effects (scheduleNextTick etc.) — not strictly
// required because processNextQueuedJob never starts the loop, but cheap.
jest.mock('../services/ParseConsensusService', () => ({
  parseConsensusService: { resolveConsensus: jest.fn() },
}));

import pool from '../config/database-llm';
import { runStructuredImportJob } from '../services/structured-import/runStructuredImportJob';
import { LlmJobRunner } from '../services/LlmJobRunner';

const mockedQuery = pool.query as jest.Mock;
const mockedRun = runStructuredImportJob as jest.Mock;

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 501,
    report_id: 3,
    version_id: 9,
    kind: 'structured_import',
    comparison_id: null,
    retry_count: 0,
    max_retries: 1,
    provider: 'structured_import',
    model: 'none',
    ...overrides,
  };
}

function setClaimScenario(row: Record<string, unknown> | null) {
  mockedQuery.mockImplementation(async (sql: string, params?: any[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    // claimNextJob does a CTE UPDATE ... RETURNING
    if (/WITH next_job AS \( .* UPDATE jobs j/.test(s) || (s.startsWith('WITH next_job AS') && s.includes('UPDATE jobs j'))) {
      if (!row) return { rows: [] };
      // claimNextJob marks running and returns the row. Echo the id/kind we want.
      return { rows: [row] };
    }
    // handleJobFailure: SELECT previous error_message
    if (s.startsWith('SELECT error_message FROM jobs WHERE id')) {
      return { rows: [{ error_message: null }] };
    }
    // handleJobFailure failure UPDATE (either non-retryable path or final path)
    if (s.startsWith('UPDATE jobs') && s.includes("SET status = 'failed'")) {
      return { rows: [] };
    }
    // generateNotificationIfNeeded queries — return empty so no notifications
    if (s.includes('FROM notifications') || s.includes('INSERT INTO notifications')) {
      return { rows: [] };
    }
    if (s.includes('FROM report_versions') || s.includes('FROM reports')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

describe('LlmJobRunner structured_import dispatch failure handling', () => {
  let runner: LlmJobRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new LlmJobRunner();
  });

  it('preserves StructuredPackageError.code on the failed job row and does not requeue', async () => {
    setClaimScenario(jobRow());
    mockedRun.mockRejectedValueOnce(
      new StructuredPackageError(
        STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH,
        'source.pdf SHA256 mismatch on worker re-verify'
      )
    );

    const id = await runner.processNextQueuedJob();
    expect(id).toBe(501);
    expect(mockedRun).toHaveBeenCalledTimes(1);

    // Find the capture for the failure UPDATE
    const updateCalls = mockedQuery.mock.calls.filter(([sql]: any[]) => {
      const s = String(sql || '').replace(/\s+/g, ' ').trim();
      return s.startsWith('UPDATE jobs') && s.includes("status = 'failed'");
    });
    expect(updateCalls.length).toBe(1);
    const [params] = updateCalls[0].slice(1);
    // First param MUST be the StructuredPackageError.code, not UNKNOWN_ERROR
    expect(params[0]).toBe(STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH);
    expect(String(params[1] || '')).toContain('source.pdf SHA256');
    // No requeue UPDATE ("SET status = 'queued'") should have been issued
    const requeueCalls = mockedQuery.mock.calls.filter(([sql]: any[]) => {
      const s = String(sql || '').replace(/\s+/g, ' ').trim();
      return s.startsWith('UPDATE jobs') && s.includes("status = 'queued'");
    });
    expect(requeueCalls.length).toBe(0);
  });

  it('labels claimed structured_import job with structured_import step, not "AI parsing"', async () => {
    setClaimScenario(jobRow());
    mockedRun.mockResolvedValueOnce(undefined);
    const id = await runner.processNextQueuedJob();
    expect(id).toBe(501);
    const claimCall = mockedQuery.mock.calls.find(([sql]: any[]) =>
      String(sql || '').includes('UPDATE jobs j') && String(sql || '').includes('next_job')
    );
    expect(claimCall).toBeTruthy();
    const claimSql = String(claimCall![0]);
    expect(claimSql).toMatch(/WHEN 'structured_import' THEN 'POSTPROCESS'/);
    expect(claimSql).toMatch(/WHEN 'structured_import' THEN 'structured_import running'/);
    expect(claimSql).toMatch(/WHEN 'structured_import' THEN 80/);
    // AI parsing branch must still exist for parse kind
    expect(claimSql).toMatch(/WHEN 'parse' THEN 'PARSING'/);
  });

  it('does not requeue ZIP_BOMB / SCHEMA_VALIDATION_FAILED / ZIP_PATH_TRAVERSAL / ZIP_CORRUPT either', async () => {
    for (const code of [
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_BOMB,
      STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL,
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_CORRUPT,
    ] as const) {
      jest.clearAllMocks();
      setClaimScenario(jobRow());
      mockedRun.mockRejectedValueOnce(new StructuredPackageError(code as any, 'audit: ' + code));
      await runner.processNextQueuedJob().catch(() => undefined);
      const requeueCalls = mockedQuery.mock.calls.filter(([sql]: any[]) => {
        const s = String(sql || '').replace(/\s+/g, ' ').trim();
        return s.startsWith('UPDATE jobs') && s.includes("status = 'queued'");
      });
      expect(requeueCalls).toHaveLength(0);
      const failedCall = mockedQuery.mock.calls.find(([sql]: any[]) =>
        String(sql || '').replace(/\s+/g, ' ').trim().startsWith('UPDATE jobs SET status = \'failed\'') ||
        (String(sql || '').startsWith('UPDATE jobs') && String(sql || '').includes("status = 'failed'"))
      );
      expect(failedCall).toBeTruthy();
      const params = failedCall![1] as any[];
      expect(params[0]).toBe(code);
    }
  });
});
