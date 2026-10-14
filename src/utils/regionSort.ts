import { isDepartmentRegion as classifyDepartment } from './regionUnitType';

export interface SortableRegionLike {
  id?: number | string | null;
  name?: string | null;
  level?: number | string | null;
  sort_order?: number | string | null;
  is_department?: boolean | null;
}

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
 * Department classification lives in `regionUnitType` so the region tree, the
 * batch import and the data-center sorts cannot drift apart again.
 */
export const isDepartmentRegion = (region: SortableRegionLike): boolean =>
  classifyDepartment(region);

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
