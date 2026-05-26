export const GROUP_DISPLAY_NAMES = {
  text: '正文一致性校验',
  table2: '表二：主动公开政府信息情况',
  table3: '表三：收到和处理政府信息公开申请情况',
  table4: '表四：政府信息公开行政复议、行政诉讼情况',
  hierarchy: '层级汇总一致性',
  visual: '视觉与结构审计',
  structure: '结构完整性审计',
  quality: '数据质量审计',
};

export const TABLE3_CATEGORY_LABELS = {
  identity: '收办平衡异常',
  result_total: '明细合计异常',
  col_sum: '横向总计异常',
  other: '其他异常',
};

export const TABLE3_CATEGORY_SHORT_LABELS = {
  identity: '收办平衡',
  result_total: '明细合计',
  col_sum: '横向总计',
  other: '其他异常',
};

export const QUALITY_AUDIT_GROUP_KEYS = ['visual', 'structure', 'quality'];

export const QUALITY_AUDIT_CATEGORY_META = {
  missing: {
    key: 'missing',
    label: '缺失/空值风险',
    helperText: '空白单元格、内容空缺、表格缺项等提示。',
  },
  structure: {
    key: 'structure',
    label: '表格结构风险',
    helperText: '疑似表格缺失或结构识别不完整，建议核对原表。',
  },
  text: {
    key: 'text',
    label: '文本抽取风险',
    helperText: '疑似正文说明不足或年份表述异常，建议核对原文。',
  },
  other: {
    key: 'other',
    label: '其他数据质量提示',
    helperText: '其他需人工复核的数据质量提示。',
  },
};

const AUTO_STATUS_ORDER = {
  FAIL: 0,
  UNCERTAIN: 1,
  PASS: 2,
  NOT_ASSESSABLE: 3,
};

const HUMAN_STATUS_ORDER = {
  pending: 0,
  confirmed: 1,
  dismissed: 2,
};

export const getConsistencyGroupKey = (group) => group?.group_key || group?.groupKey || '';

export const getConsistencyItemGroupKey = (item, fallbackGroupKey = '') =>
  item?.group_key || item?.groupKey || fallbackGroupKey || '';

export const getConsistencyItemStableId = (item, fallbackGroupKey = '') => {
  const groupKey = getConsistencyItemGroupKey(item, fallbackGroupKey);
  if (item?.id !== null && item?.id !== undefined) {
    return `id:${item.id}`;
  }
  const checkKey = item?.check_key || item?.checkKey || 'unknown';
  const fingerprint = item?.fingerprint || item?.expr || item?.title || 'unknown';
  return `${groupKey}:${checkKey}:${fingerprint}`;
};

export const isDismissedConsistencyItem = (item) => item?.human_status === 'dismissed';

export const isNotAssessableConsistencyItem = (item) => item?.auto_status === 'NOT_ASSESSABLE';

export const getEffectiveConsistencyHumanStatus = (item) => {
  const status = item?.human_status || item?.humanStatus;
  if (status === 'confirmed' || status === 'dismissed') return status;
  return item?.auto_status === 'PASS' || item?.autoStatus === 'PASS' ? 'confirmed' : 'pending';
};

export const isProblemConsistencyItem = (item) =>
  item?.auto_status === 'FAIL' && !isDismissedConsistencyItem(item);

export const isReviewableConsistencyItem = (item) =>
  item?.auto_status === 'FAIL' ||
  item?.auto_status === 'UNCERTAIN' ||
  item?.autoStatus === 'FAIL' ||
  item?.autoStatus === 'UNCERTAIN';

export const isNumberedConsistencyItem = (item) =>
  isProblemConsistencyItem(item) && !isDismissedConsistencyItem(item);

export const isPendingReviewConsistencyItem = (item) =>
  getEffectiveConsistencyHumanStatus(item) === 'pending' &&
  (item?.auto_status === 'FAIL' || item?.auto_status === 'UNCERTAIN');

export const isQualityAuditGroupKey = (groupKey) => QUALITY_AUDIT_GROUP_KEYS.includes(groupKey);

export const isQualityAuditVisibleItem = (item) => item?.auto_status !== 'PASS';

export const isQualityAuditRiskItem = (item) =>
  (item?.auto_status === 'FAIL' || item?.auto_status === 'UNCERTAIN') &&
  !isDismissedConsistencyItem(item);

export const classifyTable3Issue = (item) => {
  const key = String(item?.check_key || item?.checkKey || '').toLowerCase();
  const title = String(item?.title || '').toLowerCase();
  const expr = String(item?.expr || '').toLowerCase();
  const merged = `${title} ${expr}`;

  if (
    key.includes('column_sum') ||
    key.includes('col_sum') ||
    merged.includes('各列求和=总计') ||
    merged.includes('各列求和') ||
    merged.includes('总计')
  ) {
    if (key.includes('column_sum') || key.includes('col_sum') || merged.includes('各列求和')) {
      return 'col_sum';
    }
  }

  if (
    key.includes('identity') ||
    (merged.includes('本年新收') && merged.includes('上年结转'))
  ) {
    return 'identity';
  }

  if (
    (key.includes('result_total') || key.includes('results_total')) &&
    !key.includes('column_sum') &&
    !key.includes('col_sum')
  ) {
    return 'result_total';
  }

  if (
    merged.includes('办理结果明细合计') ||
    (merged.includes('办理结果总计') && merged.includes('明细'))
  ) {
    return 'result_total';
  }

  return 'other';
};

export const buildTable3CategoryStats = (items = []) => {
  const buckets = {
    identity: { key: 'identity', label: TABLE3_CATEGORY_LABELS.identity, problemCount: 0, ruleCount: 0, pendingCount: 0 },
    result_total: { key: 'result_total', label: TABLE3_CATEGORY_LABELS.result_total, problemCount: 0, ruleCount: 0, pendingCount: 0 },
    col_sum: { key: 'col_sum', label: TABLE3_CATEGORY_LABELS.col_sum, problemCount: 0, ruleCount: 0, pendingCount: 0 },
    other: { key: 'other', label: TABLE3_CATEGORY_LABELS.other, problemCount: 0, ruleCount: 0, pendingCount: 0 },
  };

  items.forEach((item) => {
    if (isNotAssessableConsistencyItem(item)) return;
    const key = classifyTable3Issue(item);
    buckets[key].ruleCount += 1;
    if (isProblemConsistencyItem(item)) {
      buckets[key].problemCount += 1;
    }
    if (isPendingReviewConsistencyItem(item) && item?.auto_status !== 'FAIL') {
      buckets[key].pendingCount += 1;
    }
  });

  return ['identity', 'result_total', 'col_sum', 'other']
    .map((key) => buckets[key])
    .filter((bucket) => bucket.ruleCount > 0 || bucket.problemCount > 0);
};

const compareConsistencyItems = (left, right) => {
  const leftNo = left?.displayNo ?? Number.MAX_SAFE_INTEGER;
  const rightNo = right?.displayNo ?? Number.MAX_SAFE_INTEGER;
  if (leftNo !== rightNo) return leftNo - rightNo;

  const autoOrderLeft = AUTO_STATUS_ORDER[left?.auto_status] ?? 99;
  const autoOrderRight = AUTO_STATUS_ORDER[right?.auto_status] ?? 99;
  if (autoOrderLeft !== autoOrderRight) return autoOrderLeft - autoOrderRight;

  const humanOrderLeft = HUMAN_STATUS_ORDER[getEffectiveConsistencyHumanStatus(left)] ?? 99;
  const humanOrderRight = HUMAN_STATUS_ORDER[getEffectiveConsistencyHumanStatus(right)] ?? 99;
  if (humanOrderLeft !== humanOrderRight) return humanOrderLeft - humanOrderRight;

  const leftTitle = String(left?.title || left?.check_key || left?.id || '');
  const rightTitle = String(right?.title || right?.check_key || right?.id || '');
  return leftTitle.localeCompare(rightTitle, 'zh-CN');
};

export const sortConsistencyItems = (items = []) => [...items].sort(compareConsistencyItems);

export const normalizeConsistencyGroup = (group) => {
  const groupKey = getConsistencyGroupKey(group);
  const rawItems = Array.isArray(group?.items) ? group.items : [];

  const numberedIds = new Map();
  rawItems
    .filter((item) => isNumberedConsistencyItem(item))
    .forEach((item, index) => {
      numberedIds.set(getConsistencyItemStableId(item, groupKey), index + 1);
    });

  const items = rawItems.map((item) => {
    const stableId = getConsistencyItemStableId(item, groupKey);
    return {
      ...item,
      group_key: groupKey,
      groupKey,
      stableIssueId: stableId,
      displayNo: numberedIds.get(stableId) || null,
      table3Category: groupKey === 'table3' ? classifyTable3Issue(item) : null,
    };
  });

  const stats = {
    ruleCount: items.filter((item) => item.auto_status !== 'NOT_ASSESSABLE').length,
    problemCount: items.filter((item) => isProblemConsistencyItem(item)).length,
    pendingCount: items.filter((item) => isPendingReviewConsistencyItem(item)).length,
    pendingCountRaw: items.filter((item) => isPendingReviewConsistencyItem(item)).length,
    confirmedCount: items.filter((item) => isReviewableConsistencyItem(item) && getEffectiveConsistencyHumanStatus(item) === 'confirmed').length,
    dismissedCount: items.filter((item) => getEffectiveConsistencyHumanStatus(item) === 'dismissed').length,
    notAssessableCount: items.filter((item) => item.auto_status === 'NOT_ASSESSABLE').length,
  };

  const hasOnlyNotAssessable = stats.ruleCount === 0 && stats.notAssessableCount > 0;

  return {
    ...group,
    group_key: groupKey,
    groupKey,
    rawGroupName: group?.group_name || group?.groupName || groupKey,
    displayName: GROUP_DISPLAY_NAMES[groupKey] || group?.group_name || groupKey,
    helperText:
      groupKey === 'table2' && hasOnlyNotAssessable
        ? '当前仅保留分组入口，不计入问题。'
        : '',
    hasOnlyNotAssessable,
    stats,
    table3CategoryStats: groupKey === 'table3' ? buildTable3CategoryStats(items) : [],
    items: sortConsistencyItems(items),
  };
};

const DEFAULT_CONSISTENCY_GROUP_ORDER = ['text', 'hierarchy', 'table2', 'table3', 'table4'];

const getGroupOrder = (groupKey) => {
  const index = DEFAULT_CONSISTENCY_GROUP_ORDER.indexOf(groupKey);
  return index === -1 ? DEFAULT_CONSISTENCY_GROUP_ORDER.length : index;
};

export const ensureConsistencyGroups = (groups = [], requiredGroupKeys = []) => {
  const byKey = new Map();
  (groups || []).forEach((group) => {
    const groupKey = getConsistencyGroupKey(group);
    if (groupKey && !byKey.has(groupKey)) {
      byKey.set(groupKey, group);
    }
  });

  (requiredGroupKeys || []).forEach((groupKey) => {
    if (groupKey && !byKey.has(groupKey)) {
      byKey.set(groupKey, {
        group_key: groupKey,
        group_name: GROUP_DISPLAY_NAMES[groupKey] || groupKey,
        items: [],
      });
    }
  });

  return Array.from(byKey.values()).sort((left, right) => {
    const leftKey = getConsistencyGroupKey(left);
    const rightKey = getConsistencyGroupKey(right);
    const leftOrder = getGroupOrder(leftKey);
    const rightOrder = getGroupOrder(rightKey);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return leftKey.localeCompare(rightKey, 'zh-CN');
  });
};

export const normalizeConsistencyGroups = (groups = [], requiredGroupKeys = []) =>
  ensureConsistencyGroups(groups, requiredGroupKeys).map((group) => normalizeConsistencyGroup(group));

export const summarizeConsistencyGroups = (groups = []) =>
  (groups || []).reduce(
    (acc, group) => ({
      ruleCount: acc.ruleCount + (group?.stats?.ruleCount || 0),
      problemCount: acc.problemCount + (group?.stats?.problemCount || 0),
      pendingCount: acc.pendingCount + (group?.stats?.pendingCount || 0),
      pendingCountRaw: acc.pendingCountRaw + (group?.stats?.pendingCountRaw || 0),
      confirmedCount: acc.confirmedCount + (group?.stats?.confirmedCount || 0),
      dismissedCount: acc.dismissedCount + (group?.stats?.dismissedCount || 0),
      notAssessableCount: acc.notAssessableCount + (group?.stats?.notAssessableCount || 0),
    }),
    {
      ruleCount: 0,
      problemCount: 0,
      pendingCount: 0,
      pendingCountRaw: 0,
      confirmedCount: 0,
      dismissedCount: 0,
      notAssessableCount: 0,
    }
  );

const classifyQualityAuditItem = (item) => {
  const checkKey = String(item?.check_key || item?.checkKey || '').toLowerCase();
  const title = String(item?.title || '');

  if (
    checkKey === 'narrative_sec5_gap' ||
    checkKey.includes('empty_cells') ||
    title.includes('空白') ||
    title.includes('空缺')
  ) {
    return 'missing';
  }

  if (
    checkKey.includes('table3_missing') ||
    checkKey.includes('table4_missing') ||
    title.includes('表格缺失')
  ) {
    return 'structure';
  }

  if (
    checkKey.includes('year_mismatch') ||
    checkKey.includes('narrative_') ||
    title.includes('年份不一致') ||
    title.includes('说明')
  ) {
    return 'text';
  }

  return 'other';
};

const buildQualityAuditStats = (items = []) => ({
  itemCount: items.length,
  riskCount: items.filter((item) => isQualityAuditRiskItem(item)).length,
  reviewCount: items.filter((item) => isPendingReviewConsistencyItem(item)).length,
  resolvedCount: items.filter((item) => getEffectiveConsistencyHumanStatus(item) === 'confirmed' && item?.auto_status !== 'NOT_ASSESSABLE').length,
  dismissedCount: items.filter((item) => getEffectiveConsistencyHumanStatus(item) === 'dismissed').length,
  notAssessableCount: items.filter((item) => item?.auto_status === 'NOT_ASSESSABLE').length,
});

export const buildQualityAuditGroups = (groups = [], filterGroupKeys = QUALITY_AUDIT_GROUP_KEYS) => {
  const items = (groups || [])
    .filter((group) => filterGroupKeys.includes(group?.group_key || group?.groupKey))
    .flatMap((group) => group?.items || [])
    .filter((item) => isQualityAuditVisibleItem(item));

  const numberedIds = new Map();
  sortConsistencyItems(items.filter((item) => isQualityAuditRiskItem(item))).forEach((item, index) => {
    const stableId = item?.stableIssueId || getConsistencyItemStableId(item, item?.group_key || item?.groupKey || '');
    numberedIds.set(stableId, index + 1);
  });

  const categorizedItems = items.map((item) => {
    const stableId = item?.stableIssueId || getConsistencyItemStableId(item, item?.group_key || item?.groupKey || '');
    return {
      ...item,
      qualityCategory: classifyQualityAuditItem(item),
      qualityDisplayNo: numberedIds.get(stableId) || null,
    };
  });

  return ['missing', 'structure', 'text', 'other']
    .map((categoryKey) => {
      const meta = QUALITY_AUDIT_CATEGORY_META[categoryKey];
      const categoryItems = sortConsistencyItems(
        categorizedItems.filter((item) => item.qualityCategory === categoryKey)
      );

      if (categoryItems.length === 0) {
        return null;
      }

      const stats = buildQualityAuditStats(categoryItems);

      return {
        group_key: `quality-audit-${categoryKey}`,
        groupKey: `quality-audit-${categoryKey}`,
        rawGroupName: meta.label,
        displayName: meta.label,
        helperText: meta.helperText,
        hasOnlyNotAssessable: stats.itemCount > 0 && stats.itemCount === stats.notAssessableCount,
        stats,
        items: categoryItems,
      };
    })
    .filter(Boolean);
};

export const summarizeQualityAuditGroups = (groups = []) =>
  (groups || []).reduce(
    (acc, group) => ({
      itemCount: acc.itemCount + (group?.stats?.itemCount || 0),
      riskCount: acc.riskCount + (group?.stats?.riskCount || 0),
      reviewCount: acc.reviewCount + (group?.stats?.reviewCount || 0),
      resolvedCount: acc.resolvedCount + (group?.stats?.resolvedCount || 0),
      dismissedCount: acc.dismissedCount + (group?.stats?.dismissedCount || 0),
      notAssessableCount: acc.notAssessableCount + (group?.stats?.notAssessableCount || 0),
    }),
    {
      itemCount: 0,
      riskCount: 0,
      reviewCount: 0,
      resolvedCount: 0,
      dismissedCount: 0,
      notAssessableCount: 0,
    }
  );

export const collectPendingConsistencyItemIds = (groups = []) =>
  (groups || []).flatMap((group) =>
    (group?.items || [])
      .filter((item) => isPendingReviewConsistencyItem(item) && item?.id)
      .map((item) => item.id)
  );

export const getConsistencyAutoStatusLabel = (status) => {
  switch (status) {
    case 'FAIL':
      return '问题';
    case 'UNCERTAIN':
      return '待复核';
    case 'PASS':
      return '已通过';
    case 'NOT_ASSESSABLE':
      return '不可评估';
    default:
      return status || '未知';
  }
};

export const getConsistencyHumanStatusLabel = (status) => {
  switch (status) {
    case 'pending':
      return '待处理';
    case 'confirmed':
      return '已确认';
    case 'dismissed':
      return '已忽略';
    default:
      return status || '未处理';
  }
};

export const getQualityAuditAutoStatusLabel = (status) => {
  switch (status) {
    case 'FAIL':
      return '数据质量提示';
    case 'UNCERTAIN':
      return '需复核';
    case 'PASS':
      return '已通过';
    case 'NOT_ASSESSABLE':
      return '不可判断';
    default:
      return status || '未知';
  }
};

export const getQualityAuditHumanStatusLabel = (status) => {
  switch (status) {
    case 'pending':
      return '待复核';
    case 'confirmed':
      return '已处理';
    case 'dismissed':
      return '已忽略';
    default:
      return status || '未处理';
  }
};
