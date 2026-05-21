import { getRouteForPath } from './routeRegistry';

export function resolveSafeReturnPath(value, fallback) {
  const safeFallback = fallback || '/catalog';
  const raw = value;

  if (!raw) return safeFallback;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return safeFallback;
  }

  const trimmed = decoded.trim();
  if (!trimmed) return safeFallback;
  if (!trimmed.startsWith('/')) return safeFallback;
  if (trimmed.startsWith('//')) return safeFallback;
  if (trimmed.includes('\\')) return safeFallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return safeFallback;

  let parsed;
  try {
    parsed = new URL(trimmed, window.location.origin);
  } catch {
    return safeFallback;
  }

  if (parsed.origin !== window.location.origin) return safeFallback;
  if (parsed.pathname.startsWith('/print/')) return safeFallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function resolveSafeReturnTo(search, fallback) {
  const params = new URLSearchParams(search || '');
  return resolveSafeReturnPath(params.get('returnTo'), fallback);
}

export function resolveRouteReturnTo(search, pathname, fallback, state) {
  const routeFallback = fallback || getRouteForPath(pathname)?.fallbackReturnTo || '/catalog';
  const params = new URLSearchParams(search || '');
  const queryReturnTo = params.get('returnTo');

  if (queryReturnTo) {
    return resolveSafeReturnPath(queryReturnTo, routeFallback);
  }

  return resolveSafeReturnPath(state?.returnTo || state?.from, routeFallback);
}
