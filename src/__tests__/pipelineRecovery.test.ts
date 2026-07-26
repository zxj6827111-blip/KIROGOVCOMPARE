/**
 * Unit tests for PipelineRecoveryService downstream recovery:
 *   - recoverVersionDownstream requeues ONLY the failed/missing downstream job
 *     (materialize / checks) once the parse stage (parse OR structured_import)
 *     succeeded, and never re-runs the parse stage or creates AI parse jobs;
 *   - active core jobs block recovery, non-core jobs (vision_review, compare)
 *     do not;
 *   - ensureDownstreamJob is idempotent (reuses active jobs) and resolves
 *     23505 unique-index races by returning the concurrent winner;
 *   - the LLM provider factory is never touched (structured_import channel
 *     stays LLM-free).
 *
 * DB pool is fully mocked; SQL is dispatched on normalized text, in the same
 * style as structuredImportDispatchFailure.test.ts.
 */

jest.mock('../config/database-llm', () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

// Regression guard: pipeline recovery must never construct an LLM provider.
jest.mock('../services/LlmProviderFactory', () => ({
  __esModule: true,
  createLlmProvider: jest.fn(() => {
    throw new Error('must not');
  }),
}));

import pool from '../config/database-llm';
import { createLlmProvider } from '../services/LlmProviderFactory';
import {
  ensureDownstreamJob,
  recoverVersionDownstream,
} from '../services/PipelineRecoveryService';

const mockedQuery = pool.query as jest.Mock;
const mockedCreateLlmProvider = createLlmProvider as jest.Mock;

type JobRow = {
  id: number;
  report_id: number | null;
  version_id: number | null;
  kind: string;
  status: string;
};

function job(id: number, kind: string, status: string): JobRow {
  return { id, report_id: 3, version_id: 9, kind, status };
}

function norm(sql: unknown): string {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

type Scenario = {
  /** Rows returned by the version-wide jobs SELECT in recoverVersionDownstream. */
  jobs?: JobRow[];
  /**
   * Successive responses for ensureDownstreamJob's active-job SELECT
   * (status IN ('queued', 'running')). The last entry repeats once the list
   * is exhausted. Defaults to always-empty.
   */
  active?: Array<Array<{ id: number }>>;
  /** Override for INSERT INTO jobs; may throw. Defaults to { id: 99 }. */
  insert?: () => { rows: Array<{ id: number }> };
};

function setScenario(scenario: Scenario = {}): void {
  const activeResponses = scenario.active ? [...scenario.active] : [];
  mockedQuery.mockImplementation(async (sql: string) => {
    const s = norm(sql);
    // ensureDownstreamJob.findActive - must be matched before the generic
    // "FROM jobs WHERE version_id" branch because it contains that text too.
    if (s.includes('FROM jobs') && s.includes("status IN ('queued', 'running')")) {
      const rows =
        activeResponses.length > 1 ? activeResponses.shift()! : activeResponses[0] ?? [];
      return { rows };
    }
    // recoverVersionDownstream - full job list for the version.
    if (s.includes('FROM jobs WHERE version_id')) {
      return { rows: scenario.jobs ?? [] };
    }
    if (s.includes('FROM report_versions')) {
      return { rows: [{ ingestion_batch_id: null }] };
    }
    if (s.startsWith('INSERT INTO jobs')) {
      if (scenario.insert) return scenario.insert();
      return { rows: [{ id: 99 }] };
    }
    return { rows: [] };
  });
}

function setJobs(rows: JobRow[], scenario: Omit<Scenario, 'jobs'> = {}): void {
  setScenario({ ...scenario, jobs: rows });
}

function insertCalls(): unknown[][] {
  return mockedQuery.mock.calls.filter(([sql]: unknown[]) =>
    norm(sql).startsWith('INSERT INTO jobs')
  );
}

function parseInsertCalls(): unknown[][] {
  return mockedQuery.mock.calls.filter(([sql]: unknown[]) => {
    const s = norm(sql);
    return s.includes('INSERT') && s.includes("'parse'");
  });
}

describe('PipelineRecoveryService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Applies to every case: recovery must never touch the LLM factory.
    expect(mockedCreateLlmProvider).not.toHaveBeenCalled();
  });

  describe('recoverVersionDownstream', () => {
    it('requeues materialize when structured_import succeeded and materialize failed', async () => {
      setJobs([job(1, 'structured_import', 'succeeded'), job(2, 'materialize', 'failed')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      const inserts = insertCalls();
      expect(inserts).toHaveLength(1);
      expect(norm(inserts[0][0])).toContain("'materialize'");
      // No AI parse job may ever be created by recovery.
      expect(parseInsertCalls()).toHaveLength(0);
    });

    it('requeues checks when materialize succeeded and checks failed', async () => {
      setJobs([
        job(1, 'structured_import', 'succeeded'),
        job(2, 'materialize', 'succeeded'),
        job(3, 'checks', 'failed'),
      ]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({ action: 'requeued', kind: 'checks', jobId: 99, reused: false });
      const inserts = insertCalls();
      expect(inserts).toHaveLength(1);
      expect(norm(inserts[0][0])).toContain("'checks'");
      expect(parseInsertCalls()).toHaveLength(0);
    });

    it('returns nothing_to_retry when import, materialize and checks all succeeded', async () => {
      setJobs([
        job(1, 'structured_import', 'succeeded'),
        job(2, 'materialize', 'succeeded'),
        job(3, 'checks', 'succeeded'),
      ]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({ action: 'none', reason: 'nothing_to_retry' });
      expect(insertCalls()).toHaveLength(0);
    });

    it('returns upstream_failed when only structured_import exists and it failed', async () => {
      setJobs([job(1, 'structured_import', 'failed')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({ action: 'none', reason: 'upstream_failed' });
      expect(insertCalls()).toHaveLength(0);
    });

    it('returns jobs_in_progress when a core job is still queued', async () => {
      setJobs([job(1, 'structured_import', 'succeeded'), job(2, 'materialize', 'queued')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({ action: 'none', reason: 'jobs_in_progress' });
      expect(insertCalls()).toHaveLength(0);
    });

    it('ignores active non-core jobs (vision_review, compare) when requeueing materialize', async () => {
      setJobs([
        job(1, 'structured_import', 'succeeded'),
        job(2, 'materialize', 'failed'),
        job(3, 'vision_review', 'queued'),
        job(4, 'compare', 'queued'),
      ]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      const inserts = insertCalls();
      expect(inserts).toHaveLength(1);
      expect(norm(inserts[0][0])).toContain("'materialize'");
    });

    it('also recovers ai-parse versions: parse succeeded and materialize failed', async () => {
      setJobs([job(1, 'parse', 'succeeded'), job(2, 'materialize', 'failed')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      expect(insertCalls()).toHaveLength(1);
      expect(parseInsertCalls()).toHaveLength(0);
    });

    it('requeues materialize when it was never enqueued (crash window after import)', async () => {
      setJobs([job(1, 'structured_import', 'succeeded')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      const inserts = insertCalls();
      expect(inserts).toHaveLength(1);
      expect(norm(inserts[0][0])).toContain("'materialize'");
    });

    it('judges by the latest job per kind: newest materialize failed after an older success', async () => {
      setJobs([
        job(1, 'structured_import', 'succeeded'),
        job(2, 'materialize', 'succeeded'),
        job(3, 'materialize', 'failed'),
      ]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      expect(insertCalls()).toHaveLength(1);
    });

    it('treats cancelled like failed: cancelled materialize is requeued', async () => {
      setJobs([job(1, 'structured_import', 'succeeded'), job(2, 'materialize', 'cancelled')]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({
        action: 'requeued',
        kind: 'materialize',
        jobId: 99,
        reused: false,
      });
      expect(insertCalls()).toHaveLength(1);
    });

    it('never calls the LLM provider factory while recovering', async () => {
      setJobs([job(1, 'structured_import', 'succeeded'), job(2, 'materialize', 'failed')]);

      await recoverVersionDownstream(9);

      expect(mockedCreateLlmProvider).not.toHaveBeenCalled();
    });

    it('returns no_jobs for an empty job list', async () => {
      setJobs([]);

      const result = await recoverVersionDownstream(9);

      expect(result).toEqual({ action: 'none', reason: 'no_jobs' });
      expect(insertCalls()).toHaveLength(0);
    });
  });

  describe('ensureDownstreamJob', () => {
    it('is idempotent: reuses an active materialize job without inserting', async () => {
      setScenario({ active: [[{ id: 31 }]] });

      const result = await ensureDownstreamJob(3, 9, 'materialize');

      expect(result).toEqual({ action: 'requeued', kind: 'materialize', jobId: 31, reused: true });
      expect(insertCalls()).toHaveLength(0);
    });

    it('resolves a 23505 unique violation by returning the concurrent winner', async () => {
      setScenario({
        active: [[], [{ id: 32 }]],
        insert: () => {
          throw Object.assign(new Error('dup'), { code: '23505' });
        },
      });

      const result = await ensureDownstreamJob(3, 9, 'materialize');

      expect(result).toEqual({ action: 'requeued', kind: 'materialize', jobId: 32, reused: true });
    });

    it('throws pipeline_recovery_conflict when 23505 has no visible winner', async () => {
      setScenario({
        active: [[]],
        insert: () => {
          throw Object.assign(new Error('dup'), { code: '23505' });
        },
      });

      await expect(ensureDownstreamJob(3, 9, 'materialize')).rejects.toThrow(
        /pipeline_recovery_conflict/
      );
    });
  });
});
