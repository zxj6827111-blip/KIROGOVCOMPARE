import {
  classifyTable3Issue,
  getConsistencyItemGroupKey,
  getConsistencyItemStableId,
} from './consistencyDisplay';
import { buildMarkerShell, resolveIssuePriority } from './issueMarkerPriority';

const SHORT_TITLE_BY_TYPE = {
  consistency_table3_identity: '收办平衡',
  consistency_table3_result_total: '明细合计',
  consistency_table3_column_sum: '横向总计',
  consistency_table3_other: '表三其他',
  consistency_table4_row_sum: '行内合计',
  consistency_table2: '表二低风险规则',
  consistency_text: '正文一致性',
  unsupported_not_assessable: '暂无可评估规则',
  quality_empty: '空值风险',
  quality_format: '格式风险',
  quality_structure: '结构风险',
  quality_text_extraction: '文本抽取',
  quality_other: '数据质量',
  source_anomaly: '源表异常',
  ocr_review: 'OCR 复核',
  ocr_review_success: 'OCR 完成复核',
  ocr_correction: 'OCR 修正',
  table_split_hint: '疑似拆格提示',
  unknown: '未知问题',
};

const ISSUE_TONE_BY_TYPE = {
  consistency_table3_identity: 'identity',
  consistency_table3_result_total: 'result_total',
  consistency_table3_column_sum: 'column_sum',
  consistency_table3_other: 'neutral',
  consistency_table4_row_sum: 'table4',
  consistency_table2: 'table2',
  consistency_text: 'text',
  quality_empty: 'quality',
  quality_format: 'quality',
  quality_structure: 'quality',
  quality_text_extraction: 'quality',
  quality_other: 'quality',
  source_anomaly: 'ocr',
  ocr_review: 'ocr',
  ocr_review_success: 'success',
  ocr_correction: 'ocr',
  table_split_hint: 'diagnostics',
  unsupported_not_assessable: 'neutral',
  unknown: 'neutral',
};

const safeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const getRawEvidence = (item) => item?.evidence || item?.evidence_json || {};

const resolveShortTitle = (issueType, title) => SHORT_TITLE_BY_TYPE[issueType] || title || '';

const resolveSeverity = (autoStatus) => {
  switch (String(autoStatus || '').toUpperCase()) {
    case 'FAIL':
      return 'error';
    case 'UNCERTAIN':
      return 'warning';
    case 'NOT_ASSESSABLE':
      return 'neutral';
    case 'PASS':
      return 'success';
    default:
      return 'neutral';
  }
};

const resolveTableId = (groupKey) => {
  switch (groupKey) {
    case 'table2':
    case 'table_2':
      return 'table_2';
    case 'table3':
    case 'table_3':
      return 'table_3';
    case 'table4':
    case 'table_4':
      return 'table_4';
    case 'text':
      return 'text';
    case 'visual':
    case 'structure':
    case 'quality':
      return 'quality';
    case 'vision':
      return 'vision';
    case 'diagnostics':
      return 'diagnostics';
    default:
      return null;
  }
};

const resolvePathTone = (issueType) => ISSUE_TONE_BY_TYPE[issueType] || 'neutral';

const getDisplayNo = (item, options = {}) => {
  const displayNoMap = options.displayNoMap || null;
  if (item?.displayNo !== null && item?.displayNo !== undefined) {
    return item.displayNo;
  }
  if (item?.qualityDisplayNo !== null && item?.qualityDisplayNo !== undefined) {
    return item.qualityDisplayNo;
  }
  if (displayNoMap) {
    const issueId = resolveIssueId(item, options.groupKey || options.fallbackGroupKey || '');
    if (Object.prototype.hasOwnProperty.call(displayNoMap, issueId)) {
      return displayNoMap[issueId];
    }
  }
  return null;
};

export const classifyIssueTypeFallback = (item) => {
  const groupKey = String(getConsistencyItemGroupKey(item, '') || '').toLowerCase();
  const checkKey = String(item?.check_key || item?.checkKey || '').toLowerCase();
  const title = String(item?.title || '').toLowerCase();
  const expr = String(item?.expr || item?.formula || '').toLowerCase();
  const autoStatus = String(item?.auto_status || item?.autoStatus || '').toUpperCase();
  const evidence = getRawEvidence(item);
  const serializedEvidence = (() => {
    try {
      return JSON.stringify(evidence || {}).toLowerCase();
    } catch {
      return '';
    }
  })();
  const merged = `${checkKey} ${title} ${expr} ${serializedEvidence}`;

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
    const category = classifyTable3Issue({
      check_key: item?.check_key || item?.checkKey,
      title: item?.title,
      expr: item?.expr || item?.formula,
    });
    if (category === 'col_sum') return 'consistency_table3_column_sum';
    if (category === 'identity') return 'consistency_table3_identity';
    if (category === 'result_total') return 'consistency_table3_result_total';
    return 'consistency_table3_other';
  }

  if (groupKey === 'table4') {
    return 'consistency_table4_row_sum';
  }

  if (groupKey === 'visual' || groupKey === 'structure' || groupKey === 'quality') {
    if (groupKey === 'structure' || checkKey.includes('structure') || checkKey.includes('split') || checkKey.includes('table_missing')) {
      return 'quality_structure';
    }
    if (checkKey.includes('empty') || checkKey.includes('missing') || merged.includes('empty') || merged.includes('missing')) {
      return 'quality_empty';
    }
    if (checkKey.includes('format') || checkKey.includes('numeric') || checkKey.includes('parse') || merged.includes('format') || merged.includes('numeric') || merged.includes('parse')) {
      return 'quality_format';
    }
    if (
      checkKey.includes('narrative') ||
      checkKey.includes('text') ||
      checkKey.includes('extraction') ||
      checkKey.includes('year_mismatch') ||
      checkKey.includes('conflict') ||
      checkKey.includes('gap')
    ) {
      return 'quality_text_extraction';
    }
    return 'quality_other';
  }

  if (autoStatus === 'NOT_ASSESSABLE') {
    return 'unsupported_not_assessable';
  }

  return 'unknown';
};

export const resolveIssueId = (item, fallbackGroupKey = '') => {
  if (item?.issueId) return String(item.issueId);
  if (item?.id !== null && item?.id !== undefined) return `id:${item.id}`;
  const groupKey = getConsistencyItemGroupKey(item, fallbackGroupKey);
  const checkKey = item?.check_key || item?.checkKey || 'unknown';
  const fingerprint = item?.fingerprint || item?.expr || item?.title || 'unknown';
  return getConsistencyItemStableId(
    {
      ...item,
      group_key: groupKey,
      check_key: checkKey,
      fingerprint,
    },
    groupKey
  );
};

export const buildIssueMarkers = (item, issueType, displayNo = null, source = 'checks') => {
  const evidence = getRawEvidence(item);
  const markers = [];
  const tone = resolvePathTone(issueType);
  const issueId = resolveIssueId(item);
  const pushMarker = (path, role, lineStyle = 'solid', priority) => {
    if (!path) return;
    markers.push(
      buildMarkerShell({
        path,
        role,
        issueType,
        source,
        tone,
        lineStyle,
        displayNo,
        issueId,
        autoStatus: item?.auto_status || item?.autoStatus || '',
        humanStatus: item?.human_status || item?.humanStatus || 'pending',
        priority,
      })
    );
  };

  const leftPaths = safeArray(evidence?.leftPaths);
  const rightPaths = safeArray(evidence?.rightPaths);
  const paths = safeArray(evidence?.paths);
  const fieldPath = evidence?.values?.fieldPath || item?.fieldPath || null;

  leftPaths.forEach((path) => pushMarker(path, 'primary', 'solid'));
  rightPaths.forEach((path) => pushMarker(path, 'primary', 'solid'));

  if (leftPaths.length === 0 && rightPaths.length === 0) {
    const fallbackRole =
      issueType === 'consistency_text'
        ? 'source'
        : issueType === 'unsupported_not_assessable' || String(issueType).startsWith('quality_')
          ? 'context'
          : issueType === 'table_split_hint'
            ? 'context'
            : 'primary';
    const fallbackStyle = fallbackRole === 'primary' ? 'solid' : 'dashed';
    const fallbackPriority = resolveIssuePriority({
      source,
      issueType,
      tone,
      autoStatus: item?.auto_status || item?.autoStatus || '',
      humanStatus: item?.human_status || item?.humanStatus || 'pending',
      role: fallbackRole,
    });
    paths.forEach((path) => pushMarker(path, fallbackRole, fallbackStyle, fallbackPriority));
  }

  if (markers.length === 0 && fieldPath) {
    pushMarker(fieldPath, 'primary', 'solid');
  }

  return markers;
};

const resolveFieldPath = (item) => {
  const evidence = getRawEvidence(item);
  return (
    evidence?.values?.fieldPath ||
    safeArray(evidence?.paths)[0] ||
    safeArray(evidence?.leftPaths)[0] ||
    safeArray(evidence?.rightPaths)[0] ||
    item?.path ||
    item?.fieldPath ||
    null
  );
};

const buildLocatePayload = (item, markers, fieldPath) => {
  const evidence = getRawEvidence(item);
  return {
    leftPaths: safeArray(evidence?.leftPaths),
    rightPaths: safeArray(evidence?.rightPaths),
    fallbackPaths: safeArray(evidence?.paths),
    markerPaths: markers.map((marker) => marker.path).filter(Boolean),
    fieldPath: fieldPath || null,
  };
};

const buildActions = (autoStatus, locatePayload, source = 'checks') => {
  const normalizedStatus = String(autoStatus || '').toUpperCase();
  const canMutate = normalizedStatus !== 'PASS' && normalizedStatus !== 'NOT_ASSESSABLE' && source === 'checks';
  const canLocate =
    locatePayload.leftPaths.length > 0 ||
    locatePayload.rightPaths.length > 0 ||
    locatePayload.fallbackPaths.length > 0 ||
    Boolean(locatePayload.fieldPath);

  return {
    canConfirm: canMutate,
    canDismiss: canMutate,
    canLocate,
    canEdit: false,
  };
};

export const normalizeIssueItem = (item, options = {}) => {
  const fallbackGroupKey = options.groupKey || options.fallbackGroupKey || '';
  const groupKey = getConsistencyItemGroupKey(item, fallbackGroupKey);
  const issueType = options.issueType || item?.issueType || classifyIssueTypeFallback({ ...item, group_key: groupKey });
  const displayNo = options.displayNo !== undefined ? options.displayNo : getDisplayNo(item, options);
  const fieldPath = options.fieldPath ?? resolveFieldPath(item);
  const markers = Array.isArray(options.markers) ? options.markers : buildIssueMarkers(item, issueType, displayNo, options.source || 'checks');
  const locatePayload = buildLocatePayload(item, markers, fieldPath);
  const autoStatus = options.autoStatus || item?.auto_status || item?.autoStatus || null;
  const humanStatus = options.humanStatus || item?.human_status || item?.humanStatus || 'pending';
  const source = options.source || 'checks';
  const severity = options.severity || resolveSeverity(autoStatus);
  const tone = options.tone || resolvePathTone(issueType);
  const issueId = options.issueId || resolveIssueId(item, groupKey);
  const stableIssueId = options.stableIssueId || issueId;
  const tableId = options.tableId || resolveTableId(groupKey);
  const priority = options.priority ?? Math.max(...markers.map((marker) => Number(marker?.priority || 0)), 0);

  return {
    issueId,
    stableIssueId,
    id: item?.id ?? null,
    source,
    groupKey,
    group_key: groupKey,
    checkKey: item?.check_key || item?.checkKey || '',
    check_key: item?.check_key || item?.checkKey || '',
    issueType,
    table3Category:
      groupKey === 'table3'
        ? (issueType === 'consistency_table3_column_sum'
            ? 'col_sum'
            : issueType === 'consistency_table3_identity'
              ? 'identity'
              : issueType === 'consistency_table3_result_total'
                ? 'result_total'
                : 'other')
        : null,
    displayNo,
    title: item?.title || '',
    shortTitle: resolveShortTitle(issueType, item?.title || ''),
    formula: item?.expr || item?.formula || null,
    autoStatus,
    auto_status: autoStatus,
    humanStatus,
    human_status: humanStatus,
    severity,
    tone,
    priority,
    tableId,
    fieldPath,
    leftValue: item?.left_value ?? item?.leftValue ?? null,
    left_value: item?.left_value ?? item?.leftValue ?? null,
    rightValue: item?.right_value ?? item?.rightValue ?? null,
    right_value: item?.right_value ?? item?.rightValue ?? null,
    delta: item?.delta ?? null,
    tolerance: item?.tolerance ?? null,
    evidence: getRawEvidence(item),
    markers,
    actions: options.actions || buildActions(autoStatus, locatePayload, source),
    locatePayload,
    rawItem: item,
  };
};

export const normalizeIssueGroups = (groups = [], options = {}) => {
  const issues = [];
  const issuesByGroupKey = {};
  const markerIndexByPath = {};

  (groups || []).forEach((group) => {
    const groupKey = getConsistencyItemGroupKey(group, group?.group_key || group?.groupKey || '');
    const items = Array.isArray(group?.items) ? group.items : [];
    const normalizedItems = items.map((item) => normalizeIssueItem(item, { ...options, groupKey }));
    issuesByGroupKey[groupKey] = normalizedItems;
    normalizedItems.forEach((issue) => {
      issues.push(issue);
      issue.markers.forEach((marker) => {
        if (!marker?.path) return;
        if (!markerIndexByPath[marker.path]) {
          markerIndexByPath[marker.path] = [];
        }
        markerIndexByPath[marker.path].push(issue);
      });
    });
  });

  Object.keys(markerIndexByPath).forEach((path) => {
    markerIndexByPath[path] = markerIndexByPath[path].sort((left, right) => {
      const leftPriority = Number(left?.priority || 0);
      const rightPriority = Number(right?.priority || 0);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return String(left?.issueId || '').localeCompare(String(right?.issueId || ''), 'zh-CN');
    });
  });

  return {
    issues,
    issuesByGroupKey,
    markerIndexByPath,
  };
};
