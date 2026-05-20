import { getRouteForPath } from './routeRegistry';

export function resolveSafeReturnTo(search, fallback) {
  const safeFallback = fallback || '/catalog';
  const params = new URLSearchParams(search || '');
  const raw = params.get('returnTo');

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

export function resolveRouteReturnTo(search, pathname, fallback) {
  const routeFallback = fallback || getRouteForPath(pathname)?.fallbackReturnTo || '/catalog';
  return resolveSafeReturnTo(search, routeFallback);
}
