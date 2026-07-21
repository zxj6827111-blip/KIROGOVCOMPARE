/**
 * Shared retry policy for background jobs (especially annual-report parse).
 *
 * Upload historically set max_retries=0, so transient relay failures (524 / timeout /
 * empty response) failed the whole parse once. Defaults and helpers live here so
 * upload, re-parse, and manual retry stay consistent.
 */

/** How many automatic requeues after the first attempt. Default 2 => up to 3 total runs. */
export const DEFAULT_PARSE_MAX_RETRIES = 2;

const TRANSIENT_ERROR_CODES = new Set([
  'TIMEOUT',
  'NETWORK_ERROR',
  'UNKNOWN_ERROR',
  'openai_timeout',
  'openai_empty_response',
  'openai_http_error',
  'openai_request_error',
  'openai_connection_refused',
  'quota_exceeded',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);

/** Permanent / structural failures — do not burn automatic retries. */
const NON_RETRYABLE_ERROR_CODES = new Set([
  'SOURCE_FILE_MISSING',
  'MATERIALIZE_EMPTY_FACTS',
  'PARSED_JSON_EMPTY',
  'PARSE_EMPTY_OUTPUT',
  'PARSE_NOT_READY',
  'REPORT_NOT_FOUND',
  'VERSION_NOT_FOUND',
  'vision_channel_unavailable',
  'vision_provider_unsupported',
  'source_capture_failed',
  'openai_auth_failed',
  'openai_missing_base_url',
  'invalid_request',
  'PARSE_CONSENSUS_CONFIG_INVALID',
  'ANNUAL_REPORT_SEGMENT_VALIDATION_FAILED',
]);

function toBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

/**
 * Resolve parse job max_retries from env.
 * - LLM_PARSE_MAX_RETRIES takes precedence
 * - Clamped to 0..10
 */
export function resolveParseMaxRetries(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_PARSE_MAX_RETRIES;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_PARSE_MAX_RETRIES;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_PARSE_MAX_RETRIES;
  }
  return Math.min(10, Math.floor(n));
}

export function isNonRetryableJobErrorCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return NON_RETRYABLE_ERROR_CODES.has(String(code).trim());
}

/**
 * Transient provider / network failures that are worth automatic requeue.
 * Unknown codes default to retryable when max_retries remain (backward compatible).
 */
export function isTransientJobErrorCode(code: string | null | undefined): boolean {
  if (!code) return true;
  const normalized = String(code).trim();
  if (isNonRetryableJobErrorCode(normalized)) return false;
  if (TRANSIENT_ERROR_CODES.has(normalized)) return true;
  // HTTP-ish provider codes without permanent meaning → retry
  if (/timeout|network|empty_response|http_error|connection|524|429/i.test(normalized)) {
    return true;
  }
  // Default: allow retry when budget remains (same as historical behavior for generic Error)
  return true;
}

/**
 * User cancel must not be confused with request-scoped AbortError used for LLM timeouts.
 * OpenAI stages abort with "timed out" / timeout wording; cancelJob uses "User cancelled".
 */
export function isUserCancellationError(error: unknown, message?: string): boolean {
  const err = error as { name?: string; message?: string; code?: string; __CANCEL__?: boolean } | null | undefined;
  const reason =
    typeof error === 'object' && error && 'reason' in (error as object)
      ? String((error as { reason?: unknown }).reason ?? '')
      : '';
  const msg = String(message ?? err?.message ?? reason ?? '');
  const lower = msg.toLowerCase();

  // Timeouts / relay 524 are transient failures, never user cancel.
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('524')) {
    return false;
  }

  if (msg.includes('User cancelled') || msg.includes('用户手动取消')) {
    return true;
  }

  if (err && err.__CANCEL__) {
    return true;
  }

  if (lower === 'canceled' || lower === 'cancelled' || lower.includes('user cancelled')) {
    return true;
  }

  // AbortError alone is not enough (LLM stage timeouts also use AbortError).
  if (err?.name === 'AbortError') {
    return lower.includes('cancel');
  }

  return false;
}

/** Whether automatic requeue is allowed for this failure (ignoring retry budget). */
export function shouldAutomaticallyRetryJob(params: {
  kind: string;
  errorCode: string | null | undefined;
  /** When true, only parse/materialize/checks/vision use non-retryable set strictly. */
  strictTransientForParse?: boolean;
}): boolean {
  if (params.kind === 'pdf_export') {
    return false;
  }
  if (isNonRetryableJobErrorCode(params.errorCode)) {
    return false;
  }
  if (params.kind === 'parse' && params.strictTransientForParse !== false) {
    // Parse: still allow generic/transient; permanent already filtered
    return isTransientJobErrorCode(params.errorCode);
  }
  return true;
}

export function isParseRetryPolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return toBooleanEnv(env.LLM_PARSE_AUTO_RETRY_ENABLED, true);
}
