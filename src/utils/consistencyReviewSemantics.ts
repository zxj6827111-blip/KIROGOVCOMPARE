export const HIERARCHY_MISSING_REPORT_CHECK_KEYS = [
  'hierarchy_missing_child_reports',
  'hierarchy_no_child_reports',
] as const;

export const HIERARCHY_MISSING_FIELD_CHECK_KEYS = [
  'hierarchy_missing_child_metrics',
  'hierarchy_no_child_metrics',
] as const;

export const HIERARCHY_COMPLETENESS_CHECK_KEYS = [
  ...HIERARCHY_MISSING_REPORT_CHECK_KEYS,
  ...HIERARCHY_MISSING_FIELD_CHECK_KEYS,
] as const;

const HIERARCHY_COMPLETENESS_CHECK_KEY_SET = new Set<string>(HIERARCHY_COMPLETENESS_CHECK_KEYS);

export const HIERARCHY_MISSING_REPORT_SQL_MATCH =
  "group_key = 'hierarchy' AND check_key IN ('hierarchy_missing_child_reports','hierarchy_no_child_reports')";

export const HIERARCHY_MISSING_FIELD_SQL_MATCH =
  "group_key = 'hierarchy' AND check_key IN ('hierarchy_missing_child_metrics','hierarchy_no_child_metrics')";

export const HIERARCHY_COMPLETENESS_SQL_MATCH =
  "group_key = 'hierarchy' AND check_key IN ('hierarchy_missing_child_reports','hierarchy_missing_child_metrics','hierarchy_no_child_reports','hierarchy_no_child_metrics')";

// Kept for compatibility with existing query call sites. Completeness items are now reviewable issues.
export const HIERARCHY_COMPLETENESS_SQL_EXCLUSION = 'TRUE';

export interface ConsistencyReviewSemanticSource {
  group_key?: string | null;
  groupKey?: string | null;
  check_key?: string | null;
  checkKey?: string | null;
  auto_status?: string | null;
  autoStatus?: string | null;
}

const getGroupKey = (item: ConsistencyReviewSemanticSource): string =>
  String(item.group_key || item.groupKey || '').toLowerCase();

const getCheckKey = (item: ConsistencyReviewSemanticSource): string =>
  String(item.check_key || item.checkKey || '').toLowerCase();

const getAutoStatus = (item: ConsistencyReviewSemanticSource): string =>
  String(item.auto_status || item.autoStatus || '').toUpperCase();

export function isHierarchyCompletenessPrompt(item: ConsistencyReviewSemanticSource): boolean {
  return getGroupKey(item) === 'hierarchy' && HIERARCHY_COMPLETENESS_CHECK_KEY_SET.has(getCheckKey(item));
}

export function isReviewableConsistencyAutoStatus(item: ConsistencyReviewSemanticSource): boolean {
  const autoStatus = getAutoStatus(item);
  return autoStatus === 'FAIL' || autoStatus === 'UNCERTAIN';
}

export function isActionableConsistencyReviewItem(item: ConsistencyReviewSemanticSource): boolean {
  return isReviewableConsistencyAutoStatus(item);
}
