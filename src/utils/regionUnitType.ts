/**
 * Single source of truth for "what kind of unit is this region node".
 *
 * The region tree stores 行政区划 (province/city/district/town_street) and
 * 部门 in the same `regions` table, and `level` alone cannot tell them apart:
 * a department under a 区县 sits at level 4, which is also the 乡镇 level.
 * Classification therefore comes from `regions.is_department` when it is
 * declared (import / manual toggle), and from this name taxonomy otherwise.
 */

export type RegionUnitType =
  | 'province'
  | 'city'
  | 'district'
  | 'town_street'
  | 'functional_zone'
  | 'department'
  | 'unknown';

export interface RegionClassifyInput {
  name?: string | null;
  level?: number | string | null;
  parent_id?: number | string | null;
  /** Declared override from `regions.is_department`; null/undefined = infer. */
  is_department?: boolean | null;
}

const PROVINCE_SUFFIXES = ['省', '自治区', '特别行政区'];
const CITY_SUFFIXES = ['市', '地区', '盟', '自治州'];
const DISTRICT_SUFFIXES = ['区', '县', '旗', '自治县', '自治旗', '特区', '林区'];
const TOWN_STREET_SUFFIXES = ['镇', '乡', '街道', '街道办', '街道办事处', '苏木'];
const FUNCTIONAL_ZONE_KEYWORDS = [
  '开发区',
  '高新区',
  '高新园',
  '新区',
  '园区',
  '科技园',
  '保税区',
  '自贸区',
  '示范区',
  '功能区',
  '创业园',
  '产业园',
  '科技一条街',
];
const FUNCTIONAL_ZONE_SUFFIXES = ['管委会'];
const DEPARTMENT_SUFFIXES = [
  '局',
  '委员会',
  '委员',
  '委',
  '办',
  '办公室',
  '办公厅',
  '中心',
  '馆',
  '院',
  '所',
  '支队',
  '大队',
  '分局',
  '管理局',
  '联合会',
];
const DEPARTMENT_KEYWORDS = [
  '人民政府',
  '人民政府办公室',
  '人民政府办公厅',
  '政府办公室',
  '国防动员办公室',
  '信访办公室',
  '投资促进办公室',
  '重大项目推进办公室',
  '国有资产监督管理办公室',
];
const DEPARTMENT_NAME_PARTS = [
  '人民银行',
  '人行',
  '残联',
  '妇联',
  '联合会',
  '供销社',
  '供销总社',
  '合作总社',
  '总工会',
  '医疗保障',
];

/**
 * Parse a client-supplied department declaration into the stored tri-state:
 * true / false = declared override, null = "not declared, classify by name".
 * Anything unrecognisable maps to null so a stray payload can never pin a node
 * into the wrong group.
 */
export function toDepartmentFlagInput(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

/**
 * County-level-and-above place names, including the inner-Mongolia / border
 * forms (旗 / 盟 / 特区 / 林区) that the 省市区县 wording misses. Used to pull a
 * geographic hint out of a unit name or a page title.
 */
export const COUNTY_GEO_NAME_PATTERN =
  '(浦东新区|[\\u4e00-\\u9fa5]{1,3}区|[\\u4e00-\\u9fa5]{1,3}县|[\\u4e00-\\u9fa5]{1,4}旗)';

const endsWithAny = (value: string, suffixes: string[]) => suffixes.some((suffix) => value.endsWith(suffix));
const includesAny = (value: string, parts: string[]) => parts.some((part) => value.includes(part));

/** Unit types that belong to the 行政区划 group in the region tree. */
const ADMINISTRATIVE_UNIT_TYPES: RegionUnitType[] = ['province', 'city', 'district', 'town_street'];

const toLevelNumber = (value: unknown): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};

/**
 * @param parentExists whether the parent row could be resolved; defaults to
 *   "parent_id is not null". Pass `false` for orphaned roots so a bare
 *   `市`/`盟` name still classifies as a city.
 */
export function inferRegionUnitType(
  region: RegionClassifyInput,
  parentExists?: boolean
): { unitType: RegionUnitType; confidence: number } {
  const name = String(region?.name || '').trim();
  const level = toLevelNumber(region?.level);
  const hasParent = region?.parent_id !== null && region?.parent_id !== undefined;
  const resolvedParentExists = parentExists === undefined ? hasParent : parentExists;

  if (!name) {
    return { unitType: 'unknown', confidence: 0.35 };
  }

  if (!hasParent && endsWithAny(name, PROVINCE_SUFFIXES)) {
    return { unitType: 'province', confidence: 0.99 };
  }

  if (!hasParent || (!resolvedParentExists && (level <= 1 || endsWithAny(name, CITY_SUFFIXES)))) {
    return { unitType: 'city', confidence: 0.95 };
  }

  if (endsWithAny(name, TOWN_STREET_SUFFIXES)) {
    return { unitType: 'town_street', confidence: 0.95 };
  }

  if (level <= 2 && endsWithAny(name, CITY_SUFFIXES)) {
    return { unitType: 'city', confidence: 0.92 };
  }

  if (includesAny(name, FUNCTIONAL_ZONE_KEYWORDS) || endsWithAny(name, FUNCTIONAL_ZONE_SUFFIXES)) {
    return { unitType: 'functional_zone', confidence: 0.9 };
  }

  if (
    endsWithAny(name, DEPARTMENT_SUFFIXES) ||
    includesAny(name, DEPARTMENT_KEYWORDS) ||
    includesAny(name, DEPARTMENT_NAME_PARTS)
  ) {
    return { unitType: 'department', confidence: 0.88 };
  }

  if (endsWithAny(name, DISTRICT_SUFFIXES) || (name.endsWith('市') && hasParent)) {
    return { unitType: 'district', confidence: 0.85 };
  }

  return { unitType: 'unknown', confidence: 0.35 };
}

export const inferRegionUnitTypeByName = (region: RegionClassifyInput, parentExists?: boolean): RegionUnitType =>
  inferRegionUnitType(region, parentExists).unitType;

/**
 * `regions.level` is tree depth, not administrative level: data without a province
 * row puts 鄂尔多斯市 and 伊金霍洛旗 both at level 2. Anything that labels or filters
 * by 层级 resolves the depth here, so the 年报维护列表, its CSV export and the
 * 工作台卡片角标 stay on one 口径 (mirror: frontend getEffectiveLevel).
 */
export function getEffectiveRegionLevel(
  level?: number | string | null,
  name?: string | null
): number {
  const value = Number(level);
  return value === 2 && endsWithAny(String(name || '').trim(), DISTRICT_SUFFIXES) ? 3 : value;
}

/**
 * A name that is unmistakably a 部门, checked before the structural rules: data
 * scope pruning turns a department whose parent is outside the scope into an
 * orphan root, and "no parent" would otherwise read as a province/city.
 */
export function looksLikeDepartmentName(name?: string | null): boolean {
  const value = String(name || '').trim();
  if (!value) return false;
  return (
    endsWithAny(value, DEPARTMENT_SUFFIXES) ||
    includesAny(value, DEPARTMENT_KEYWORDS) ||
    includesAny(value, DEPARTMENT_NAME_PARTS)
  );
}

/**
 * Department-or-not, as consumed by the region tree, the batch import and the
 * unit-name matchers. A declared `is_department` always wins over inference.
 */
export function isDepartmentRegion(
  region: RegionClassifyInput,
  parentExists?: boolean
): boolean {
  if (typeof region?.is_department === 'boolean') return region.is_department;
  if (looksLikeDepartmentName(region?.name)) return true;
  return !ADMINISTRATIVE_UNIT_TYPES.includes(inferRegionUnitTypeByName(region, parentExists));
}
