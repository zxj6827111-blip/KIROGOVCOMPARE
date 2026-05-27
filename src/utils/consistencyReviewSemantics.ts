export const HIERARCHY_COMPLETENESS_CHECK_KEYS = [
  'hierarchy_missing_child_reports',
  'hierarchy_missing_child_metrics',
] as const;

const HIERARCHY_COMPLETENESS_CHECK_KEY_SET = new Set<string>(HIERARCHY_COMPLETENESS_CHECK_KEYS);

export const HIERARCHY_COMPLETENESS_SQL_EXCLUSION =
  "NOT (group_key = 'hierarchy' AND check_key IN ('hierarchy_missing_child_reports','hierarchy_missing_child_metrics'))";

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
  return isReviewableConsistencyAutoStatus(item) && !isHierarchyCompletenessPrompt(item);
}
