import {
  getCardLabel,
  getRegionType,
  isAdministrativeByName,
  isDepartmentRegion,
} from './regionClassification';

/**
 * 后端 /regions 会下发解析好的 is_department；这里同时覆盖"字段缺失时按名称兜底"，
 * 因为兜底一旦漏了 旗/苏木，区/旗下面的整列就渲染不出来（鄂尔多斯导入事故）。
 */
describe('regionClassification', () => {
  it('prefers the declared flag over the name', () => {
    expect(isDepartmentRegion({ name: '伊金霍洛旗', is_department: true })).toBe(true);
    expect(isDepartmentRegion({ name: '伊金霍洛旗财政局', is_department: false })).toBe(false);
    expect(getRegionType({ name: '伊金霍洛旗', is_department: true })).toBe('department');
  });

  it('falls back to name suffixes when the flag is missing', () => {
    expect(isDepartmentRegion({ name: '伊金霍洛旗' })).toBe(false);
    expect(isDepartmentRegion({ name: '展旦召苏木' })).toBe(false);
    expect(isDepartmentRegion({ name: '阿勒腾席热镇' })).toBe(false);
    expect(isDepartmentRegion({ name: '伊金霍洛旗财政局' })).toBe(true);
    expect(isAdministrativeByName('达拉特旗')).toBe(true);
    expect(isAdministrativeByName('布尔陶亥苏木')).toBe(true);
    expect(isAdministrativeByName('伊金霍洛旗自然资源局')).toBe(false);
  });

  it('labels 区/旗下面的部门 as 部门 even at level 4', () => {
    expect(getCardLabel({ name: '伊金霍洛旗财政局', level: 4, is_department: true })).toBe('部门');
    expect(getCardLabel({ name: '阿勒腾席热镇', level: 4, is_department: false })).toBe('街道/乡镇');
    expect(getCardLabel({ name: '伊金霍洛旗', level: 3, is_department: false })).toBe('区县');
  });

  it('keeps granularity types for the 城市索引 tabs', () => {
    expect(getRegionType({ name: '东胜区', level: 3 })).toBe('district');
    expect(getRegionType({ name: '巴音门克街道', level: 4 })).toBe('town');
    expect(getRegionType({ name: '康巴什区', level: 3 })).toBe('district');
    expect(getRegionType({ name: '市农牧局', level: 3 })).toBe('department');
  });

  /**
   * 缺省省级的那批数据里，鄂尔多斯市和伊金霍洛旗都是 level 2 —— 角标必须靠名称细分，
   * 否则旗县挂着「地市」的角标、报告维护又把「区县级」筛选漏掉（伊金霍洛旗事故）。
   */
  it('splits level-2 nodes into 地市 vs 区县 by name', () => {
    expect(getCardLabel({ name: '伊金霍洛旗', level: 2, is_department: false })).toBe('区县');
    expect(getCardLabel({ name: '达拉特旗', level: 2, is_department: false })).toBe('区县');
    expect(getCardLabel({ name: '东胜区', level: 2, is_department: false })).toBe('区县');
    expect(getCardLabel({ name: '鄂托克自治旗', level: 2, is_department: false })).toBe('区县');
    expect(getRegionType({ name: '伊金霍洛旗', level: 2, is_department: false })).toBe('district');

    // 名称规则不能反过来越过 level：否则市辖区档会吃掉地级市本身。
    expect(getCardLabel({ name: '鄂尔多斯市', level: 2, is_department: false })).toBe('地市');
    expect(getCardLabel({ name: '兴安盟', level: 2, is_department: false })).toBe('地市');
  });

  it('labels a 旗下面的部门 as 部门 whatever the depth', () => {
    expect(getCardLabel({ name: '伊金霍洛旗财政局', level: 3, is_department: true })).toBe('部门');
    expect(getCardLabel({ name: '伊金霍洛旗林业和草原局', level: 2, is_department: true })).toBe('部门');
  });
});
