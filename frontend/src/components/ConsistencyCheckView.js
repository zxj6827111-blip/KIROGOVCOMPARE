import React, { useState, useEffect } from 'react';
import './ConsistencyCheckView.css';
import { apiClient } from '../apiClient';

const ConsistencyCheckView = ({ reportId, onEdit }) => {
  const [checksData, setChecksData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState({ table3: true, table4: true, text: true });

  const fetchChecks = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`);
      const data = response.data?.data || response.data;
      setChecksData(data);
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

  return (
    <div className="consistency-check-view">
      <div className="check-header">
        <div className="check-info">
          <h3>🧮 勾稽关系校验</h3>
          {latest_run ? (
            <div className="summary">
              <span className="summary-item fail">失败: {latest_run.summary.fail}</span>
              <span className="summary-item uncertain">不确定: {latest_run.summary.uncertain}</span>
              <span className="summary-item pending">待复核: {latest_run.summary.pending}</span>
              <span className="summary-item confirmed">已确认: {latest_run.summary.confirmed}</span>
              <span className="summary-item dismissed">已忽略: {latest_run.summary.dismissed}</span>
            </div>
          ) : (
            <p className="no-run">尚未运行校验</p>
          )}
        </div>
        <button className="btn-run-checks" onClick={handleRunChecks} disabled={loading}>
          {loading ? '运行中...' : latest_run ? '重新校验' : '运行校验'}
        </button>
      </div>

      {latest_run && (
        <div className="groups-container">
          {groups.map(group => (
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
                          <div className="formula">
                            <strong>公式:</strong> {item.expr}
                          </div>
                          <div className="values">
                            <span>左值: <strong>{item.left_value ?? 'N/A'}</strong></span>
                            <span>右值: <strong>{item.right_value ?? 'N/A'}</strong></span>
                            <span>差值: <strong className={Math.abs(item.delta || 0) > 0.001 ? 'delta-nonzero' : ''}>
                              {item.delta ?? 'N/A'}
                            </strong></span>
                          </div>
                          
                          {item.evidence && item.evidence.paths && (
                            <details className="evidence-details">
                              <summary>证据（JSON 路径）</summary>
                              <ul className="evidence-paths">
                                {item.evidence.paths.map((path, idx) => (
                                  <li key={idx}><code>{path}</code></li>
                                ))}
                              </ul>
                              <pre className="evidence-values">
                                {JSON.stringify(item.evidence.values, null, 2)}
                              </pre>
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
                                onClick={() => onEdit(item.evidence?.paths)}
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
