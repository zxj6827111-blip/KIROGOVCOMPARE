import React, { useState, useEffect } from 'react';
import './ConsistencyCheckView.css';
import { apiClient } from '../apiClient';

// 将 JSON 路径解析为人类可读的位置描述
const parseLocationFromPath = (path) => {
  if (!path) return null;

  const pathMappings = {
    // 表三相关路径
    'tableData.total.results.totalProcessed': '表三 → 办理结果总计 → 总数',
    'tableData.total.results.disclosure.activeDisclosure': '表三 → 办理结果总计 → 予以公开 → 主动公开',
    'tableData.total.results.disclosure.dependentApplication': '表三 → 办理结果总计 → 予以公开 → 依申请公开',
    'tableData.total.results.partialDisclosure.applyForInfo': '表三 → 办理结果总计 → 部分公开 → 申请信息',
    'tableData.total.results.notDisclosed': '表三 → 办理结果总计 → 不予公开',
    'tableData.total.results.notAccepted.notOwnInfo': '表三 → 办理结果总计 → 不予处理 → 非本机关信息',
    'tableData.total.results.notAccepted.notExist': '表三 → 办理结果总计 → 不予处理 → 信息不存在',
    'tableData.total.results.other': '表三 → 办理结果总计 → 其他处理',
    'tableData.total.results.transferred': '表三 → 办理结果总计 → 已移送',
    'tableData.total.channelStats': '表三 → 渠道统计',
    'tableData.currentYear': '表三 → 本年新收申请',
    'tableData.previousYear': '表三 → 上年结转申请',

    // 表四相关路径
    'reviewLitigationData.review.total': '表四 → 行政复议 → 总计',
    'reviewLitigationData.review.maintain': '表四 → 行政复议 → 维持',
    'reviewLitigationData.review.correct': '表四 → 行政复议 → 纠正',
    'reviewLitigationData.review.other': '表四 → 行政复议 → 其他',
    'reviewLitigationData.review.unfinished': '表四 → 行政复议 → 尚未审结',
    'reviewLitigationData.litigationDirect.total': '表四 → 未经复议直接起诉 → 总计',
    'reviewLitigationData.litigationDirect.maintain': '表四 → 未经复议直接起诉 → 维持',
    'reviewLitigationData.litigationDirect.correct': '表四 → 未经复议直接起诉 → 纠正',
    'reviewLitigationData.litigationPostReview.total': '表四 → 复议后起诉 → 总计',

    // 表二相关路径
    'activeDisclosureData.regulations': '表二 → 规章',
    'activeDisclosureData.normativeDocuments': '表二 → 规范性文件',
    'activeDisclosureData.licensing': '表二 → 行政许可',
    'activeDisclosureData.punishment': '表二 → 行政处罚',
    'activeDisclosureData.coercion': '表二 → 行政强制',

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
      return suffix ? `${value} → ${suffix}` : value;
    }
  }

  // 通用解析
  const parts = path.split('.');
  const readableParts = parts.map(part => {
    const mappings = {
      'tableData': '表三数据',
      'reviewLitigationData': '表四数据',
      'activeDisclosureData': '表二数据',
      'text': '正文',
      'total': '总计',
      'results': '办理结果',
      'channelStats': '渠道统计',
      'currentYear': '本年新收',
      'previousYear': '上年结转',
      'disclosure': '公开',
      'review': '行政复议',
      'litigationDirect': '未经复议直接起诉',
      'litigationPostReview': '复议后起诉',
      'maintain': '维持',
      'correct': '纠正',
      'other': '其他',
      'unfinished': '尚未审结',
      'content': '内容',
    };
    return mappings[part] || part;
  });

  return readableParts.join(' → ');
};

// 在文本中高亮数字 - 使用 HTML 标记
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

  const result = {
    textSource: null,  // 正文来源
    tableSource: null, // 表格来源
    context: null,     // 上下文（带高亮）
    leftValue: item.left_value,
    rightValue: item.right_value,
  };

  const values = item.evidence.values || {};
  const paths = item.evidence.paths || [];

  // 解析表格来源路径
  paths.forEach(path => {
    if (path.includes('tableData') || path.includes('reviewLitigationData')) {
      const desc = parseLocationFromPath(path);
      if (desc && !result.tableSource) {
        result.tableSource = desc;
      }
    }
  });

  // 如果有章节标题信息（从正文匹配中）
  if (values.sectionTitle) {
    const sectionNum = values.sectionIndex ? `第${values.sectionIndex}部分` : '';
    result.textSource = `${sectionNum}「${values.sectionTitle}」`;
  } else if (values.matchedText || paths.some(p => p.includes('content'))) {
    // 回退显示的 Text Source
    result.textSource = '正文相关内容';
  }

  // 在上下文中高亮数字 - 独立于 sectionTitle 判断
  if (values.context) {
    result.context = highlightNumber(values.context, values.textValue);
  } else if (values.matchedText) {
    result.context = highlightNumber(values.matchedText, values.textValue);
  }

  return result;
};

const ConsistencyCheckView = ({ reportId, onEdit, filterGroups }) => {
  const [checksData, setChecksData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({});

  // ... fetchChecks ...

  const fetchChecks = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`);
      const data = response.data?.data || response.data;
      setChecksData(data);

      // 根据是否有问题项来决定默认展开状态
      if (data?.groups) {
        const newExpandedState = {};
        data.groups.forEach(group => {
          // 只展开有 FAIL 或 UNCERTAIN 状态项目的分组
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
  }, [reportId]);

  const handleRunChecks = async () => {
    setLoading(true);
    setError('');
    try {
      await apiClient.post(`/reports/${reportId}/checks/run`, {});

      // 等待3秒后重新获取
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

      // 刷新数据
      fetchChecks();
    } catch (err) {
      alert(err.response?.data?.error || err.message || '更新失败');
    }
  };

  // 一键确认所有待复核项
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
      // 批量更新所有待复核项
      for (const itemId of pendingItems) {
        await apiClient.patch(
          `/reports/${reportId}/checks/items/${itemId}`,
          { human_status: 'confirmed', human_comment: '批量确认' }
        );
      }

      // 刷新数据
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

  // Re-writing the block below with correct logic
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
                    group.items.map(item => (
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
                          <div className="values">
                            <span>左值: <strong>{item.left_value ?? 'N/A'}</strong></span>
                            <span>右值: <strong>{item.right_value ?? 'N/A'}</strong></span>
                            <span>差值: <strong className={Math.abs(item.delta || 0) > 0.001 ? 'delta-nonzero' : ''}>
                              {item.delta ?? 'N/A'}
                            </strong></span>
                          </div>

                          {/* 位置信息（增强显示） */}
                          {(() => {
                            const locInfo = getLocationInfo(item);
                            if (!locInfo) return null;

                            const isTextVsTable = locInfo.textSource && locInfo.tableSource;

                            return (
                              <div className="location-panel enhanced">
                                <div className="location-header">
                                  <span className="location-icon">📍</span>
                                  <strong>数据定位：</strong>
                                </div>

                                {isTextVsTable ? (
                                  <div className="comparison-sources">
                                    <div className="source-item text-source">
                                      <div className="source-label">📄 正文来源</div>
                                      <div className="source-value">{locInfo.textSource}</div>
                                      <div className="source-number">
                                        提取数值: <span className="highlight-num error">{locInfo.leftValue}</span>
                                      </div>
                                    </div>
                                    <div className="vs-arrow">⟷</div>
                                    <div className="source-item table-source">
                                      <div className="source-label">📊 表格来源</div>
                                      <div className="source-value">{locInfo.tableSource}</div>
                                      <div className="source-number">
                                        表格数值: <span className="highlight-num correct">{locInfo.rightValue}</span>
                                      </div>
                                    </div>
                                  </div>
                                ) : locInfo.tableSource ? (
                                  <div className="single-source">
                                    <div className="source-label">📊 表格位置</div>
                                    <div className="source-value">{locInfo.tableSource}</div>
                                  </div>
                                ) : null}

                                {locInfo.context && (
                                  <div className="context-highlight">
                                    <div className="context-label">🔍 匹配文本：</div>
                                    <div
                                      className="context-text"
                                      dangerouslySetInnerHTML={{ __html: locInfo.context }}
                                    />
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
                    ))
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
