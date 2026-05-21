import { buildCatalogReturnPath } from './CityIndex';

describe('buildCatalogReturnPath', () => {
  test('preserves the current catalog hierarchy as a return target', () => {
    expect(buildCatalogReturnPath([12, '34'], '?tab=all')).toBe('/catalog?tab=all&region=12%2C34');
  });

  test('drops stale region when returning from the root catalog layer', () => {
    expect(buildCatalogReturnPath([], '?region=12%2C34&tab=all')).toBe('/catalog?tab=all');
  });

  test('does not carry nested returnTo parameters back into catalog links', () => {
    expect(buildCatalogReturnPath([12], '?returnTo=%2Fjobs&tab=all')).toBe('/catalog?tab=all&region=12');
  });
});
