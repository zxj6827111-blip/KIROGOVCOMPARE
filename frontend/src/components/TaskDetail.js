import React, { useState, useEffect } from 'react';
import TextComparison from './TextComparison';
import TableComparison from './TableComparison';
import JobStatus from './JobStatus';
import './TaskDetail.css';
import { apiClient, API_BASE_URL } from '../apiClient';

function TaskDetail({ task, onBack }) {
  const [diffResult, setDiffResult] = useState(null);
  const [summary, setSummary] = useState(null);
  const [viewModel, setViewModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloadError, setDownloadError] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const jobId = task?.jobId || task?.job_id;

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const [diffRes, summaryRes, viewModelRes] = await Promise.all([
          apiClient.get(`/v1/tasks/${task.taskId}/diff`),
          apiClient.get(`/v1/tasks/${task.taskId}/summary`),
          apiClient.get(`/v1/tasks/${task.taskId}/view-model`),
        ]);
        setDiffResult(diffRes.data);
        setSummary(summaryRes.data);
        setViewModel(viewModelRes.data);
      } catch (error) {
        console.error('获取详情失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [task.taskId]);

  const handleDownload = () => {
    setDownloadError('');
    const url = `${API_BASE_URL}/comparisons/${task.taskId}/export?format=docx`;

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error('下载失败');
        }
        return response.blob();
      })
      .then((blob) => {
        const blobUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `comparison-${task.taskId}.docx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        setDownloadError('下载失败，请稍后重试');
      });
  };

  if (loading) {
    return (
      <div className="task-detail-container">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="task-detail-container">
      <button className="back-btn" onClick={onBack}>← 返回</button>

      <div className="detail-header">
        <h2>{task.taskId}</h2>
        <p>资产 A: {task.assetId_A}</p>
        <p>资产 B: {task.assetId_B}</p>
        <div className="actions">
          <button className="primary-btn" onClick={handleDownload}>
            下载 Word
          </button>
          {downloadError && <span className="error-text">{downloadError}</span>}
        </div>
        {jobId && (
          <div className="job-status-container">
            <JobStatus jobId={jobId} />
          </div>
        )}
      </div>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'summary' ? 'active' : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          📊 摘要
        </button>
        <button
          className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          📄 全文对照
        </button>
        <button
          className={`tab-btn ${activeTab === 'table' ? 'active' : ''}`}
          onClick={() => setActiveTab('table')}
        >
          📋 表格对照
        </button>
      </div>

      {activeTab === 'summary' && summary && (
        <div className="summary-section">
          <h3>📈 统计数据</h3>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{summary.statistics.modifiedParagraphs}</div>
              <div className="stat-label">修改段落</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.statistics.addedParagraphs}</div>
              <div className="stat-label">新增段落</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.statistics.deletedParagraphs}</div>
              <div className="stat-label">删除段落</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{summary.statistics.modifiedTables}</div>
              <div className="stat-label">修改表格</div>
            </div>
          </div>

          <h3>🔝 变化最多的章节</h3>
          <div className="sections-list">
            {summary.topChangedSections.map((section, idx) => (
              <div key={idx} className="section-item">
                <h4>{section.sectionName}</h4>
                <p>总变化数: {section.totalChangeCount}</p>
                <div className="breakdown">
                  <span>新增: {section.changeBreakdown.added}</span>
                  <span>删除: {section.changeBreakdown.deleted}</span>
                  <span>修改: {section.changeBreakdown.modified}</span>
                </div>
              </div>
            ))}
          </div>

          <h3>💡 总体评估</h3>
          <div className="assessment">
            <p>{summary.overallAssessment}</p>
          </div>
        </div>
      )}

      {activeTab === 'text' && viewModel && (
        <TextComparison viewModel={viewModel} />
      )}

      {activeTab === 'table' && viewModel && (
        <TableComparison viewModel={viewModel} />
      )}
    </div>
  );
}

export default TaskDetail;
