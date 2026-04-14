import React, { useState, useEffect } from 'react';
import './ConsistencyCheckView.css';
import { apiClient } from '../apiClient';
import { getRowColFromPath, normalizeTablePath } from '../utils/tableRowColMapping';

// 将 JSON 路径解析为人类可读的位置描述
const parseLocationFromPath = (path) => {
  if (!path) return null;
  const v2 = parseLocationFromPathV2(path);
  if (v2) return v2;

  // 1. 获取基础表格和字段名称 (利用映射表获取准确的中文显式名称)
  const rowCol = getRowColFromPath(path);
  const tableName = rowCol ? rowCol.table : '表格数据';
  const fieldName = rowCol ? rowCol.name : null;

  // 2. 解析具体的列/分类 (如自然人、商业企业)
  // 注意：不再使用 row/col 数字，而是直接解析语义，因为表格布局可能与内部逻辑行号视觉上不一致
  let categoryName = '';
  if (path.includes('naturalPerson')) categoryName = '自然人列';
  else if (path.includes('legalPerson.commercial')) categoryName = '法人-商业企业列';
  else if (path.includes('legalPerson.research')) categoryName = '法人-科研机构列';
  else if (path.includes('legalPerson.social')) categoryName = '法人-社会公益列';
  else if (path.includes('legalPerson.legal')) categoryName = '法人-法律服务列';
  else if (path.includes('legalPerson.other')) categoryName = '法人-其他列';
  else if (path.includes('total')) categoryName = '总计列';

  // 3. 组合描述: 表名 · 分类 · 字段名
  if (fieldName && categoryName) {
    return `${tableName} · ${categoryName} · ${fieldName}`;
  }

  if (fieldName) {
    return `${tableName} · ${fieldName}`;
  }

  // 4. 回退机制：如果没有精确映射，使用旧的字典映射
  const pathMappings = {
    // 表三相关路径
    'tableData.total.results.totalProcessed': '表三 · 办理结果总计 · 总数',
    'tableData.total.results.disclosure.activeDisclosure': '表三 · 办理结果总计 · 予以公开 · 主动公开',
    'tableData.total.results.disclosure.dependentApplication': '表三 · 办理结果总计 · 予以公开 · 依申请公开',
    'tableData.total.results.partialDisclosure.applyForInfo': '表三 · 办理结果总计 · 部分公开 · 申请信息',
    'tableData.total.results.notDisclosed': '表三 · 办理结果总计 · 不予公开',
    'tableData.total.results.notAccepted.notOwnInfo': '表三 · 办理结果总计 · 不予处理 · 非本机关信息',
    'tableData.total.results.notAccepted.notExist': '表三 · 办理结果总计 · 不予处理 · 信息不存在',
    'tableData.total.results.other': '表三 · 办理结果总计 · 其他处理',
    'tableData.total.results.transferred': '表三 · 办理结果总计 · 已移送',
    'tableData.total.channelStats': '表三 · 渠道统计',
    'tableData.currentYear': '表三 · 本年新收申请',
    'tableData.previousYear': '表三 · 上年结转申请',

    // 表四相关路径
    'reviewLitigationData.review.total': '表四 · 行政复议 · 总计',
    'reviewLitigationData.review.maintain': '表四 · 行政复议 · 维持',
    'reviewLitigationData.review.correct': '表四 · 行政复议 · 纠正',
    'reviewLitigationData.review.other': '表四 · 行政复议 · 其他',
    'reviewLitigationData.review.unfinished': '表四 · 行政复议 · 尚未审结',
    'reviewLitigationData.litigationDirect.total': '表四 · 未经复议直接起诉 · 总计',
    'reviewLitigationData.litigationDirect.maintain': '表四 · 未经复议直接起诉 · 维持',
    'reviewLitigationData.litigationDirect.correct': '表四 · 未经复议直接起诉 · 纠正',
    'reviewLitigationData.litigationPostReview.total': '表四 · 复议后起诉 · 总计',

    // 表二相关路径
    'activeDisclosureData.regulations': '表二 · 规章',
    'activeDisclosureData.normativeDocuments': '表二 · 规范性文件',
    'activeDisclosureData.licensing': '表二 · 行政许可',
    'activeDisclosureData.punishment': '表二 · 行政处罚',
    'activeDisclosureData.coercion': '表二 · 行政强制',

    // 正文相关
    'text.content': '正文内容',
  };

  // 直接匹配
  if (pathMappings[path]) {
    return pathMappings[path];
  }

  // 尝试前缀匹配
  for (const [key, value] of Object.entries(pathMappings)) {
    if (path.startsWith(key)) {
      const suffix = path.replace(key, '').replace(/^\./, '');
      return suffix ? `${value} · ${suffix}` : value;
    }
  }

  return path; // Fallback to raw path if really nothing matches
};

// 在文本中高亮数字 - 使用 HTML 标记
const parseLocationFromPathV2 = (rawPath) => {
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

  const pathMappings = {
    'text.content': '正文内容',
  };

  if (pathMappings[path]) {
    return pathMappings[path];
  }

  for (const [key, value] of Object.entries(pathMappings)) {
    if (path.startsWith(key)) {
      const suffix = path.replace(key, '').replace(/^\./, '');
      return suffix ? `${value} / ${suffix}` : value;
    }
  }

  return null;
};

const highlightNumber = (text, number) => {
  if (!text || number === null || number === undefined) return text;
  const numStr = String(number);
  // 使用 <mark> 标签包裹数字，CSS 会提供高亮样式
  const regex = new RegExp(`(${numStr})`, 'g');
  return text.replace(regex, '<mark class="num-highlight">$1</mark>');
};

// 从 evidence 中提取位置描述，返回结构化信息
const getLocationInfo = (item) => {
  if (!item.evidence) return null;

  const getSourceDesc = (rawPath) => {
    const path = normalizeTablePath(rawPath);
    const isTablePath = path && (path.includes('tableData') || path.includes('reviewLitigationData') || path.includes('activeDisclosureData'));

    if (isTablePath) {
      const desc = parseLocationFromPath(path);
      return { type: 'table', label: `${desc}`, path, rawPath };
    }
    if (path && path.includes('content')) {
      return { type: 'text', label: '正文匹配内容', path, rawPath };
    }
    return { type: 'unknown', label: path || rawPath, path: path || rawPath };
  };

  const parsePaths = (paths) => {
    if (!paths) return [];
    return paths.map(path => getSourceDesc(path));
  };

  // 优先使用分开的 paths
  const leftSources = parsePaths(item.evidence.leftPaths);
  const rightSources = parsePaths(item.evidence.rightPaths);

  // 如果没有分离的 paths（旧数据兼容），尝试从 values 或 paths 猜测，或者直接返回空
  // 但我们的后端已经保证了新数据会有 left/rightPaths

  return {
    leftSources,
    rightSources,
    values: item.evidence.values || {},
    context: item.evidence.values?.context || item.evidence.values?.matchedText
      ? highlightNumber(item.evidence.values.context || item.evidence.values.matchedText, item.evidence.values.textValue)
      : null
  };
};

const ConsistencyCheckView = ({ reportId, versionId, onEdit, filterGroups, onLocate }) => {
  // ... (state and fetch methods same as before)
  const [checksData, setChecksData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  const isTablePath = (path) =>
    path && (path.includes('tableData') || path.includes('reviewLitigationData') || path.includes('activeDisclosureData'));

  const normalizeTablePaths = (paths) =>
    (paths || [])
      .map((p) => normalizeTablePath(p))
      .filter((p) => p && isTablePath(p));

  const getLocatePayload = (item) => {
    const leftPaths = normalizeTablePaths(item?.evidence?.leftPaths);
    const rightPaths = normalizeTablePaths(item?.evidence?.rightPaths);
    const fallbackPaths = normalizeTablePaths(item?.evidence?.paths);

    return {
      leftPaths,
      rightPaths,
      fallbackPaths,
    };
  };

  const fetchChecks = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`, {
        params: versionId ? { version_id: versionId } : undefined,
      });
      const data = response.data?.data || response.data;
      setChecksData(data);

      if (data?.groups) {
        const newExpandedState = {};
        data.groups.forEach(group => {
          const hasProblems = group.items?.some(item =>
            item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN'
          );
          newExpandedState[group.group_key] = hasProblems;
        });
        setExpandedGroups(newExpandedState);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (reportId) {
      fetchChecks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, versionId]);

  const handleRunChecks = async () => {
    setLoading(true);
    setError('');
    try {
      await apiClient.post(`/reports/${reportId}/checks/run`, {
        ...(versionId ? { version_id: versionId } : {}),
      });
      setTimeout(() => {
        fetchChecks();
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '触发失败');
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (itemId, humanStatus, comment = null) => {
    try {
      await apiClient.patch(
        `/reports/${reportId}/checks/items/${itemId}`,
        { human_status: humanStatus, human_comment: comment }
      );
      fetchChecks();
    } catch (err) {
      alert(err.response?.data?.error || err.message || '更新失败');
    }
  };

  const handleBulkConfirm = async () => {
    if (!checksData?.groups) return;
    const pendingItems = [];
    checksData.groups.forEach(group => {
      group.items?.forEach(item => {
        if (item.human_status === 'pending') {
          pendingItems.push(item.id);
        }
      });
    });

    if (pendingItems.length === 0) {
      alert('没有待复核的项目');
      return;
    }

    if (!window.confirm(`确认要将 ${pendingItems.length} 个待复核项目全部标记为“已确认”吗？`)) {
      return;
    }

    setLoading(true);
    try {
      for (const itemId of pendingItems) {
        await apiClient.patch(
          `/reports/${reportId}/checks/items/${itemId}`,
          { human_status: 'confirmed', human_comment: '批量确认' }
        );
      }
      fetchChecks();
    } catch (err) {
      alert(err.response?.data?.error || err.message || '批量确认失败');
      setLoading(false);
    }
  };

  const toggleGroup = (groupKey) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

  const getSeverityColor = (status) => {
    switch (status) {
      case 'FAIL': return 'status-fail';
      case 'UNCERTAIN': return 'status-uncertain';
      case 'PASS': return 'status-pass';
      default: return 'status-other';
    }
  };

  if (loading && !checksData) return <div className="loading">加载中...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!checksData) return <div className="no-data">暂无校验数据</div>;

  const { latest_run, groups } = checksData;
  const displayedGroups = filterGroups
    ? groups.filter(g => filterGroups.includes(g.group_key))
    : groups;

  let displaySummary = latest_run ? { ...latest_run.summary } : { fail: 0, pending: 0, confirmed: 0 };

  if (latest_run && filterGroups) {
    let fail = 0;
    let pending = 0;
    let confirmed = 0;
    displayedGroups.forEach(g => {
      (g.items || []).forEach(item => {
        if (item.auto_status === 'FAIL') fail++;
        if (item.human_status === 'pending') pending++;
        if (item.human_status === 'confirmed') confirmed++;
      });
    });
    displaySummary = { fail, pending, confirmed };
  }

  return (
    <div className="consistency-check-view">
      <div className="check-header">
        <div className="check-info">
          <h3>{filterGroups && filterGroups.includes('visual') ? '◉ 数据质量审计' : '⬡ 勾稽关系校验'}</h3>
          {latest_run ? (
            <div className="summary">
              <span className="summary-item fail">问题: {displaySummary.fail}</span>
              <span className="summary-item pending">待复核: {displaySummary.pending}</span>
              <span className="summary-item confirmed">已确认: {displaySummary.confirmed}</span>
            </div>
          ) : (
            <p className="no-run">尚未运行校验</p>
          )}
        </div>
        <div className="header-actions">
          {latest_run && displaySummary.pending > 0 && (
            <button className="btn-bulk-confirm" onClick={handleBulkConfirm} disabled={loading}>
              ✅ 一键确认
            </button>
          )}
          <button className="btn-run-checks" onClick={handleRunChecks} disabled={loading}>
            {loading ? '运行中...' : latest_run ? '重新校验' : '运行校验'}
          </button>
        </div>
      </div>

      {latest_run && (
        <div className="groups-container">
          {displayedGroups.map(group => (
            <div key={group.group_key} className="group-card">
              <div className="group-header" onClick={() => toggleGroup(group.group_key)}>
                <h4>
                  {expandedGroups[group.group_key] ? '▼' : '▶'} {group.group_name}
                  <span className="item-count">({group.items.length})</span>
                </h4>
              </div>

              {expandedGroups[group.group_key] && (
                <div className="group-items">
                  {group.items.length === 0 ? (
                    <div className="no-issues">✅ 无问题项</div>
                  ) : (
                    group.items.map(item => {
                      const locatePayload = getLocatePayload(item);
                      const canLocate = onLocate && (locatePayload.leftPaths.length > 0 || locatePayload.rightPaths.length > 0);

                      return (
                      <div key={item.id} className={`check-item ${getSeverityColor(item.auto_status)}`}>
                        <div className="item-header">
                          <span className={`status-badge ${getSeverityColor(item.auto_status)}`}>
                            {item.auto_status}
                          </span>
                          <span className="item-title">{item.title}</span>
                        </div>

                        <div className="item-details">
                          <div className="formula" style={{ display: 'none' }}>
                            <strong>公式:</strong> {item.expr}
                          </div>

                          {(() => {
                            const { leftSources, rightSources, context } = getLocationInfo(item) || { leftSources: [], rightSources: [], context: null };
                            const leftColor = '#2563eb'; // blue-600
                            const rightColor = '#ea580c'; // orange-600

                            return (
                              <div className="values enhanced-values" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px', padding: '12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                {/* Left Component */}
                                <div className="value-component" style={{ width: '100%' }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '4px' }}>
                                    <span style={{ color: leftColor, fontWeight: 'bold', minWidth: '60px' }}>左值:</span>
                                    <strong style={{ fontSize: '1.2em', color: '#1e293b' }}>{item.left_value ?? 'N/A'}</strong>
                                  </div>
                                  <div style={{ marginLeft: '60px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {leftSources.length > 0 ? leftSources.map((src, i) => (
                                      <div key={i} style={{ fontSize: '0.85em', color: '#64748b', display: 'flex', alignItems: 'center' }}>
                                        <span style={{ marginRight: '6px' }}>{src.type === 'table' ? '📊' : '📍'}</span>
                                        <span>{src.label}</span>
                                      </div>
                                    )) : <span style={{ fontSize: '0.85em', color: '#94a3b8' }}>无详细来源信息</span>}
                                  </div>
                                </div>

                                {/* Right Component */}
                                <div className="value-component" style={{ width: '100%', borderTop: '1px solid #e2e8f0', paddingTop: '8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: '4px' }}>
                                    <span style={{ color: rightColor, fontWeight: 'bold', minWidth: '60px' }}>右值:</span>
                                    <strong style={{ fontSize: '1.2em', color: '#1e293b' }}>{item.right_value ?? 'N/A'}</strong>
                                  </div>
                                  <div style={{ marginLeft: '60px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {rightSources.length > 0 ? rightSources.map((src, i) => (
                                      <div key={i} style={{ fontSize: '0.85em', color: '#64748b', display: 'flex', alignItems: 'center' }}>
                                        <span style={{ marginRight: '6px' }}>{src.type === 'table' ? '📊' : '📍'}</span>
                                        <span>{src.label}</span>
                                      </div>
                                    )) : <span style={{ fontSize: '0.85em', color: '#94a3b8' }}>无详细来源信息</span>}
                                  </div>
                                </div>

                                <div className="value-row diff-row" style={{ display: 'flex', alignItems: 'center', width: '100%', marginTop: '4px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' }}>
                                  <span style={{ color: '#ef4444', fontWeight: 'bold', minWidth: '60px' }}>差值:</span>
                                  <strong className={Math.abs(item.delta || 0) > 0.001 ? 'delta-nonzero' : ''} style={{ color: '#ef4444' }}>
                                    {item.delta ?? 'N/A'}
                                  </strong>
                                </div>

                                {/* Context */}
                                {context && (
                                  <div className="location-panel enhanced" style={{ marginTop: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '8px', width: '100%' }}>
                                    <div className="context-highlight">
                                      <div className="context-label" style={{ fontSize: '0.85em', fontWeight: 'bold', marginBottom: '4px', color: '#475569' }}>🔍 匹配文本上下文：</div>
                                      <div className="context-text" dangerouslySetInnerHTML={{ __html: context }}></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {item.evidence && item.evidence.paths && (
                            <details className="evidence-details" style={{ display: 'none' }}>
                              <summary>技术详情（JSON 路径）</summary>
                              <ul className="evidence-paths">
                                {item.evidence.paths.map((path, idx) => (
                                  <li key={idx}><code>{path}</code></li>
                                ))}
                              </ul>
                              {item.evidence.values && (
                                <pre className="evidence-values">
                                  {JSON.stringify(item.evidence.values, null, 2)}
                                </pre>
                              )}
                            </details>
                          )}
                        </div>

                        <div className="item-actions">
                          <div className="human-status">
                            人工复核: <strong>{item.human_status}</strong>
                            {item.human_comment && <span className="comment"> - {item.human_comment}</span>}
                          </div>
                          <div className="action-buttons">
                            {canLocate && (
                              <button
                                className="btn-locate"
                                onClick={() => onLocate({
                                  item,
                                  title: item.title,
                                  leftPaths: locatePayload.leftPaths,
                                  rightPaths: locatePayload.rightPaths
                                })}
                              >
                                定位到表格
                              </button>
                            )}
                            {item.human_status !== 'confirmed' && (
                              <button
                                className="btn-confirm"
                                onClick={() => handleUpdateStatus(item.id, 'confirmed', '确认为问题')}
                              >
                                确认问题
                              </button>
                            )}
                            {item.human_status !== 'dismissed' && (
                              <button
                                className="btn-dismiss"
                                onClick={() => handleUpdateStatus(item.id, 'dismissed', '非问题/已忽略')}
                              >
                                忽略
                              </button>
                            )}
                            {item.human_status !== 'pending' && (
                              <button
                                className="btn-pending"
                                onClick={() => handleUpdateStatus(item.id, 'pending', null)}
                              >
                                恢复待复核
                              </button>
                            )}
                            {item.auto_status === 'FAIL' && onEdit && (
                              <button
                                className="btn-edit"
                                onClick={() => {
                                  console.log('修正数据 clicked, paths:', item.evidence?.paths);
                                  onEdit(item.evidence?.paths);
                                }}
                              >
                                修正数据
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )})
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ConsistencyCheckView;
