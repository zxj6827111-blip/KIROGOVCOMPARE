import {
  normalizeGovInsightSubPath,
  resolveGovInsightLegacyHash,
  toGovInsightPath,
} from './govInsightRoutes';
import { getRouteForPath, NAV_GROUPS } from './routeRegistry';

describe('GovInsight route helpers', () => {
  test('converts legacy report hash to browser route', () => {
    expect(resolveGovInsightLegacyHash('/govinsight', '#/report')).toBe('/govinsight/report');
  });

  test('converts legacy leader cockpit hash to browser route', () => {
    expect(resolveGovInsightLegacyHash('/govinsight', '#/leader-cockpit')).toBe('/govinsight/leader-cockpit');
  });

  test('preserves query from legacy hash route', () => {
    expect(resolveGovInsightLegacyHash('/govinsight', '#/report?year=2025')).toBe('/govinsight/report?year=2025');
  });

  test('normalizes browser route to GovInsight sub path', () => {
    expect(normalizeGovInsightSubPath('/govinsight/report')).toBe('/report');
    expect(normalizeGovInsightSubPath('/govinsight')).toBe('/');
  });

  test('builds GovInsight browser paths', () => {
    expect(toGovInsightPath('/')).toBe('/govinsight');
    expect(toGovInsightPath('/report')).toBe('/govinsight/report');
  });

  test('keeps GovInsight routes in the GovInsight nav group', () => {
    expect(getRouteForPath('/govinsight/report').navGroup).toBe(NAV_GROUPS.GOVINSIGHT);
    expect(getRouteForPath('/govinsight/leader-cockpit').navGroup).toBe(NAV_GROUPS.GOVINSIGHT);
  });
});
