import {
  inferRegionUnitType,
  isDepartmentRegion,
  looksLikeDepartmentName,
  toDepartmentFlagInput,
} from '../utils/regionUnitType';

/**
 * Names come from the 鄂尔多斯市 workbook that triggered the fix: its 旗-level
 * children were invisible in 区域管理 because `旗` was not recognised as an
 * administrative suffix, and 区/县/旗下面的部门 share level 4 with 乡镇.
 */
const ADMINISTRATIVE = [
  ['内蒙古自治区', 1, null],
  ['鄂尔多斯市', 2, 1],
  ['东胜区', 3, 2],
  ['康巴什区', 3, 2],
  ['达拉特旗', 3, 2],
  ['准格尔旗', 3, 2],
  ['伊金霍洛旗', 3, 2],
  ['乌审旗', 3, 2],
  ['杭锦旗', 3, 2],
  ['鄂托克旗', 3, 2],
  ['鄂托克前旗', 3, 2],
  ['阿勒腾席热镇', 4, 7],
  ['苏布尔嘎镇', 4, 7],
  ['札萨克镇', 4, 7],
  ['乌兰木伦镇', 4, 7],
  ['罕台镇', 4, 3],
  ['巴音门克街道', 4, 3],
  ['交通街道', 4, 3],
  ['十二连城乡', 4, 6],
  ['暖水乡', 4, 6],
  ['展旦召苏木', 4, 5],
  ['布尔陶亥苏木', 4, 6],
  ['苏力德苏木', 4, 8],
  ['伊和乌素苏木', 4, 9],
  ['阿尔巴斯苏木', 4, 10],
  ['上海庙镇', 4, 11],
] as const;

const DEPARTMENTS = [
  '伊金霍洛旗人民政府',
  '伊金霍洛旗人民政府办公室',
  '伊金霍洛旗财政局',
  '伊金霍洛旗教育体育局',
  '伊金霍洛旗自然资源局',
  '伊金霍洛旗住房和城乡建设局',
  '伊金霍洛旗林业和草原局',
  '伊金霍洛旗国有资产监督管理委员会',
  '伊金霍洛旗卫生健康委员',
  '伊金霍洛旗政务服务与数据管理局',
  '鄂尔多斯市生态环境局伊金霍洛旗分局',
  '鄂尔多斯蒙苏经济开发区',
  '市财政局',
  '市行政审批政务服务与数据管理局',
  '伊金霍洛旗中心医院',
  '伊金霍洛旗残疾人联合会',
];

const asRegion = (name: string, level: number, parent_id: number | null) => ({
  name,
  level,
  parent_id,
});

describe('region unit type classification', () => {
  test.each(ADMINISTRATIVE)('旗/苏木/乡镇 %s 不是部门', (name, level, parent_id) => {
    expect(isDepartmentRegion(asRegion(name, level, parent_id))).toBe(false);
  });

  test.each(DEPARTMENTS)('部门 %s 判为部门（与乡镇同为 level 4）', (name) => {
    expect(isDepartmentRegion(asRegion(name, 4, 7))).toBe(true);
  });

  test('伊金霍洛旗 is a district, not a department', () => {
    expect(inferRegionUnitType(asRegion('伊金霍洛旗', 3, 2)).unitType).toBe('district');
    expect(inferRegionUnitType(asRegion('展旦召苏木', 4, 5)).unitType).toBe('town_street');
    expect(inferRegionUnitType(asRegion('鄂尔多斯蒙苏经济开发区', 4, 7)).unitType).toBe('functional_zone');
  });

  test('a department pruned to an orphan root by data scope still reads as a department', () => {
    expect(isDepartmentRegion(asRegion('伊金霍洛旗财政局', 1, null))).toBe(true);
    expect(isDepartmentRegion(asRegion('伊金霍洛旗', 1, null))).toBe(false);
  });

  test('declared is_department overrides the name', () => {
    expect(isDepartmentRegion({ ...asRegion('伊金霍洛旗', 3, 2), is_department: true })).toBe(true);
    expect(isDepartmentRegion({ ...asRegion('伊金霍洛旗财政局', 4, 7), is_department: false })).toBe(false);
    expect(isDepartmentRegion({ ...asRegion('东胜区人民政府', 4, 3), is_department: false })).toBe(false);
  });

  test('looksLikeDepartmentName covers truncated 委员会 and 人民政府', () => {
    expect(looksLikeDepartmentName('伊金霍洛旗卫生健康委员')).toBe(true);
    expect(looksLikeDepartmentName('伊金霍洛旗人民政府')).toBe(true);
    expect(looksLikeDepartmentName('伊金霍洛旗')).toBe(false);
    expect(looksLikeDepartmentName('巴音门克街道')).toBe(false);
  });

  test('toDepartmentFlagInput maps the stored tri-state', () => {
    expect(toDepartmentFlagInput(true)).toBe(true);
    expect(toDepartmentFlagInput('false')).toBe(false);
    expect(toDepartmentFlagInput(0)).toBe(false);
    expect(toDepartmentFlagInput(null)).toBeNull();
    expect(toDepartmentFlagInput(undefined)).toBeNull();
    expect(toDepartmentFlagInput('垃圾输入')).toBeNull();
  });
});
