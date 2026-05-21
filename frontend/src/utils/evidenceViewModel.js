import { getRowColFromPath, normalizeTablePath } from './tableRowColMapping';

const REVIEW_STATUSES = new Set(['FAIL', 'UNCERTAIN', 'NOT_ASSESSABLE']);

const EMPTY_VALUE_TOKENS = new Set([
  '',
  '/',
  '-',
  '--',
  'N/A',
  'NA',
  'null',
  'undefined',
  '不适用',
  '无',
  '暂无',
  '未填写',
]);

const VALUE_KEYS = {
  original: [
    'original',
    'originalValue',
    'raw',
    'rawValue',
    'sourceRaw',
    'sourceValue',
    'cellText',
    'matchedText',
    'context',
  ],
  parsed: [
    'parsed',
    'parsedValue',
    'normalized',
    'normalizedValue',
    'textValue',
    'actual',
    'actualValue',
  ],
  compared: [
    'compared',
    'comparedValue',
    'expected',
    'expectedValue',
    'rightValue',
    'targetValue',
    'baselineValue',
  ],
};

const REASON_DEFINITIONS = [
  {
    key: 'missing_table',
    patterns: ['missing_table', 'table_missing', 't3_missing', 'no_table', '缺表', '未识别到表'],
    label: '缺少关键表格',
    summary: '系统未能在结构化结果中定位到对应表格，当前只能保留字段路径，建议人工回看原 PDF 或解析结果。',
  },
  {
    key: 'header',
    patterns: ['header', '表头', '列头', '标题行'],
    label: '表头识别不足',
    summary: '表头或列名识别不充分，字段映射可能不稳定，建议结合原表表头复核。',
  },
  {
    key: 'empty',
    patterns: ['empty', 'blank', 'null', 'missing_value', 'not_found', '空值', '为空', '未填写'],
    label: '字段为空或未抽取',
    summary: '系统读取到的结构化字段为空，可能是原文空白、占位符，或解析阶段未抽取到该单元格。',
  },
  {
    key: 'zero_empty',
    patterns: ['zero_empty', 'zero-as-empty', '0与空', '0 和空', '零值'],
    label: '0 与空值需区分',
    summary: '当前字段涉及 0、空值或占位值差异，不能仅凭展示值判断业务含义，建议核对原表。',
  },
  {
    key: 'not_applicable',
    patterns: ['not_applicable', 'n/a', 'na_like', 'slash', '不适用', '无需填写'],
    label: '不适用或占位符',
    summary: '原表可能使用 /、-、不适用等占位符，展示层仅提示复核，不直接认定为确定错误。',
  },
  {
    key: 'cross_page',
    patterns: ['cross_page', 'page_break', '跨页', '分页'],
    label: '表格跨页风险',
    summary: '表格可能跨页，尾部或续表字段需要回看相邻页面，避免漏读或重复读。',
  },
  {
    key: 'table3_split',
    patterns: ['table3_split', 'split_cell', 'fragment', 'table_split', '拆格', '分裂'],
    label: '表三疑似拆格',
    summary: '表三结构存在疑似拆格或片段化，当前提示仅用于人工复核，不改变主勾稽编号。',
  },
  {
    key: 'truncated',
    patterns: ['truncated', 'tail_cut', '截断', '尾部'],
    label: '长表格尾部截断风险',
    summary: '长表格尾部可能未完整进入结构化结果，建议核对表格末尾和下一页续表。',
  },
  {
    key: 'difference',
    patterns: ['delta', 'mismatch', 'difference', 'not_equal', 'hierarchy_sum_mismatch', '不一致', '差异'],
    label: '比对值不一致',
    summary: '左右值或期望值与实际值存在差异，需要结合来源字段确认差异来自解析值还是规则比对。',
  },
  {
    key: 'hierarchy_incomplete',
    patterns: [
      'hierarchy_sum_incomplete_inputs',
      'hierarchy_no_child_reports',
      'hierarchy_no_direct_children',
      'hierarchy_no_materialized_metrics',
    ],
    label: '层级汇总输入不完整',
    summary: '当前行政层级缺少同年下级报告或可汇总字段，系统保留复核线索，不直接认定上下级汇总不一致。',
  },
  {
    key: 'quality',
    patterns: ['quality', 'visual', 'structure', 'audit', 'source_table_anomaly', 'parse_mapping_anomaly'],
    label: '数据质量复核提示',
    summary: '该提示来自质量、结构或视觉复核线索，仅用于辅助判断，不进入主勾稽问题计数。',
  },
];

const normalizeStatus = (status) => String(status || '').trim().toUpperCase();

const asArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  return [value];
};

const compact = (value) => String(value ?? '').trim();

const valuePresent = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return compact(value).length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const formatEvidenceValue = (value) => {
  if (!valuePresent(value)) return 'N/A';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const pickFirstValue = (sources, keys) => {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      if (valuePresent(source[key])) return source[key];
    }
  }
  return undefined;
};

const getEvidence = (item) => item?.evidence || item?.evidence_json || {};

const normalizePath = (path) => normalizeTablePath(String(path || '').trim()) || String(path || '').trim();

const isTableLikePath = (path) =>
  path &&
  (path.includes('tableData') ||
    path.includes('activeDisclosureData') ||
    path.includes('reviewLitigationData') ||
    path.includes('sections[type=table_'));

const pathToLabel = (rawPath) => {
  const path = normalizePath(rawPath);
  if (!path) return null;

  const location = getRowColFromPath(path);
  if (location) {
    const parts = [location.table];
    if (location.rowLabel || location.name) parts.push(location.rowLabel || location.name);
    if (location.colLabel) parts.push(location.colLabel);
    if (location.row && location.col) parts.push(`行${location.row} 列${location.col}`);
    return parts.join(' / ');
  }

  if (path.includes('content')) return '正文内容';
  if (path.includes('sections[type=table_2]')) return '表二结构路径';
  if (path.includes('sections[type=table_3]')) return '表三结构路径';
  if (path.includes('sections[type=table_4]')) return '表四结构路径';
  return path;
};

const buildSourceRefs = (evidence = {}) => {
  const refs = [];
  const seen = new Set();

  const addRefs = (paths, role) => {
    asArray(paths).forEach((rawPath) => {
      const path = normalizePath(rawPath);
      if (!path) return;
      const key = `${role}:${path}`;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({
        role,
        path,
        label: pathToLabel(path) || path,
        type: isTableLikePath(path) ? 'table' : path.includes('content') ? 'text' : 'field',
      });
    });
  };

  addRefs(evidence.leftPaths, 'left');
  addRefs(evidence.rightPaths, 'right');
  addRefs(evidence.paths, 'source');
  addRefs(evidence.sourceRefs, 'source');

  return refs;
};

const firstPath = (sourceRefs) => sourceRefs[0]?.path || '';

const inferReasonSource = (item, evidence, sourceRefs) => {
  const values = evidence?.values || {};
  return [
    values.reason,
    values.issue,
    values.note,
    values.status,
    values.source,
    item?.reason,
    item?.check_key,
    item?.group_key,
    item?.issueType,
    item?.title,
    item?.expr,
    firstPath(sourceRefs),
  ]
    .map((part) => compact(part).toLowerCase())
    .filter(Boolean)
    .join(' ');
};

const getReasonDefinition = (reasonSource) => {
  const normalized = compact(reasonSource).toLowerCase();
  const matched = REASON_DEFINITIONS.find((definition) =>
    definition.patterns.some((pattern) => normalized.includes(pattern.toLowerCase()))
  );

  return matched || null;
};

const hasEmptyLikeValue = (...values) =>
  values.some((value) => {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return EMPTY_VALUE_TOKENS.has(compact(value));
    return false;
  });

const inferImplicitReason = (item, evidence, sourceRefs, values) => {
  const allValueText = [values.originalValue, values.parsedValue, values.comparedValue]
    .map((value) => compact(value).toLowerCase())
    .join(' ');

  if (sourceRefs.some((ref) => ref.path.includes('sections[type=table_3]'))) {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'missing_table');
  }

  if (sourceRefs.some((ref) => ref.path.includes('tableData')) && compact(item?.title).includes('表三')) {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'table3_split');
  }

  if (hasEmptyLikeValue(values.originalValue, values.parsedValue) && compact(values.comparedValue) === '0') {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'zero_empty');
  }

  if (hasEmptyLikeValue(values.originalValue, values.parsedValue)) {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'empty');
  }

  if (allValueText.includes('不适用') || allValueText.includes('/')) {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'not_applicable');
  }

  if (evidence?.values?.delta !== undefined || item?.delta !== undefined) {
    return REASON_DEFINITIONS.find((definition) => definition.key === 'difference');
  }

  return null;
};

const buildValues = (item, evidence) => {
  const evidenceValues = evidence?.values || {};
  const sources = [evidenceValues, evidence, item].filter(Boolean);
  const original = pickFirstValue(sources, VALUE_KEYS.original);
  const parsed = pickFirstValue(sources, VALUE_KEYS.parsed);
  const compared = pickFirstValue(sources, VALUE_KEYS.compared);

  return {
    originalValue: formatEvidenceValue(original),
    parsedValue: formatEvidenceValue(parsed ?? item?.left_value),
    comparedValue: formatEvidenceValue(compared ?? item?.right_value),
  };
};

const buildStatusSummary = (status, reasonDefinition) => {
  if (reasonDefinition) return reasonDefinition.summary;
  if (status === 'FAIL') {
    return '系统规则判断该项存在异常，请结合字段路径、左右值和原始表格进行复核。';
  }
  if (status === 'UNCERTAIN') {
    return '当前证据不足以直接判定为确定问题，需要人工结合来源字段复核。';
  }
  if (status === 'NOT_ASSESSABLE') {
    return '缺少可评估输入或来源路径，当前只保留结构化字段线索，不作确定问题判断。';
  }
  return '当前项目仅展示来源线索，未改变原有校验状态。';
};

const inferSeverity = (status, reasonDefinition) => {
  if (status === 'FAIL') {
    return ['missing_table', 'difference'].includes(reasonDefinition?.key) ? 'high' : 'medium';
  }
  if (status === 'UNCERTAIN') return 'medium';
  if (status === 'NOT_ASSESSABLE') return 'low';
  return 'info';
};

export const shouldShowEvidenceViewModel = (item) => REVIEW_STATUSES.has(normalizeStatus(item?.auto_status || item?.autoStatus));

export const buildEvidenceViewModel = (item = {}, options = {}) => {
  const status = normalizeStatus(item.auto_status || item.autoStatus || options.status || 'UNCERTAIN');
  const evidence = getEvidence(item);
  const sourceRefs = buildSourceRefs(evidence);
  const values = buildValues(item, evidence);
  const reasonSource = inferReasonSource(item, evidence, sourceRefs);
  const explicitReason = getReasonDefinition(reasonSource);
  const implicitReason = inferImplicitReason(item, evidence, sourceRefs, values);
  const reasonDefinition =
    implicitReason?.key === 'zero_empty' || implicitReason?.key === 'not_applicable'
      ? implicitReason
      : explicitReason || implicitReason;
  const fieldPath = firstPath(sourceRefs) || compact(item.fieldPath || item.path || item.check_key || '');
  const hasDetailedSource = sourceRefs.length > 0;
  const fallbackNotice = hasDetailedSource
    ? ''
    : '暂无更详细来源，仅保留结构化字段路径';

  return {
    summary: buildStatusSummary(status, reasonDefinition),
    reasonLabel: reasonDefinition?.label || (status === 'FAIL' ? '规则异常' : '证据不足'),
    severity: inferSeverity(status, reasonDefinition),
    fieldPath: fieldPath || 'N/A',
    originalValue: values.originalValue,
    parsedValue: values.parsedValue,
    comparedValue: values.comparedValue,
    sourceRefs,
    fallbackNotice,
    hasDetailedSource,
    status,
  };
};

export const buildComparisonEvidenceSummary = ({ sectionType, yearA, yearB, hasSourcePaths = false } = {}) => {
  const tableLabel =
    sectionType === 'table_2'
      ? '表二'
      : sectionType === 'table_3'
        ? '表三'
        : sectionType === 'table_4'
          ? '表四'
          : '文本章节';

  return {
    summary: `${tableLabel}差异来自两侧报告的已解析结构化结果：左侧为 ${yearA || '旧年度'}，右侧为 ${yearB || '新年度'}。`,
    reasonLabel: hasSourcePaths ? '结构化来源可定位' : '暂无页码级来源',
    severity: 'info',
    fieldPath: hasSourcePaths ? '结构化表格字段' : '暂无更详细来源，仅保留结构化字段路径',
    originalValue: 'N/A',
    parsedValue: 'N/A',
    comparedValue: 'N/A',
    sourceRefs: [],
  };
};
