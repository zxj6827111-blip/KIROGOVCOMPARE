import React, { useState } from 'react';
import './TaskList.css';
import { apiClient, buildApiUrl } from '../apiClient';

function TaskList({ tasks, loading, onRefresh, onViewTask }) {
  const [deleting, setDeleting] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  const getStatusColor = (status) => {
    const colors = {
      queued: '#ffa500',
      running: '#2196f3',
      succeeded: '#4caf50',
      failed: '#f44336',
    };
    return colors[status] || '#999';
  };

  const getStatusText = (status) => {
    const texts = {
      queued: '等待中',
      running: '处理中',
      succeeded: '已完成',
      failed: '失败',
    };
    return texts[status] || status;
  };

  const getStageText = (stage) => {
    const texts = {
      ingesting: '摄入中',
      downloading: '下载中',
      parsing: '解析中',
      structuring: '结构化中',
      diffing: '比对中',
      summarizing: '摘要中',
      exporting: '导出中',
    };
    return texts[stage] || stage;
  };

  const handleDelete = async (taskId) => {
    if (!window.confirm('确定要删除这个任务吗？')) {
      return;
    }

    setDeleting(taskId);
    try {
      await apiClient.delete(`/v1/tasks/${taskId}`);
      onRefresh();
    } catch (error) {
      alert('删除失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (taskId, type = 'diff') => {
    const url = buildApiUrl(`/v1/tasks/${taskId}/download/${type}`);
    window.open(url, '_blank');
  };

  const filteredTasks = filterStatus === 'all' 
    ? tasks 
    : tasks.filter(t => t.status === filterStatus);

  return (
    <div className="task-list-container">
      <div className="task-list-header">
        <h2>📋 任务列表</h2>
        <div className="header-controls">
          <select 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
            className="filter-select"
          >
            <option value="all">全部状态</option>
            <option value="queued">等待中</option>
            <option value="running">处理中</option>
            <option value="succeeded">已完成</option>
            <option value="failed">失败</option>
          </select>
          <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? '加载中...' : '🔄 刷新'}
          </button>
        </div>
      </div>

      {loading && <div className="loading">加载中...</div>}

      {!loading && filteredTasks.length === 0 && (
        <div className="empty-state">
          <p>📭 暂无任务</p>
          <p>点击"创建任务"开始比对</p>
        </div>
      )}

      {!loading && filteredTasks.length > 0 && (
        <div className="task-grid">
          {filteredTasks.map((task) => (
            <div key={task.taskId} className="task-card">
              <div className="task-header">
                <h3>{task.taskId}</h3>
                <span
                  className="status-badge"
                  style={{ backgroundColor: getStatusColor(task.status) }}
                >
                  {getStatusText(task.status)}
                </span>
              </div>

              <div className="task-info">
                <p>
                  <strong>资产 A:</strong> {task.assetId_A}
                </p>
                <p>
                  <strong>资产 B:</strong> {task.assetId_B}
                </p>
                <div className="progress-section">
                  <div className="progress-label">
                    <strong>进度:</strong> {task.progress}%
                    {task.stage && <span className="stage-text">({getStageText(task.stage)})</span>}
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${task.progress}%` }}></div>
                  </div>
                </div>
                <p>
                  <strong>创建时间:</strong>{' '}
                  {new Date(task.createdAt).toLocaleString('zh-CN')}
                </p>
              </div>

              {task.message && (
                <div className="task-message">💬 {task.message}</div>
              )}

              {task.warnings && task.warnings.length > 0 && (
                <div className="task-warnings">
                  ⚠️ {task.warnings.length} 个警告
                </div>
              )}

              <div className="task-actions">
                <button
                  className="view-btn"
                  onClick={() => onViewTask(task)}
                >
                  查看详情
                </button>
                {task.status === 'succeeded' && (
                  <button
                    className="download-btn"
                    onClick={() => handleDownload(task.taskId, 'diff')}
                  >
                    📥 下载报告
                  </button>
                )}
                <button
                  className="delete-btn"
                  onClick={() => handleDelete(task.taskId)}
                  disabled={deleting === task.taskId}
                >
                  {deleting === task.taskId ? '删除中...' : '🗑️ 删除'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TaskList;
