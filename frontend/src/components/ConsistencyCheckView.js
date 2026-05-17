import React, { useEffect, useMemo, useState } from 'react';
import './ConsistencyCheckView.css';
import { apiClient } from '../apiClient';
import { getRowColFromPath, normalizeTablePath } from '../utils/tableRowColMapping';
import {
  buildQualityAuditGroups,
  collectPendingConsistencyItemIds,
  getConsistencyAutoStatusLabel,
  getConsistencyHumanStatusLabel,
  getQualityAuditAutoStatusLabel,
  getQualityAuditHumanStatusLabel,
  normalizeConsistencyGroups,
  QUALITY_AUDIT_GROUP_KEYS,
  summarizeConsistencyGroups,
  summarizeQualityAuditGroups,
} from '../utils/consistencyDisplay';
import { aggregateIssuesFromChecks } from '../utils/issueAggregation';

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
  const [checksData, setChecksData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

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
      const normalizedGroups = normalizeConsistencyGroups(data.groups || []);
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
      window.alert(err.response?.data?.error || err.message || '更新失败');
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

  const handleBulkConfirm = async () => {
    const pendingItems = modeMeta.isQualityMode
      ? collectPendingConsistencyItemIds(displayedGroups)
      : (consistencyAggregation?.pendingItemIds || collectPendingConsistencyItemIds(displayedGroups));

    if (pendingItems.length === 0) {
      window.alert(modeMeta.isQualityMode ? '没有可标记为已处理的数据质量提示' : '没有可确认的待处理项');
      return;
    }

    const confirmText = modeMeta.isQualityMode
      ? `确认将 ${pendingItems.length} 个数据质量提示全部标记为“已处理”吗？`
      : `确认将 ${pendingItems.length} 个待处理项全部标记为“已确认”吗？`;
    if (!window.confirm(confirmText)) {
      return;
    }

    setLoading(true);
    try {
      for (const itemId of pendingItems) {
        await apiClient.patch(`/reports/${reportId}/checks/items/${itemId}`, {
          ...(versionId ? { version_id: versionId } : {}),
          human_status: 'confirmed',
          human_comment: modeMeta.isQualityMode ? '批量标记为已处理' : '批量确认',
        });
      }
      await fetchChecks();
      onChecksUpdated?.();
    } catch (err) {
      window.alert(err.response?.data?.error || err.message || '批量处理失败');
      setLoading(false);
    }
  };

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
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
                  {group.items.length === 0 ? (
                    <div className="no-issues">
                      {modeMeta.isQualityMode ? '暂无数据质量提示' : '暂无规则项'}
                    </div>
                  ) : group.hasOnlyNotAssessable ? (
                    <div className="group-empty-state">
                      <div className="group-empty-title">
                        {modeMeta.isQualityMode ? '暂无可判断提示' : '暂无可评估规则'}
                      </div>
                      <div className="group-empty-desc">
                        {modeMeta.isQualityMode ? '当前仅保留提示入口，不计入风险数量。' : '当前仅保留分组入口，不计入问题。'}
                      </div>
                    </div>
                  ) : (
                    group.items.map((item, index) => {
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
                      const humanStatusLabel = modeMeta.isQualityMode
                        ? getQualityAuditHumanStatusLabel(item.human_status)
                        : getConsistencyHumanStatusLabel(item.human_status);
                      const locateTitle = itemNo
                        ? `${modeMeta.isQualityMode ? '提示' : '问题'} ${itemNo}｜${item.title}`
                        : item.title;

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
                              {item.human_status !== 'confirmed' && item.id ? (
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
                              {item.human_status !== 'dismissed' && item.id ? (
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
                              {item.human_status !== 'pending' && item.id ? (
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
