import {
  DEFAULT_PARSE_MAX_RETRIES,
  isNonRetryableJobErrorCode,
  isTransientJobErrorCode,
  isUserCancellationError,
  resolveParseMaxRetries,
  shouldAutomaticallyRetryJob,
} from '../utils/jobRetryPolicy';
import { STRUCTURED_PACKAGE_ERROR_CODES } from '../config/structuredPackage';

describe('jobRetryPolicy', () => {
  it('defaults parse max_retries to 2', () => {
    expect(resolveParseMaxRetries({} as NodeJS.ProcessEnv)).toBe(DEFAULT_PARSE_MAX_RETRIES);
    expect(resolveParseMaxRetries({ LLM_PARSE_MAX_RETRIES: '3' } as NodeJS.ProcessEnv)).toBe(3);
    expect(resolveParseMaxRetries({ LLM_PARSE_MAX_RETRIES: '-1' } as NodeJS.ProcessEnv)).toBe(
      DEFAULT_PARSE_MAX_RETRIES
    );
    expect(resolveParseMaxRetries({ LLM_PARSE_MAX_RETRIES: '99' } as NodeJS.ProcessEnv)).toBe(10);
  });

  it('marks permanent failures as non-retryable', () => {
    expect(isNonRetryableJobErrorCode('SOURCE_FILE_MISSING')).toBe(true);
    expect(isNonRetryableJobErrorCode('openai_auth_failed')).toBe(true);
    expect(isNonRetryableJobErrorCode('openai_timeout')).toBe(false);
  });

  it('treats timeout / empty / 524-style codes as transient', () => {
    expect(isTransientJobErrorCode('TIMEOUT')).toBe(true);
    expect(isTransientJobErrorCode('openai_timeout')).toBe(true);
    expect(isTransientJobErrorCode('openai_empty_response')).toBe(true);
    expect(isTransientJobErrorCode('NETWORK_ERROR')).toBe(true);
    expect(shouldAutomaticallyRetryJob({ kind: 'parse', errorCode: 'openai_timeout' })).toBe(true);
    expect(shouldAutomaticallyRetryJob({ kind: 'parse', errorCode: 'SOURCE_FILE_MISSING' })).toBe(false);
    expect(shouldAutomaticallyRetryJob({ kind: 'pdf_export', errorCode: 'TIMEOUT' })).toBe(false);
  });

  it('does not treat LLM timeout AbortError as user cancellation', () => {
    const timeoutAbort = new Error('OpenAI request timed out after 90000ms');
    timeoutAbort.name = 'AbortError';
    expect(isUserCancellationError(timeoutAbort)).toBe(false);

    const userCancel = new Error('User cancelled');
    userCancel.name = 'AbortError';
    expect(isUserCancellationError(userCancel)).toBe(true);

    expect(isUserCancellationError(new Error('canceled'))).toBe(true);
  });

  describe('structured_import error codes (deterministic, non-retryable)', () => {
    it('every STRUCTURED_PACKAGE_ERROR_CODES value is non-retryable', () => {
      for (const code of Object.values(STRUCTURED_PACKAGE_ERROR_CODES)) {
        expect(isNonRetryableJobErrorCode(code)).toBe(true);
      }
    });

    it('structured_import failures do not requeue regardless of job kind', () => {
      expect(shouldAutomaticallyRetryJob({ kind: 'structured_import', errorCode: 'PDF_HASH_MISMATCH' })).toBe(false);
      expect(shouldAutomaticallyRetryJob({ kind: 'structured_import', errorCode: 'ZIP_PATH_TRAVERSAL' })).toBe(false);
      expect(shouldAutomaticallyRetryJob({ kind: 'structured_import', errorCode: 'SCHEMA_VALIDATION_FAILED' })).toBe(false);
      // Sanity: unknown errors (no code) are still retryable when budgeted — preserves prior behavior
      expect(shouldAutomaticallyRetryJob({ kind: 'structured_import', errorCode: undefined })).toBe(true);
    });
  });
});
