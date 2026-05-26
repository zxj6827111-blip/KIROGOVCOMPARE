import React, { useEffect, useMemo, useState } from 'react';
import './ConsistencyCheckView.css';
import { apiClient } from '../apiClient';
import { getRowColFromPath, normalizeTablePath } from '../utils/tableRowColMapping';
import {
  buildQualityAuditGroups,
  collectPendingConsistencyItemIds,
  getConsistencyAutoStatusLabel,
  getEffectiveConsistencyHumanStatus,
  getConsistencyHumanStatusLabel,
  getQualityAuditAutoStatusLabel,
  getQualityAuditHumanStatusLabel,
  normalizeConsistencyGroups,
  QUALITY_AUDIT_GROUP_KEYS,
  summarizeConsistencyGroups,
  summarizeQualityAuditGroups,
} from '../utils/consistencyDisplay';
import { buildEvidenceViewModel, shouldShowEvidenceViewModel } from '../utils/evidenceViewModel';
import { aggregateIssuesFromChecks } from '../utils/issueAggregation';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';

const HEAVY_GROUP_INITIAL_LIMIT = 20;
const HIERARCHY_TABLE_ORDER = {
  '表二': 1,
  '表三': 2,
  '表四': 3,
};

const getHierarchyEvidenceValues = (item) =>
  item?.evidence?.values || item?.evidence_json?.values || {};

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const formatHierarchyNumber = (value) => {
  const number = toFiniteNumber(value);
  if (number === null) return value === null || value === undefined || value === '' ? '缺失' : String(value);
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(number);
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const hasHierarchyDelta = (item) => {
  const delta = toFiniteNumber(item?.delta);
  const tolerance = toFiniteNumber(item?.tolerance) ?? 0;
  return delta !== null && Math.abs(delta) > tolerance;
};

const getHierarchyDisplayStats = (items = []) => {
  const missingReportUnits = new Set();
  const missingMetricUnits = new Set();
  const stats = {
    totalCount: items.length,
    deltaCount: 0,
    reviewCount: 0,
    incompleteCount: 0,
    failCount: 0,
    passCount: 0,
    confirmedCount: 0,
    notAssessableCount: 0,
    missingReportUnitCount: 0,
    missingMetricUnitCount: 0,
  };

  items.forEach((item) => {
    const values = getHierarchyEvidenceValues(item);
    const missingReports = asArray(values.missingReports);
    const missingMetricChildren = asArray(values.missingMetricChildren);
    const hasIncompleteInputs =
      values.reason === 'hierarchy_sum_incomplete_inputs' ||
      missingReports.length > 0 ||
      missingMetricChildren.length > 0;

    if (hasHierarchyDelta(item)) stats.deltaCount += 1;
    if (item.auto_status === 'FAIL') stats.failCount += 1;
    if (item.auto_status === 'PASS') stats.passCount += 1;
    const effectiveHumanStatus = getEffectiveConsistencyHumanStatus(item);
    if (effectiveHumanStatus === 'confirmed' && item.auto_status !== 'NOT_ASSESSABLE') stats.confirmedCount += 1;
    if (item.auto_status === 'NOT_ASSESSABLE') stats.notAssessableCount += 1;
    if (effectiveHumanStatus === 'pending' && (item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN')) {
      stats.reviewCount += 1;
    }
    if (hasIncompleteInputs) stats.incompleteCount += 1;

    missingReports.forEach((unit) => missingReportUnits.add(unit.regionName || unit.regionId));
    missingMetricChildren.forEach((unit) => missingMetricUnits.add(unit.regionName || unit.regionId));
  });

  stats.missingReportUnitCount = missingReportUnits.size;
  stats.missingMetricUnitCount = missingMetricUnits.size;
  return stats;
};

const getHierarchyTableLabel = (item) => {
  const values = getHierarchyEvidenceValues(item);
  if (values.table) return values.table;
  const match = String(item?.title || '').match(/表[二三四]/);
  return match ? match[0] : '其他';
};

const sortHierarchyItemsForDisplay = (items = []) =>
  [...items].sort((a, b) => {
    const tableDiff =
      (HIERARCHY_TABLE_ORDER[getHierarchyTableLabel(a)] || 99) -
      (HIERARCHY_TABLE_ORDER[getHierarchyTableLabel(b)] || 99);
    if (tableDiff !== 0) return tableDiff;

    const deltaDiff = Math.abs(toFiniteNumber(b.delta) || 0) - Math.abs(toFiniteNumber(a.delta) || 0);
    if (deltaDiff !== 0) return deltaDiff;

    const statusWeight = (item) => {
      if (hasHierarchyDelta(item)) return 0;
      if (item.auto_status === 'FAIL') return 1;
      if (item.auto_status === 'UNCERTAIN') return 2;
      if (item.auto_status === 'NOT_ASSESSABLE') return 3;
      return 4;
    };

    return statusWeight(a) - statusWeight(b);
  });

const getHierarchyStatusLabel = (item) => {
  if (item.auto_status === 'FAIL') return '不一致';
  if (hasHierarchyDelta(item)) return '有差额，待核查';
  if (item.auto_status === 'PASS') return '一致';
  return getConsistencyAutoStatusLabel(item.auto_status);
};

const isTablePath = (path) =>
  path &&
  (path.includes('tableData') ||
    path.includes('reviewLitigationData') ||
    path.includes('activeDisclosureData'));

const normalizeTablePaths = (paths) =>
  (paths || [])
    .map((p) => normalizeTablePath(p))
    .filter((p) => p && isTablePath(p));

const parseLocationFromPath = (rawPath) => {
  if (!rawPath) return null;

  const path = normalizeTablePath(rawPath);
  const rowCol = getRowColFromPath(path);
  if (rowCol) {
    const parts = [rowCol.table];
    const rowLabel = rowCol.rowLabel || rowCol.name;
    if (rowLabel) parts.push(`行：${rowLabel}`);
    if (rowCol.colLabel) parts.push(`列：${rowCol.colLabel}`);
    return parts.join(' / ');
  }

  if (path?.includes('content')) return '正文内容';
  return path || rawPath;
};

const highlightNumber = (text, number) => {
  if (!text || number === null || number === undefined) return text;
  const numStr = String(number);
  const escaped = numStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?<!\\d)(${escaped})(?!\\d)`, 'g');
  return text.replace(regex, '<mark class="num-highlight">$1</mark>');
};

const getLocationInfo = (item) => {
  if (!item?.evidence) return null;

  const toSource = (rawPath) => {
    const path = normalizeTablePath(rawPath);
    if (!path) return null;
    if (isTablePath(path)) return { type: 'table', label: parseLocationFromPath(path), path };
    if (path.includes('content')) return { type: 'text', label: '正文匹配内容', path };
    return { type: 'unknown', label: path, path };
  };

  const leftSources = (item.evidence.leftPaths || []).map(toSource).filter(Boolean);
  const rightSources = (item.evidence.rightPaths || []).map(toSource).filter(Boolean);
  const contextValue = item.evidence.values?.context || item.evidence.values?.matchedText;

  return {
    leftSources,
    rightSources,
    context: contextValue
      ? highlightNumber(contextValue, item.evidence.values?.textValue)
      : null,
  };
};

const getLocatePayload = (item) => ({
  leftPaths: normalizeTablePaths(item?.evidence?.leftPaths),
  rightPaths: normalizeTablePaths(item?.evidence?.rightPaths),
  fallbackPaths: normalizeTablePaths(item?.evidence?.paths),
});

const getSeverityColor = (status, isQualityMode = false) => {
  if (isQualityMode) {
    switch (status) {
      case 'FAIL':
        return 'status-quality-risk';
      case 'UNCERTAIN':
        return 'status-quality-review';
      case 'PASS':
        return 'status-pass';
      default:
        return 'status-other';
    }
  }

  switch (status) {
    case 'FAIL':
      return 'status-fail';
    case 'UNCERTAIN':
      return 'status-uncertain';
    case 'PASS':
      return 'status-pass';
    default:
      return 'status-other';
  }
};

const EVIDENCE_SEVERITY_LABELS = {
  high: '高风险',
  medium: '需复核',
  low: '线索不足',
  info: '来源说明',
};

const renderEvidenceSummary = (evidenceModel) => {
  if (!evidenceModel) return null;
  const sourceRefs = evidenceModel.sourceRefs || [];

  return (
    <div className={`evidence-view evidence-view--${evidenceModel.severity}`}>
      <div className="evidence-view__head">
        <span className="evidence-view__label">证据说明</span>
        <span className="evidence-view__severity">
          {EVIDENCE_SEVERITY_LABELS[evidenceModel.severity] || '来源说明'}
        </span>
      </div>
      <p className="evidence-view__summary">{evidenceModel.summary}</p>
      <div className="evidence-view__grid">
        <div>
          <span>风险原因</span>
          <strong>{evidenceModel.reasonLabel}</strong>
        </div>
        <div>
          <span>字段路径</span>
          <code>{evidenceModel.fieldPath}</code>
        </div>
        <div>
          <span>原始值</span>
          <strong>{evidenceModel.originalValue}</strong>
        </div>
        <div>
          <span>解析值</span>
          <strong>{evidenceModel.parsedValue}</strong>
        </div>
        <div>
          <span>比对值</span>
          <strong>{evidenceModel.comparedValue}</strong>
        </div>
      </div>
      {sourceRefs.length > 0 ? (
        <div className="evidence-view__sources">
          <span>来源线索</span>
          <div>
            {sourceRefs.slice(0, 4).map((sourceRef, index) => (
              <code key={`${sourceRef.role}-${sourceRef.path}-${index}`}>
                {sourceRef.label || sourceRef.path}
              </code>
            ))}
          </div>
        </div>
      ) : (
        <div className="evidence-view__fallback">
          {evidenceModel.fallbackNotice || '暂无更详细来源，仅保留结构化字段路径'}
        </div>
      )}
    </div>
  );
};

const renderGroupSummary = (group, isQualityMode) => {
  const { hasOnlyNotAssessable, helperText } = group;

  if (hasOnlyNotAssessable) {
    return (
      <div className="group-summary">
        <span className="group-summary-pill group-summary-pill--empty">
          {isQualityMode ? '暂无可判断提示' : '暂无可评估规则'}
        </span>
        {helperText ? <span className="group-helper-text">{helperText}</span> : null}
      </div>
    );
  }

  if (isQualityMode) {
    const stats = group.stats || {};
    return (
      <div className="group-summary">
        <span className="group-summary-pill group-summary-pill--quality-risk">风险提示 {stats.riskCount || 0}</span>
        <span className="group-summary-pill group-summary-pill--quality-review">需复核 {stats.reviewCount || 0}</span>
        {stats.resolvedCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--confirmed">已处理 {stats.resolvedCount}</span>
        ) : null}
        {stats.dismissedCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--muted">已忽略 {stats.dismissedCount}</span>
        ) : null}
        {stats.notAssessableCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--muted">不可判断 {stats.notAssessableCount}</span>
        ) : null}
      </div>
    );
  }

  const { stats, table3CategoryStats } = group;
  if (group.group_key === 'hierarchy') {
    const hierarchyStats = getHierarchyDisplayStats(group.items || []);
    return (
      <div className="group-summary group-summary--hierarchy">
        <span className="group-summary-pill">指标 {hierarchyStats.totalCount}</span>
        <span className="group-summary-pill group-summary-pill--problem">
          差额项 {hierarchyStats.deltaCount}
        </span>
        <span className="group-summary-pill group-summary-pill--warning">
          缺报告单位 {hierarchyStats.missingReportUnitCount}
        </span>
        <span className="group-summary-pill group-summary-pill--warning">
          缺字段单位 {hierarchyStats.missingMetricUnitCount}
        </span>
        {hierarchyStats.confirmedCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--confirmed">
            已确认 {hierarchyStats.confirmedCount}
          </span>
        ) : null}
        {hierarchyStats.notAssessableCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--muted">
            不可评估 {hierarchyStats.notAssessableCount}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="group-summary">
        <span className="group-summary-pill">规则 {stats.ruleCount}</span>
        <span className="group-summary-pill group-summary-pill--problem">问题 {stats.problemCount}</span>
        <span className="group-summary-pill group-summary-pill--pending">待复核 {stats.pendingCount}</span>
        {stats.confirmedCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--confirmed">已确认 {stats.confirmedCount}</span>
        ) : null}
        {stats.notAssessableCount > 0 ? (
          <span className="group-summary-pill group-summary-pill--muted">不可评估 {stats.notAssessableCount}</span>
        ) : null}
      </div>
      {group.group_key === 'table3' && table3CategoryStats.length > 0 ? (
        <div className="group-breakdown">
          {table3CategoryStats.map((bucket) => (
            <div key={bucket.key} className="group-breakdown-row">
              <span>{bucket.label}</span>
              <span>问题 {bucket.problemCount}</span>
              {bucket.pendingCount > 0 ? (
                <span className="group-breakdown-muted">其余待复核 {bucket.pendingCount}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
};

const buildModeMeta = (filterGroups = []) => {
  const isQualityMode =
    filterGroups.length > 0 && filterGroups.every((groupKey) => QUALITY_AUDIT_GROUP_KEYS.includes(groupKey));

  if (isQualityMode) {
    return {
      isQualityMode: true,
      title: '数据质量审计',
      description: '展示抽取、格式、空值和结构识别相关的黄色风险提示，不计入勾稽问题统计。',
      emptyRunText: '尚未运行数据质量审计',
      emptyDataText: '暂无数据质量审计数据',
      noGroupText: '当前没有可展示的数据质量提示',
      bulkConfirmText: '一键标记为已处理',
      runButtonText: { idle: '重新审计', initial: '运行审计', loading: '审计中...' },
    };
  }

  return {
    isQualityMode: false,
    title: '勾稽关系校验',
    description: '',
    emptyRunText: '尚未运行校验',
    emptyDataText: '暂无校验数据',
    noGroupText: '当前分组下暂无校验数据',
    bulkConfirmText: '一键确认',
    runButtonText: { idle: '重新校验', initial: '运行校验', loading: '运行中...' },
  };
};

const ConsistencyCheckView = ({ reportId, versionId, onEdit, filterGroups = [], onLocate, onChecksUpdated }) => {
  const toast = useToast();
  const confirmAction = useConfirmDialog();
  const [checksData, setChecksData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showAllGroups, setShowAllGroups] = useState({});

  const modeMeta = useMemo(() => buildModeMeta(filterGroups), [filterGroups]);
  const consistencySourceGroups = useMemo(() => {
    if (!checksData || modeMeta.isQualityMode) return [];
    const groups = checksData.groups || [];
    return groups.filter((group) =>
      filterGroups?.length ? filterGroups.includes(group.group_key) : true
    );
  }, [checksData, filterGroups, modeMeta.isQualityMode]);

  const consistencyAggregation = useMemo(() => {
    if (!checksData || modeMeta.isQualityMode) return null;
    return aggregateIssuesFromChecks(consistencySourceGroups, {
      domain: 'consistency',
      displayMode: 'management',
      includeUncertain: true,
      includeConfirmed: true,
      includeDismissed: true,
      displayNoScope: 'group',
    });
  }, [checksData, consistencySourceGroups, modeMeta.isQualityMode]);

  const fetchChecks = async () => {
    if (!reportId) return;

    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`, {
        params: versionId ? { version_id: versionId } : undefined,
      });
      const data = response.data?.data || response.data || { groups: [], latest_run: null };
      const requiredGroups = modeMeta.isQualityMode ? [] : filterGroups;
      const normalizedGroups = normalizeConsistencyGroups(data.groups || [], requiredGroups);
      setChecksData({ ...data, groups: normalizedGroups });

      setExpandedGroups((prev) => {
        const next = { ...prev };
        const nextGroups = modeMeta.isQualityMode
          ? buildQualityAuditGroups(normalizedGroups, filterGroups)
          : normalizedGroups.filter((group) => (filterGroups?.length ? filterGroups.includes(group.group_key) : true));

        nextGroups.forEach((group) => {
          if (next[group.group_key] === undefined) {
            next[group.group_key] =
              group.hasOnlyNotAssessable ||
              (group.items || []).some(
                (item) => item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN'
              );
          }
        });
        return next;
      });
    } catch (err) {
      setError(err.response?.data?.error || err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChecks();
  }, [reportId, versionId]);

  const handleRunChecks = async () => {
    if (!reportId) return;
    setLoading(true);
    setError('');
    try {
      await apiClient.post(`/reports/${reportId}/checks/run`, {
        ...(versionId ? { version_id: versionId } : {}),
      });
      await fetchChecks();
      onChecksUpdated?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '触发失败');
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (itemId, humanStatus, comment = null) => {
    try {
      await apiClient.patch(`/reports/${reportId}/checks/items/${itemId}`, {
        ...(versionId ? { version_id: versionId } : {}),
        human_status: humanStatus,
        human_comment: comment,
      });
      await fetchChecks();
      onChecksUpdated?.();
    } catch (err) {
      toast.error('更新失败', err.response?.data?.error || err.message || '更新失败');
    }
  };

  const displayedGroups = useMemo(() => {
    if (!checksData) return [];
    if (modeMeta.isQualityMode) {
      return buildQualityAuditGroups(checksData.groups || [], filterGroups);
    }
    if (!consistencyAggregation) {
      return consistencySourceGroups;
    }
    return consistencySourceGroups.map((group) => ({
      ...group,
      items: consistencyAggregation.issuesByGroupKey[group.group_key] || [],
      stats: consistencyAggregation.groupSummaries[group.group_key] || group.stats,
      hasOnlyNotAssessable:
        (consistencyAggregation.groupSummaries[group.group_key]?.ruleCount || 0) === 0 &&
        (consistencyAggregation.groupSummaries[group.group_key]?.notAssessableCount || 0) > 0,
    }));
  }, [checksData, consistencyAggregation, consistencySourceGroups, filterGroups, modeMeta.isQualityMode]);

  const getVisibleGroupItems = (group) => {
    const items = group.group_key === 'hierarchy'
      ? sortHierarchyItemsForDisplay(group.items || [])
      : (group.items || []);
    if (group.group_key !== 'hierarchy' || showAllGroups[group.group_key] || items.length <= HEAVY_GROUP_INITIAL_LIMIT) {
      return {
        visibleItems: items,
        hiddenCount: 0,
        totalCount: items.length,
      };
    }

    const activeItems = items.filter((item) => item.auto_status !== 'PASS');
    const passItems = items.filter((item) => item.auto_status === 'PASS');
    const visibleItems = activeItems.length >= HEAVY_GROUP_INITIAL_LIMIT
      ? activeItems.slice(0, HEAVY_GROUP_INITIAL_LIMIT)
      : [...activeItems, ...passItems.slice(0, HEAVY_GROUP_INITIAL_LIMIT - activeItems.length)];

    return {
      visibleItems,
      hiddenCount: Math.max(items.length - visibleItems.length, 0),
      totalCount: items.length,
    };
  };

  const summary = useMemo(() => {
    if (!checksData?.latest_run) {
      return modeMeta.isQualityMode
        ? {
            itemCount: 0,
            riskCount: 0,
            reviewCount: 0,
            resolvedCount: 0,
            dismissedCount: 0,
            notAssessableCount: 0,
          }
        : {
            ruleCount: 0,
            problemCount: 0,
            pendingCount: 0,
            pendingCountRaw: 0,
            confirmedCount: 0,
            dismissedCount: 0,
            notAssessableCount: 0,
          };
    }

    return modeMeta.isQualityMode
      ? summarizeQualityAuditGroups(displayedGroups)
      : (consistencyAggregation?.summary || summarizeConsistencyGroups(displayedGroups));
  }, [checksData, displayedGroups, consistencyAggregation, modeMeta.isQualityMode]);

  const hierarchySummaryStats = useMemo(() => {
    if (modeMeta.isQualityMode) return null;
    const hierarchyGroup = displayedGroups.find((group) => group.group_key === 'hierarchy');
    return hierarchyGroup ? getHierarchyDisplayStats(hierarchyGroup.items || []) : null;
  }, [displayedGroups, modeMeta.isQualityMode]);

  const handleBulkConfirm = async () => {
    const pendingItemIds = modeMeta.isQualityMode
      ? collectPendingConsistencyItemIds(displayedGroups)
      : (consistencyAggregation?.pendingItemIds || collectPendingConsistencyItemIds(displayedGroups));
    const pendingItems = Array.from(new Set(pendingItemIds));

    if (pendingItems.length === 0) {
      toast.info(modeMeta.isQualityMode ? '没有可标记为已处理的数据质量提示' : '没有可确认的待处理项');
      return;
    }

    const confirmText = modeMeta.isQualityMode
      ? `确认将 ${pendingItems.length} 个数据质量提示全部标记为“已处理”吗？`
      : `确认将 ${pendingItems.length} 个待处理项全部标记为“已确认”吗？`;
    const confirmed = await confirmAction({
      title: modeMeta.isQualityMode ? '批量标记数据质量提示' : '批量确认待处理项',
      message: confirmText,
      confirmText: modeMeta.isQualityMode ? '标记已处理' : '确认处理',
      tone: 'default',
    });
    if (!confirmed) {
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post(`/reports/${reportId}/checks/items/bulk-status`, {
        ...(versionId ? { version_id: versionId } : {}),
        item_ids: pendingItems,
        human_status: 'confirmed',
        human_comment: modeMeta.isQualityMode ? '批量标记为已处理' : '批量确认',
      });
      const updatedCount = response.data?.updated_count ?? pendingItems.length;
      await fetchChecks();
      onChecksUpdated?.();
      if (updatedCount === pendingItems.length) {
        toast.success('批量处理完成', `已处理 ${updatedCount} 项。`);
      } else {
        toast.warning('批量处理部分完成', `已处理 ${updatedCount} / ${pendingItems.length} 项，请刷新后查看剩余项。`);
      }
    } catch (err) {
      await fetchChecks();
      toast.error('批量处理失败', err.response?.data?.error || err.message || '批量处理失败');
      setLoading(false);
    }
  };

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  };

  const renderHierarchyActions = (item) => {
    const effectiveHumanStatus = getEffectiveConsistencyHumanStatus(item);

    return (
      <div className="hierarchy-row-actions">
        {effectiveHumanStatus !== 'confirmed' && item.id ? (
          <button
            className="btn-confirm"
            onClick={() => handleUpdateStatus(item.id, 'confirmed', '层级汇总差额已人工确认')}
          >
            确认
          </button>
        ) : null}
        {effectiveHumanStatus !== 'dismissed' && item.id ? (
          <button
            className="btn-dismiss"
            onClick={() => handleUpdateStatus(item.id, 'dismissed', '经核查无需处理')}
          >
            忽略
          </button>
        ) : null}
        {effectiveHumanStatus !== 'pending' && item.id && item.auto_status !== 'PASS' ? (
          <button className="btn-pending" onClick={() => handleUpdateStatus(item.id, 'pending', null)}>
            恢复待核查
          </button>
        ) : null}
      </div>
    );
  };

  const renderNamePreview = (items, emptyText) => {
    const names = asArray(items)
      .map((item) => item.regionName || item.name || item.regionId)
      .filter(Boolean);
    if (names.length === 0) return emptyText;
    return names.join('、');
  };

  const renderHierarchyGroup = (group, visibleItems, hiddenCount, totalCount) => {
    const hierarchyStats = getHierarchyDisplayStats(group.items || []);
    const visibleItemsByTable = visibleItems.reduce((buckets, item) => {
      const tableLabel = getHierarchyTableLabel(item);
      if (!buckets[tableLabel]) {
        buckets[tableLabel] = [];
      }
      buckets[tableLabel].push(item);
      return buckets;
    }, {});
    const visibleTableLabels = Object.keys(visibleItemsByTable).sort(
      (a, b) => (HIERARCHY_TABLE_ORDER[a] || 99) - (HIERARCHY_TABLE_ORDER[b] || 99)
    );

    return (
      <>
        <div className="hierarchy-overview">
          <div className="hierarchy-overview-card hierarchy-overview-card--danger">
            <span>有差额的指标</span>
            <strong>{hierarchyStats.deltaCount}</strong>
          </div>
          <div className="hierarchy-overview-card">
            <span>缺同年报告单位</span>
            <strong>{hierarchyStats.missingReportUnitCount}</strong>
          </div>
          <div className="hierarchy-overview-card">
            <span>缺字段单位</span>
            <strong>{hierarchyStats.missingMetricUnitCount}</strong>
          </div>
        </div>

        {hiddenCount > 0 ? (
          <div className="group-render-limit-note">
            <div>
              层级汇总本次共有 {totalCount} 条指标，已按表格分组并在表内按差额展示前 {visibleItems.length} 条，减少页面卡顿和长滚动。
            </div>
            <button
              type="button"
              className="btn-show-all"
              onClick={() => setShowAllGroups((prev) => ({ ...prev, [group.group_key]: true }))}
            >
              查看全部
            </button>
          </div>
        ) : null}

        {visibleItems.length === 0 ? (
          <div className="no-issues">暂无层级汇总指标</div>
        ) : (
          <div className="hierarchy-compact-list">
            {visibleTableLabels.map((tableLabel) => (
              <section key={tableLabel} className="hierarchy-table-section">
                <div className="hierarchy-table-section__head">
                  <span>{tableLabel}</span>
                  <strong>{visibleItemsByTable[tableLabel].length} 项</strong>
                </div>
                <div className="hierarchy-table-section__items">
                  {visibleItemsByTable[tableLabel].map((item, index) => {
                    const values = getHierarchyEvidenceValues(item);
                    const missingReports = asArray(values.missingReports);
                    const missingMetricChildren = asArray(values.missingMetricChildren);
                    const hasDelta = hasHierarchyDelta(item);
                    const statusLabel = getHierarchyStatusLabel(item);
                    const metricTitle = values.metricLabel || item.title?.replace(/^层级汇总一致性：\S+\s+/, '') || item.title;
                    const childReportCount = values.childReportCount ?? 0;
                    const childCount = values.childCount ?? 0;
                    const childMetricCount = values.childMetricCount ?? 0;
                    const effectiveHumanStatus = getEffectiveConsistencyHumanStatus(item);

                    return (
                      <div
                        key={item.stableIssueId || item.id || `hierarchy-${tableLabel}-${index}`}
                        className={`hierarchy-row${hasDelta ? ' hierarchy-row--delta' : ''}`}
                      >
                        <div className="hierarchy-row-main">
                          <span className="hierarchy-row-table">{tableLabel}</span>
                          <div className="hierarchy-row-title">
                            <strong>{metricTitle}</strong>
                            <span>人工状态：{getConsistencyHumanStatusLabel(effectiveHumanStatus)}</span>
                          </div>
                          <span className={`hierarchy-row-status${hasDelta ? ' hierarchy-row-status--danger' : ''}`}>
                            {statusLabel}
                          </span>
                        </div>

                        <div className="hierarchy-values-grid">
                          <div>
                            <span>本级值</span>
                            <strong>{formatHierarchyNumber(item.left_value)}</strong>
                          </div>
                          <div>
                            <span>下级合计</span>
                            <strong>{formatHierarchyNumber(item.right_value)}</strong>
                          </div>
                          <div>
                            <span>差额</span>
                            <strong className={hasDelta ? 'delta-nonzero' : ''}>
                              {formatHierarchyNumber(item.delta)}
                            </strong>
                          </div>
                          <div>
                            <span>纳入范围</span>
                            <strong>{childReportCount}/{childCount}</strong>
                          </div>
                        </div>

                        <div className="hierarchy-row-meta">
                          <span>已纳入字段单位 {childMetricCount}</span>
                          <span>缺同年报告 {missingReports.length}</span>
                          <span>缺该字段 {missingMetricChildren.length}</span>
                        </div>

                        {(missingReports.length > 0 || missingMetricChildren.length > 0) ? (
                          <details className="hierarchy-missing-detail">
                            <summary>查看缺失单位</summary>
                            <div>
                              <span>缺同年报告：</span>
                              <strong>{renderNamePreview(missingReports, '无')}</strong>
                            </div>
                            <div>
                              <span>缺该字段：</span>
                              <strong>{renderNamePreview(missingMetricChildren, '无')}</strong>
                            </div>
                          </details>
                        ) : null}

                        {renderHierarchyActions(item)}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </>
    );
  };

  if (loading && !checksData) return <div className="loading">{modeMeta.runButtonText.loading}</div>;
  if (error && !checksData) return <div className="error-message">{error}</div>;
  if (!checksData) return <div className="no-data">{modeMeta.emptyDataText}</div>;

  return (
    <div className={`consistency-check-view${modeMeta.isQualityMode ? ' consistency-check-view--quality' : ''}`}>
      <div className={`check-header${modeMeta.isQualityMode ? ' check-header--quality' : ''}`}>
        <div className="check-info">
          <h3>{modeMeta.title}</h3>
          {checksData.latest_run ? (
            <>
              <div className="summary">
                {modeMeta.isQualityMode ? (
                  <>
                    <span className="summary-item quality-risk">风险提示 {summary.riskCount}</span>
                    <span className="summary-item quality-review">需复核 {summary.reviewCount}</span>
                    <span className="summary-item confirmed">已处理 {summary.resolvedCount}</span>
                    <span className="summary-item dismissed">不可判断 {summary.notAssessableCount}</span>
                  </>
                ) : (
                  <>
                    <span className="summary-item fail">问题 {summary.problemCount}</span>
                    {hierarchySummaryStats?.deltaCount > 0 ? (
                      <span className="summary-item hierarchy-delta">
                        层级差额 {hierarchySummaryStats.deltaCount}
                      </span>
                    ) : null}
                    <span className="summary-item pending">待复核 {summary.pendingCount}</span>
                    <span className="summary-item confirmed">已确认 {summary.confirmedCount}</span>
                    <span className="summary-item dismissed">不可评估 {summary.notAssessableCount}</span>
                  </>
                )}
              </div>
              {modeMeta.description ? <p className="check-description">{modeMeta.description}</p> : null}
            </>
          ) : (
            <p className="no-run">{modeMeta.emptyRunText}</p>
          )}
          {error ? <div className="error-message" style={{ marginTop: '12px' }}>{error}</div> : null}
        </div>
        <div className="header-actions">
          {checksData.latest_run &&
          (modeMeta.isQualityMode ? summary.reviewCount > 0 : summary.pendingCountRaw > 0) ? (
            <button
              className={`btn-bulk-confirm${modeMeta.isQualityMode ? ' btn-bulk-confirm--quality' : ''}`}
              onClick={handleBulkConfirm}
              disabled={loading}
            >
              {modeMeta.bulkConfirmText}
            </button>
          ) : null}
          <button
            className={`btn-run-checks${modeMeta.isQualityMode ? ' btn-run-checks--quality' : ''}`}
            onClick={handleRunChecks}
            disabled={loading}
          >
            {loading
              ? modeMeta.runButtonText.loading
              : checksData.latest_run
                ? modeMeta.runButtonText.idle
                : modeMeta.runButtonText.initial}
          </button>
        </div>
      </div>

      {modeMeta.isQualityMode ? (
        <div className="quality-audit-note">
          数据质量提示不计入勾稽问题，也不会改变表三/表四的问题编号与定位。
        </div>
      ) : null}

      <div className="groups-container">
        {displayedGroups.map((group) => {
          const groupKey = group.group_key || 'unknown';
          const expanded = expandedGroups[groupKey] ?? false;
          const { visibleItems, hiddenCount, totalCount } = getVisibleGroupItems(group);

          return (
            <div
              key={groupKey}
              className={`group-card${modeMeta.isQualityMode ? ' group-card--quality' : ''}`}
            >
              <div className={`group-header${modeMeta.isQualityMode ? ' group-header--quality' : ''}`} onClick={() => toggleGroup(groupKey)}>
                <div className="group-header-main">
                  <h4>{expanded ? '▼' : '▶'} {group.displayName}</h4>
                  {renderGroupSummary(group, modeMeta.isQualityMode)}
                  {group.helperText ? <div className="group-helper-text">{group.helperText}</div> : null}
                </div>
              </div>

              {expanded ? (
                <div className="group-items">
                  {groupKey === 'hierarchy' ? (
                    renderHierarchyGroup(group, visibleItems, hiddenCount, totalCount)
                  ) : (
                    <>
                      {group.hasOnlyNotAssessable && visibleItems.length > 0 ? (
                        <div className="group-empty-state">
                          <div className="group-empty-title">
                            {modeMeta.isQualityMode ? '暂无可判断提示' : '暂无可评估规则'}
                          </div>
                          <div className="group-empty-desc">
                            {modeMeta.isQualityMode ? '当前仅保留提示入口，不计入风险数量。' : '当前仅保留分组入口，不计入问题。'}
                          </div>
                        </div>
                      ) : null}
                      {visibleItems.length === 0 ? (
                        <div className="no-issues">
                          {modeMeta.isQualityMode ? '暂无数据质量提示' : '暂无规则项'}
                        </div>
                      ) : group.hasOnlyNotAssessable && visibleItems.length === 0 ? (
                        <div className="group-empty-state">
                          <div className="group-empty-title">
                            {modeMeta.isQualityMode ? '暂无可判断提示' : '暂无可评估规则'}
                          </div>
                          <div className="group-empty-desc">
                            {modeMeta.isQualityMode ? '当前仅保留提示入口，不计入风险数量。' : '当前仅保留分组入口，不计入问题。'}
                          </div>
                        </div>
                      ) : (
                    visibleItems.map((item, index) => {
                      const severityClass = getSeverityColor(item.auto_status, modeMeta.isQualityMode);
                      const locatePayload = getLocatePayload(item);
                      const canLocate =
                        onLocate &&
                        (locatePayload.leftPaths.length > 0 || locatePayload.rightPaths.length > 0);
                      const { leftSources, rightSources, context } =
                        getLocationInfo(item) || { leftSources: [], rightSources: [], context: null };
                      const itemNo = modeMeta.isQualityMode ? item.qualityDisplayNo : item.displayNo;
                      const autoStatusLabel = modeMeta.isQualityMode
                        ? getQualityAuditAutoStatusLabel(item.auto_status)
                        : getConsistencyAutoStatusLabel(item.auto_status);
                      const effectiveHumanStatus = getEffectiveConsistencyHumanStatus(item);
                      const humanStatusLabel = modeMeta.isQualityMode
                        ? getQualityAuditHumanStatusLabel(effectiveHumanStatus)
                        : getConsistencyHumanStatusLabel(effectiveHumanStatus);
                      const locateTitle = itemNo
                        ? `${modeMeta.isQualityMode ? '提示' : '问题'} ${itemNo}｜${item.title}`
                        : item.title;
                      const evidenceModel = shouldShowEvidenceViewModel(item)
                        ? buildEvidenceViewModel(item, { qualityMode: modeMeta.isQualityMode })
                        : null;

                      return (
                        <div
                          key={item.stableIssueId || item.id || `${groupKey}-${index}`}
                          className={`check-item ${severityClass}${modeMeta.isQualityMode ? ' check-item--quality' : ''}`}
                        >
                          <div className="item-header">
                            <span className={`status-badge ${severityClass}`}>
                              {autoStatusLabel}
                            </span>
                            <div className="item-title-wrap">
                              <span className="item-title">
                                {itemNo ? `${modeMeta.isQualityMode ? '提示' : '问题'} ${itemNo}｜` : ''}
                                {item.title}
                              </span>
                              <span className="item-subtitle">
                                人工状态：{humanStatusLabel}
                              </span>
                            </div>
                          </div>

                          <div className="item-details">
                            <div className={`values enhanced-values${modeMeta.isQualityMode ? ' enhanced-values--quality' : ''}`}>
                              <div className="value-component">
                                <div className="value-line">
                                  <span className={`value-label${modeMeta.isQualityMode ? ' value-label--quality-left' : ''}`}>
                                    左值
                                  </span>
                                  <strong className="value-strong">
                                    {item.left_value ?? 'N/A'}
                                  </strong>
                                </div>
                                <div className="value-source-list">
                                  {leftSources.length > 0 ? leftSources.map((src, srcIndex) => (
                                    <div
                                      key={`${item.stableIssueId || item.id}-left-${srcIndex}`}
                                      className="value-source-row"
                                    >
                                      <span>{src.type === 'table' ? '表' : '文'}</span>
                                      <span>{src.label}</span>
                                    </div>
                                  )) : <span className="value-source-empty">无详细来源信息</span>}
                                </div>
                              </div>

                              <div className="value-component value-component--split">
                                <div className="value-line">
                                  <span className={`value-label${modeMeta.isQualityMode ? ' value-label--quality-right' : ' value-label--compare-right'}`}>
                                    右值
                                  </span>
                                  <strong className="value-strong">
                                    {item.right_value ?? 'N/A'}
                                  </strong>
                                </div>
                                <div className="value-source-list">
                                  {rightSources.length > 0 ? rightSources.map((src, srcIndex) => (
                                    <div
                                      key={`${item.stableIssueId || item.id}-right-${srcIndex}`}
                                      className="value-source-row"
                                    >
                                      <span>{src.type === 'table' ? '表' : '文'}</span>
                                      <span>{src.label}</span>
                                    </div>
                                  )) : <span className="value-source-empty">无详细来源信息</span>}
                                </div>
                              </div>

                              <div className="value-row diff-row">
                                <span className={`value-label${modeMeta.isQualityMode ? ' value-label--quality-right' : ' value-label--compare-diff'}`}>
                                  差额
                                </span>
                                <strong
                                  className={Math.abs(item.delta || 0) > 0.001 ? 'delta-nonzero' : ''}
                                >
                                  {item.delta ?? 'N/A'}
                                </strong>
                              </div>

                              {context ? (
                                <div className={`location-panel enhanced${modeMeta.isQualityMode ? ' location-panel--quality' : ''}`}>
                                  <div className="context-highlight">
                                    <div className={`context-label${modeMeta.isQualityMode ? ' context-label--quality' : ''}`}>
                                      匹配文本上下文
                                    </div>
                                    <div
                                      className={`context-text${modeMeta.isQualityMode ? ' context-text--quality' : ''}`}
                                      dangerouslySetInnerHTML={{ __html: context }}
                                    />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            {renderEvidenceSummary(evidenceModel)}
                          </div>

                          <div className="item-actions">
                            <div className="human-status">
                              人工复核：<strong>{humanStatusLabel}</strong>
                              {item.human_comment ? <span className="comment"> - {item.human_comment}</span> : null}
                            </div>
                            <div className="action-buttons">
                              {canLocate ? (
                                <button
                                  className={`btn-locate${modeMeta.isQualityMode ? ' btn-locate--quality' : ''}`}
                                  onClick={() =>
                                    onLocate({
                                      item,
                                      title: locateTitle,
                                      leftPaths: locatePayload.leftPaths,
                                      rightPaths: locatePayload.rightPaths,
                                      fallbackPaths: locatePayload.fallbackPaths,
                                    })
                                  }
                                >
                                  {modeMeta.isQualityMode ? '定位到表格/原文' : '定位到表格'}
                                </button>
                              ) : null}
                              {effectiveHumanStatus !== 'confirmed' && item.id ? (
                                <button
                                  className={`btn-confirm${modeMeta.isQualityMode ? ' btn-confirm--quality' : ''}`}
                                  onClick={() =>
                                    handleUpdateStatus(
                                      item.id,
                                      'confirmed',
                                      modeMeta.isQualityMode ? '已处理，建议人工核对原文或表格' : '确认问题'
                                    )
                                  }
                                >
                                  {modeMeta.isQualityMode ? '标记已处理' : '确认问题'}
                                </button>
                              ) : null}
                              {effectiveHumanStatus !== 'dismissed' && item.id ? (
                                <button
                                  className="btn-dismiss"
                                  onClick={() =>
                                    handleUpdateStatus(
                                      item.id,
                                      'dismissed',
                                      modeMeta.isQualityMode ? '非有效风险，已忽略' : '非问题，已忽略'
                                    )
                                  }
                                >
                                  忽略
                                </button>
                              ) : null}
                              {effectiveHumanStatus !== 'pending' && item.id && item.auto_status !== 'PASS' ? (
                                <button className="btn-pending" onClick={() => handleUpdateStatus(item.id, 'pending', null)}>
                                  恢复待复核
                                </button>
                              ) : null}
                              {!modeMeta.isQualityMode && item.auto_status === 'FAIL' && onEdit ? (
                                <button className="btn-edit" onClick={() => onEdit(item.evidence?.paths || [])}>
                                  修改数据
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                      )}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        {displayedGroups.length === 0 ? <div className="no-data">{modeMeta.noGroupText}</div> : null}
      </div>
    </div>
  );
};

export default ConsistencyCheckView;
