/**
 * Per-segment LLM call retries for annual-report segmented parse.
 * Keeps successful segments and only re-invokes the failing stage.
 */

export type SegmentRetryDecision = {
  retryable: boolean;
  reason?: string;
};

export function isSegmentTransientError(error: unknown): SegmentRetryDecision {
  if (!error) {
    return { retryable: false, reason: 'empty_error' };
  }

  const anyErr = error as { code?: string; status?: number; message?: string; name?: string };
  const code = String(anyErr.code || '').toLowerCase();
  const message = String(anyErr.message || '').toLowerCase();
  const status = Number(anyErr.status || 0);

  // Permanent / structural — do not burn segment retries
  if (
    code === 'openai_auth_failed' ||
    code === 'invalid_request' ||
    code === 'openai_missing_base_url' ||
    code === 'source_file_missing'
  ) {
    return { retryable: false, reason: code };
  }

  if (status === 401 || status === 403 || status === 400) {
    return { retryable: false, reason: `http_${status}` };
  }

  if (
    code.includes('timeout') ||
    code.includes('empty_response') ||
    code.includes('http_error') ||
    code.includes('connection') ||
    code === 'timeout' ||
    code === 'network_error' ||
    code === 'econnreset' ||
    code === 'etimedout' ||
    code === 'econnaborted' ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('524') ||
    message.includes('empty') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    status === 524 ||
    status === 429 ||
    status >= 500
  ) {
    return { retryable: true, reason: code || message.slice(0, 40) || `http_${status}` };
  }

  // Invalid JSON from model is often worth one more try
  if (code === 'json_parse_error' || message.includes('invalid json')) {
    return { retryable: true, reason: 'json_parse_error' };
  }

  return { retryable: false, reason: code || 'unknown' };
}

export function resolveSegmentRetryAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LLM_PARSE_SEGMENT_RETRY_ATTEMPTS ?? env.OPENAI_SEGMENT_RETRY_ATTEMPTS ?? 2);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(4, Math.floor(raw));
}

export function resolveSegmentRetryBaseDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.LLM_PARSE_SEGMENT_RETRY_BASE_DELAY_MS ?? 1500);
  if (!Number.isFinite(raw) || raw < 0) return 1500;
  return Math.min(15000, Math.floor(raw));
}

export async function runSegmentWithRetries<T>(
  label: string,
  execute: () => Promise<T>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    signal?: AbortSignal;
    isRetryable?: (error: unknown) => SegmentRetryDecision;
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
    onRetry?: (info: { label: string; attempt: number; maxAttempts: number; error: unknown; delayMs: number }) => void;
  }
): Promise<T> {
  const maxAttempts = Math.max(1, options?.attempts ?? resolveSegmentRetryAttempts());
  const baseDelayMs = options?.baseDelayMs ?? resolveSegmentRetryBaseDelayMs();
  const isRetryable = options?.isRetryable ?? isSegmentTransientError;
  const wait =
    options?.wait ??
    (async (ms: number, signal?: AbortSignal) => {
      if (!ms) return;
      if (!signal) {
        await new Promise((r) => setTimeout(r, ms));
        return;
      }
      if (signal.aborted) {
        throw signal.reason || new Error('segment retry aborted');
      }
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(signal.reason || new Error('segment retry aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options?.signal?.aborted) {
      throw options.signal.reason || new Error(`${label} aborted`);
    }
    try {
      return await execute();
    } catch (error) {
      lastError = error;
      const decision = isRetryable(error);
      if (attempt >= maxAttempts || !decision.retryable) {
        throw error;
      }
      const delayMs = Math.min(8000, baseDelayMs * attempt);
      options?.onRetry?.({ label, attempt, maxAttempts, error, delayMs });
      await wait(delayMs, options?.signal);
    }
  }
  throw lastError;
}
