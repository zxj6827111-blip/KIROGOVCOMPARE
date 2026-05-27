export type ConsistencyIssueType =
  | 'consistency_text'
  | 'consistency_table2'
  | 'consistency_table3_identity'
  | 'consistency_table3_result_total'
  | 'consistency_table3_column_sum'
  | 'consistency_table3_other'
  | 'consistency_table4_row_sum'
  | 'consistency_hierarchy_sum'
  | 'hierarchy_completeness_prompt'
  | 'quality_empty'
  | 'quality_format'
  | 'quality_structure'
  | 'quality_text_extraction'
  | 'quality_other'
  | 'source_anomaly'
  | 'unsupported_not_assessable'
  | 'unknown';

export interface ConsistencyIssueTypeSource {
  group_key?: string | null;
  groupKey?: string | null;
  check_key?: string | null;
  checkKey?: string | null;
  title?: string | null;
  expr?: string | null;
  auto_status?: string | null;
  autoStatus?: string | null;
  evidence?: any;
  evidence_json?: any;
}

const getGroupKey = (item: ConsistencyIssueTypeSource) =>
  String(item.group_key || item.groupKey || '').toLowerCase();

const getCheckKey = (item: ConsistencyIssueTypeSource) =>
  String(item.check_key || item.checkKey || '').toLowerCase();

const getAutoStatus = (item: ConsistencyIssueTypeSource) =>
  String(item.auto_status || item.autoStatus || '').toUpperCase();

const getEvidence = (item: ConsistencyIssueTypeSource) => item.evidence || item.evidence_json || {};

const buildMergedText = (item: ConsistencyIssueTypeSource) => {
  const evidence = getEvidence(item);
  const serializedEvidence = (() => {
    try {
      return JSON.stringify(evidence || {});
    } catch {
      return '';
    }
  })();
  return `${String(item.title || '').toLowerCase()} ${String(item.expr || '').toLowerCase()} ${serializedEvidence.toLowerCase()}`.trim();
};

export function classifyConsistencyIssueType(item: ConsistencyIssueTypeSource): ConsistencyIssueType {
  const groupKey = getGroupKey(item);
  const checkKey = getCheckKey(item);
  const autoStatus = getAutoStatus(item);
  const merged = buildMergedText(item);

  if (merged.includes('source_anomaly') || merged.includes('source_table_anomaly')) {
    return 'source_anomaly';
  }

  if (groupKey === 'text') {
    return 'consistency_text';
  }

  if (groupKey === 'table2') {
    if (checkKey === 't2_no_rules' || autoStatus === 'NOT_ASSESSABLE') {
      return 'unsupported_not_assessable';
    }
    return 'consistency_table2';
  }

  if (groupKey === 'table3') {
    if (
      checkKey.includes('column_sum') ||
      checkKey.includes('col_sum') ||
      merged.includes('各列求和') ||
      merged.includes('各列求和=总计')
    ) {
      return 'consistency_table3_column_sum';
    }

    if (
      checkKey.includes('identity') ||
      merged.includes('本年新收+上年结转') ||
      merged.includes('本年新收 + 上年结转')
    ) {
      return 'consistency_table3_identity';
    }

    if (
      (checkKey.includes('result_total') || checkKey.includes('results_total')) &&
      !checkKey.includes('column_sum') &&
      !checkKey.includes('col_sum')
    ) {
      return 'consistency_table3_result_total';
    }

    return 'consistency_table3_other';
  }

  if (groupKey === 'table4') {
    return 'consistency_table4_row_sum';
  }

  if (groupKey === 'hierarchy') {
    if (
      checkKey === 'hierarchy_missing_child_reports' ||
      checkKey === 'hierarchy_missing_child_metrics'
    ) {
      return 'hierarchy_completeness_prompt';
    }
    if (autoStatus === 'NOT_ASSESSABLE') {
      return 'unsupported_not_assessable';
    }
    return 'consistency_hierarchy_sum';
  }

  if (groupKey === 'visual' || groupKey === 'structure' || groupKey === 'quality') {
    if (
      groupKey === 'structure' ||
      checkKey.includes('structure') ||
      checkKey.includes('split') ||
      checkKey.includes('table_missing') ||
      merged.includes('拆格') ||
      merged.includes('表格缺失') ||
      merged.includes('行列') ||
      merged.includes('错位')
    ) {
      return 'quality_structure';
    }

    if (
      checkKey.includes('empty') ||
      checkKey.includes('missing') ||
      merged.includes('缺失') ||
      merged.includes('空值') ||
      merged.includes('空单元格')
    ) {
      return 'quality_empty';
    }

    if (
      checkKey.includes('format') ||
      checkKey.includes('numeric') ||
      checkKey.includes('parse') ||
      merged.includes('非数字') ||
      merged.includes('格式') ||
      merged.includes('数值')
    ) {
      return 'quality_format';
    }

    if (
      checkKey.includes('narrative') ||
      checkKey.includes('text') ||
      checkKey.includes('extraction') ||
      checkKey.includes('year_mismatch') ||
      merged.includes('正文') ||
      merged.includes('文本') ||
      merged.includes('抽取')
    ) {
      return 'quality_text_extraction';
    }

    return 'quality_other';
  }

  if (autoStatus === 'NOT_ASSESSABLE') {
    return 'unsupported_not_assessable';
  }

  return 'unknown';
}
