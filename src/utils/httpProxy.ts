import { Dispatcher, fetch as undiciFetch, ProxyAgent } from 'undici';

const dispatcherCache = new Map<string, Dispatcher>();

function normalizeProxyUrl(raw: string | undefined): string {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }

  if (/^[a-z]+:\/\//i.test(value)) {
    return value;
  }

  return `http://${value}`;
}

export function resolveProxyUrl(envNames: string[]): string {
  for (const envName of envNames) {
    const value = normalizeProxyUrl(process.env[envName]);
    if (value) {
      return value;
    }
  }

  return '';
}

export function sanitizeProxyUrlForLog(proxyUrl: string): string {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '***' : '';
      parsed.password = parsed.password ? '***' : '';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

export function getProxyDispatcher(proxyUrl: string): Dispatcher | undefined {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) {
    return undefined;
  }

  const cached = dispatcherCache.get(normalized);
  if (cached) {
    return cached;
  }

  const dispatcher = new ProxyAgent(normalized);
  dispatcherCache.set(normalized, dispatcher);
  return dispatcher;
}

export function fetchWithDispatcher(input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) {
  return undiciFetch(input, init);
}
