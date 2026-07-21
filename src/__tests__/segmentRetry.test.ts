import {
  isSegmentTransientError,
  resolveSegmentRetryAttempts,
  runSegmentWithRetries,
} from '../utils/segmentRetry';
import { LlmProviderError } from '../services/LlmProvider';

describe('segmentRetry', () => {
  it('classifies timeout / empty / 524 as transient', () => {
    expect(isSegmentTransientError(new LlmProviderError('t', 'openai_timeout')).retryable).toBe(true);
    expect(isSegmentTransientError(new LlmProviderError('e', 'openai_empty_response')).retryable).toBe(true);
    expect(isSegmentTransientError({ status: 524, message: 'timeout' }).retryable).toBe(true);
    expect(isSegmentTransientError(new LlmProviderError('auth', 'openai_auth_failed')).retryable).toBe(false);
  });

  it('defaults segment attempts to 2 and clamps', () => {
    expect(resolveSegmentRetryAttempts({} as NodeJS.ProcessEnv)).toBe(2);
    expect(resolveSegmentRetryAttempts({ LLM_PARSE_SEGMENT_RETRY_ATTEMPTS: '3' } as NodeJS.ProcessEnv)).toBe(3);
    expect(resolveSegmentRetryAttempts({ LLM_PARSE_SEGMENT_RETRY_ATTEMPTS: '99' } as NodeJS.ProcessEnv)).toBe(4);
  });

  it('retries only the failing segment and keeps success path', async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await runSegmentWithRetries(
      'segmented_table_4',
      async () => {
        calls += 1;
        if (calls < 2) {
          throw new LlmProviderError('empty', 'openai_empty_response');
        }
        return { ok: true, n: calls };
      },
      {
        attempts: 3,
        baseDelayMs: 10,
        wait: async (ms) => {
          waits.push(ms);
        },
      }
    );

    expect(result).toEqual({ ok: true, n: 2 });
    expect(calls).toBe(2);
    expect(waits.length).toBe(1);
  });

  it('does not retry permanent auth failures', async () => {
    let calls = 0;
    await expect(
      runSegmentWithRetries(
        'segmented_table_2',
        async () => {
          calls += 1;
          throw new LlmProviderError('bad key', 'openai_auth_failed');
        },
        { attempts: 3, wait: async () => undefined }
      )
    ).rejects.toMatchObject({ code: 'openai_auth_failed' });
    expect(calls).toBe(1);
  });
});
