import { resolveRouteReturnTo, resolveSafeReturnTo } from './returnTo';

describe('resolveSafeReturnTo', () => {
  test('accepts /catalog', () => {
    expect(resolveSafeReturnTo('?returnTo=%2Fcatalog', '/fallback')).toBe('/catalog');
  });

  test('accepts /history?page=1', () => {
    expect(resolveSafeReturnTo('?returnTo=%2Fhistory%3Fpage%3D1', '/fallback')).toBe('/history?page=1');
  });

  test('rejects full external URL', () => {
    expect(resolveSafeReturnTo('?returnTo=https%3A%2F%2Fevil.com', '/fallback')).toBe('/fallback');
  });

  test('rejects protocol relative URL', () => {
    expect(resolveSafeReturnTo('?returnTo=%2F%2Fevil.com', '/fallback')).toBe('/fallback');
  });

  test('rejects backslash path', () => {
    expect(resolveSafeReturnTo('?returnTo=%5Cevil', '/fallback')).toBe('/fallback');
  });

  test('rejects print route', () => {
    expect(resolveSafeReturnTo('?returnTo=%2Fprint%2Fcomparison%2F4670', '/fallback')).toBe('/fallback');
  });

  test('rejects empty value', () => {
    expect(resolveSafeReturnTo('?returnTo=', '/fallback')).toBe('/fallback');
  });

  test('rejects encoded external link', () => {
    expect(resolveSafeReturnTo('?returnTo=https%253A%252F%252Fevil.com', '/fallback')).toBe('/fallback');
  });

  test('uses fallback when returnTo is missing', () => {
    expect(resolveSafeReturnTo('', '/fallback')).toBe('/fallback');
  });
});

describe('resolveRouteReturnTo', () => {
  test('uses query returnTo before route fallback', () => {
    expect(resolveRouteReturnTo('?returnTo=%2Fcatalog%3Fregion%3D1%252C2', '/catalog/reports/9001', '/catalog')).toBe('/catalog?region=1,2');
  });

  test('uses location state when query returnTo is missing', () => {
    expect(resolveRouteReturnTo('', '/datacenter/reports/9001', '/datacenter', { returnTo: '/datacenter?status=success' })).toBe('/datacenter?status=success');
  });

  test('rejects unsafe location state values', () => {
    expect(resolveRouteReturnTo('', '/jobs/8001', '/jobs', { returnTo: 'https://evil.com' })).toBe('/jobs');
  });
});
