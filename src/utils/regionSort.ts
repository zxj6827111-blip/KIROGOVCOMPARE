export interface SortableRegionLike {
  id?: number | string | null;
  name?: string | null;
  level?: number | string | null;
  sort_order?: number | string | null;
}

const ADMIN_SUFFIXES = ['省', '市', '区', '县', '乡', '镇', '街道'];

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toSafeName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

/**
 * Keep the same classification rule as City Management:
 * 1) Name suffix first, 2) then level fallback.
 */
export const isDepartmentRegion = (region: SortableRegionLike): boolean => {
  const name = toSafeName(region?.name);
  if (name) {
    const isAdministrativeByName = ADMIN_SUFFIXES.some((suffix) => name.endsWith(suffix));
    if (isAdministrativeByName) {
      return false;
    }
  }

  const level = toNumberOrNull(region?.level);
  if (level !== null) {
    return level === 3;
  }

  return true;
};

/**
 * Sort order aligned with City Management:
 * administrative regions first, then departments; then sort_order; then id.
 */
export const compareRegionsByCityManagementOrder = (
  a: SortableRegionLike,
  b: SortableRegionLike
): number => {
  const aIsDepartment = isDepartmentRegion(a);
  const bIsDepartment = isDepartmentRegion(b);
  if (aIsDepartment !== bIsDepartment) {
    return aIsDepartment ? 1 : -1;
  }

  const orderA = toNumberOrNull(a?.sort_order) ?? 0;
  const orderB = toNumberOrNull(b?.sort_order) ?? 0;
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  const idA = toNumberOrNull(a?.id);
  const idB = toNumberOrNull(b?.id);
  if (idA !== null && idB !== null && idA !== idB) {
    return idA - idB;
  }

  return toSafeName(a?.name).localeCompare(toSafeName(b?.name), 'zh-Hans-CN');
};
