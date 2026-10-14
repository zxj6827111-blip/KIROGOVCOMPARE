import {
  parseUrlList,
  extractYearFromText,
  extractUnitNameFromTitle,
  matchRegionByUnitName,
} from '../services/filing/FilingBatchUrlImportService';

describe('FilingBatchUrlImport helpers', () => {
  it('parseUrlList dedupes and keeps http(s) only', () => {
    const list = parseUrlList(`
      https://www.xuhui.gov.cn/a
      https://www.xuhui.gov.cn/a
      http://example.com/b
      not-a-url
      ftp://x.com/c
      www.jiading.gov.cn/publicity/x
    `);
    expect(list).toEqual([
      'https://www.xuhui.gov.cn/a',
      'http://example.com/b',
      'https://www.jiading.gov.cn/publicity/x',
    ]);
  });

  it('extractYearFromText prefers report-like years', () => {
    expect(extractYearFromText('上海市徐汇区2025年政府信息公开工作年度报告')).toBe(2025);
    expect(extractYearFromText('无年份')).toBeNull();
  });

  it('extractUnitNameFromTitle strips report suffix', () => {
    expect(extractUnitNameFromTitle('上海市徐汇区2025年政府信息公开工作年度报告')).toBe('上海市徐汇区');
    expect(extractUnitNameFromTitle('奉贤区科学技术委员会政府信息公开工作年度报告')).toContain('奉贤');
  });

  it('matchRegionByUnitName scores exact and parent-aware names', () => {
    const regions = [
      { id: 1, name: '上海市', parent_id: null, level: 1 },
      { id: 2, name: '徐汇区', parent_id: 1, level: 3 },
      { id: 3, name: '徐汇区教育局', parent_id: 2, level: 4 },
      { id: 4, name: '静安区', parent_id: 1, level: 3 },
    ];
    const hit = matchRegionByUnitName('上海市徐汇区教育局', regions);
    expect(hit?.id).toBe(3);
    expect(hit!.score).toBeGreaterThan(40);

    const district = matchRegionByUnitName('徐汇区人民政府', regions);
    expect(district?.id).toBe(2);

    expect(matchRegionByUnitName('完全不存在的单位XYZ', regions)).toBeNull();
  });

  it('matchRegionByUnitName prefers the banner-level department over the banner itself', () => {
    const regions = [
      { id: 1, name: '内蒙古自治区', parent_id: null, level: 1 },
      { id: 2, name: '鄂尔多斯市', parent_id: 1, level: 2 },
      { id: 3, name: '伊金霍洛旗', parent_id: 2, level: 3 },
      { id: 4, name: '阿勒腾席热镇', parent_id: 3, level: 4 },
      { id: 5, name: '伊金霍洛旗财政局', parent_id: 3, level: 4 },
      { id: 6, name: '展旦召苏木', parent_id: 3, level: 4 },
    ];

    const hit = matchRegionByUnitName('伊金霍洛旗财政局', regions, {
      pageTitle: '2025年伊金霍洛旗财政局政府信息公开工作年度报告',
    });
    expect(hit?.id).toBe(5);

    const town = matchRegionByUnitName('展旦召苏木', regions, {
      pageTitle: '2025年伊金霍洛旗展旦召苏木政府信息公开工作年度报告',
    });
    expect(town?.id).toBe(6);
  });

  it('matchRegionByUnitName uses fengxian host to disambiguate same-named depts', () => {
    const regions = [
      { id: 1, name: '上海市', parent_id: null, level: 1 },
      { id: 10, name: '奉贤区', parent_id: 1, level: 2 },
      { id: 11, name: '区经济委员会', parent_id: 10, level: 3 },
      { id: 20, name: '江苏省', parent_id: null, level: 1 },
      { id: 21, name: '淮安市', parent_id: 20, level: 2 },
      { id: 22, name: '机关事务管理局', parent_id: 21, level: 3 },
      { id: 12, name: '机关事务管理局', parent_id: 10, level: 3 },
      { id: 30, name: '静安区', parent_id: 1, level: 2 },
      { id: 31, name: '区经济委员会', parent_id: 30, level: 3 },
    ];
    const jingwei = matchRegionByUnitName('奉贤区经济委员会', regions, {
      pageUrl: 'https://xxgk.fengxian.gov.cn/art/info/7195/x',
      pageTitle: '2025年奉贤区经济委员会政府信息公开工作年度报告',
    });
    expect(jingwei?.id).toBe(11);

    const jgsw = matchRegionByUnitName('上海市奉贤区机关事务管理局', regions, {
      pageUrl: 'https://xxgk.fengxian.gov.cn/art/info/7193/y',
      pageTitle: '2025年上海市奉贤区机关事务管理局政府信息公开工作年度报告',
    });
    expect(jgsw?.id).toBe(12);
  });
});
