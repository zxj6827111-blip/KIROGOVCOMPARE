export type CanonicalGovInsightUnitType =
  | 'province'
  | 'city'
  | 'district'
  | 'department'
  | 'town_street'
  | 'functional_zone'
  | 'unknown';

export type LegacyGovInsightEntityType = 'district' | 'department' | 'unknown';

interface GovInsightEntityClassificationInput {
  name?: string | null;
  type?: string | null;
  canonicalUnitType?: CanonicalGovInsightUnitType | null;
}

const TOWN_STREET_SUFFIXES = ['镇', '乡', '街道', '街道办', '街道办事处'];
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
const DISTRICT_SUFFIXES = ['区', '县', '旗', '自治县'];

const normalizeUnitName = (name: string): string => String(name || '').trim();

const endsWithAny = (value: string, suffixes: string[]) => suffixes.some((suffix) => value.endsWith(suffix));
const includesAny = (value: string, parts: string[]) => parts.some((part) => value.includes(part));

export const classifyGovInsightUnitName = (name: string): CanonicalGovInsightUnitType => {
  const normalized = normalizeUnitName(name);
  if (!normalized) return 'unknown';

  if (endsWithAny(normalized, TOWN_STREET_SUFFIXES)) {
    return 'town_street';
  }

  if (includesAny(normalized, FUNCTIONAL_ZONE_KEYWORDS) || endsWithAny(normalized, FUNCTIONAL_ZONE_SUFFIXES)) {
    return 'functional_zone';
  }

  if (
    endsWithAny(normalized, DEPARTMENT_SUFFIXES) ||
    includesAny(normalized, DEPARTMENT_KEYWORDS) ||
    includesAny(normalized, DEPARTMENT_NAME_PARTS)
  ) {
    return 'department';
  }

  if (endsWithAny(normalized, DISTRICT_SUFFIXES) || normalized.endsWith('市')) {
    return 'district';
  }

  return 'unknown';
};

export const toLegacyGovInsightEntityType = (
  unitType: CanonicalGovInsightUnitType
): LegacyGovInsightEntityType => {
  if (unitType === 'department') return 'department';
  if (unitType === 'district' || unitType === 'town_street' || unitType === 'functional_zone') {
    return 'district';
  }
  return 'unknown';
};

export const classifyGovInsightEntity = (
  entity: GovInsightEntityClassificationInput
): LegacyGovInsightEntityType => {
  if (entity.canonicalUnitType) {
    return toLegacyGovInsightEntityType(entity.canonicalUnitType);
  }

  if (entity.type === 'department') {
    return 'department';
  }

  if (entity.type === 'district') {
    return 'district';
  }

  return toLegacyGovInsightEntityType(classifyGovInsightUnitName(String(entity.name || '')));
};

export const isDistrictLikeGovInsightUnitName = (name: string): boolean =>
  toLegacyGovInsightEntityType(classifyGovInsightUnitName(name)) === 'district';

export const isDepartmentLikeGovInsightUnitName = (name: string): boolean =>
  toLegacyGovInsightEntityType(classifyGovInsightUnitName(name)) === 'department';

export const isDistrictLikeGovInsightEntity = (entity: GovInsightEntityClassificationInput): boolean =>
  classifyGovInsightEntity(entity) === 'district';

export const isDepartmentLikeGovInsightEntity = (entity: GovInsightEntityClassificationInput): boolean =>
  classifyGovInsightEntity(entity) === 'department';
