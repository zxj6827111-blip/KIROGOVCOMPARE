const GOVINSIGHT_BASE_PATH = '/govinsight';

export function normalizeGovInsightSubPath(pathname) {
  if (!pathname || pathname === GOVINSIGHT_BASE_PATH) return '/';
  if (!pathname.startsWith(`${GOVINSIGHT_BASE_PATH}/`)) return pathname || '/';

  const subPath = pathname.slice(GOVINSIGHT_BASE_PATH.length);
  return subPath || '/';
}

export function toGovInsightPath(subPath = '/') {
  const normalized = subPath.startsWith('/') ? subPath : `/${subPath}`;
  if (normalized === '/') return GOVINSIGHT_BASE_PATH;
  return `${GOVINSIGHT_BASE_PATH}${normalized}`;
}

export function resolveGovInsightLegacyHash(pathname, hash) {
  if (pathname !== GOVINSIGHT_BASE_PATH && !pathname.startsWith(`${GOVINSIGHT_BASE_PATH}/`)) {
    return '';
  }

  if (!hash || !hash.startsWith('#/')) return '';

  const hashPath = hash.slice(1);
  const [rawPath, rawQuery = ''] = hashPath.split('?');
  const normalizedPath = rawPath === '/' ? '' : rawPath.replace(/\/+$/, '');
  const query = rawQuery ? `?${rawQuery}` : '';

  return `${toGovInsightPath(normalizedPath || '/')}${query}`;
}
