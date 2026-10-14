/**
 * Region 部门 / 行政区划 helpers for the tree views.
 *
 * The authoritative decision is made on the server (`src/utils/regionUnitType.ts`)
 * and delivered as `region.is_department` on every /regions row, so these helpers
 * normally just read that field. The name-based fallback only covers rows from an
 * older payload that has no flag; it deliberately contains no `level` heuristics,
 * because 区/县/旗下面的部门与乡镇同为 level 4.
 */

const ADMINISTRATIVE_SUFFIXES = [
  '省',
  '自治区',
  '直辖市',
  '特别行政区',
  '市',
  '地区',
  '盟',
  '自治州',
  '区',
  '县',
  '旗',
  '自治县',
  '自治旗',
  '特区',
  '林区',
  '苏木',
  '街道',
  '街道办',
  '街道办事处',
  '镇',
  '乡',
];

export const isAdministrativeByName = (name) => {
  const value = String(name || '').trim();
  if (!value) return false;
  return ADMINISTRATIVE_SUFFIXES.some((suffix) => value.endsWith(suffix));
};

const toName = (region) => (typeof region === 'string' ? region : region?.name);

export const isDepartmentRegion = (region) => {
  if (!region) return false;
  if (typeof region === 'object' && typeof region.is_department === 'boolean') {
    return region.is_department;
  }
  const name = toName(region);
  if (!name) return false;
  return !isAdministrativeByName(name);
};

/** Granularity label used by the 城市索引 tabs and card badges. */
export const getRegionTypeByName = (name) => {
  const value = String(name || '').trim();
  if (!value) return 'department';

  if (value.endsWith('省') || value.endsWith('自治区') || value.endsWith('直辖市')) return 'province';
  if (
    value.endsWith('街道') ||
    value.endsWith('办事处') ||
    value.endsWith('镇') ||
    value.endsWith('乡') ||
    value.endsWith('苏木')
  ) {
    return 'town';
  }
  if (
    value.endsWith('区') ||
    value.endsWith('县') ||
    value.endsWith('市') ||
    value.endsWith('新区') ||
    value.endsWith('旗') ||
    value.endsWith('盟')
  ) {
    return 'district';
  }
  return 'department';
};

export const getRegionType = (region) => {
  if (region && typeof region === 'object' && typeof region.is_department === 'boolean') {
    if (region.is_department) return 'department';
    const byName = getRegionTypeByName(region.name);
    return byName === 'department' ? 'district' : byName;
  }
  return getRegionTypeByName(toName(region));
};

const COUNTY_LEVEL_SUFFIXES = ['区', '县', '旗'];

export const isCountyLevelByName = (name) => {
  const value = String(name || '').trim();
  return COUNTY_LEVEL_SUFFIXES.some((suffix) => value.endsWith(suffix));
};

/**
 * `regions.level` is tree depth, not administrative level: a dataset without a
 * province row puts 鄂尔多斯市 and 伊金霍洛旗 both at level 2. Card badges and the
 * 层级 filter have to resolve that the same way, so they share this one rule.
 */
export const getEffectiveLevel = (level, name) => {
  const value = Number(level);
  return value === 2 && isCountyLevelByName(name) ? 3 : value;
};

export const getCardLabel = (region) => {
  if (region && typeof region.is_department === 'boolean' && region.is_department) return '部门';

  const effectiveLevel = getEffectiveLevel(region.level, region.name);
  if (effectiveLevel === 1) return '省级';
  if (effectiveLevel === 2) return '地市';
  if (effectiveLevel === 3) return '区县';
  if (effectiveLevel === 4) return '街道/乡镇';

  const type = getRegionType(region);
  if (type === 'province') return '省级';
  if (type === 'town') return '街道/乡镇';
  if (type === 'district') return '区县';
  return '部门';
};
