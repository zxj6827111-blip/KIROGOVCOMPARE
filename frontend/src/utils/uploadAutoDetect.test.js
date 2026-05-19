import {
  extractRegionFromFilename,
  extractUnitNameFromText,
  extractYearFromFilename,
  extractYearFromText,
  stripCommonUnitSuffix,
} from './uploadAutoDetect';

describe('uploadAutoDetect', () => {
  test('extracts year and region from filename when present', () => {
    expect(extractYearFromFilename('淮安市洪泽区人民政府2025年年报.pdf')).toBe(2025);
    expect(extractRegionFromFilename('淮安市洪泽区人民政府2025年年报.pdf')).toBe('淮安市洪泽区');
  });

  test('extracts unit name from first-page text for annual report pdf', () => {
    const text =
      '淮安市洪泽区人民政府 2025 年政府信息公开工作年度报告 根据《中华人民共和国政府信息公开条例》规定，现公布淮安市洪泽区人民政府 2025 年政府信息公开工作年度报告。';

    expect(extractUnitNameFromText(text)).toBe('淮安市洪泽区人民政府');
    expect(extractYearFromText(text)).toBe(2025);
  });

  test('normalizes common suffixes for region matching', () => {
    expect(stripCommonUnitSuffix('淮安市洪泽区人民政府')).toBe('淮安市洪泽区');
    expect(stripCommonUnitSuffix('淮安市洪泽区教育局')).toBe('淮安市洪泽区');
  });
});
