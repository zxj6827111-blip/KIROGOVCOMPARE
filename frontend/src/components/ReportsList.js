import React, { useEffect, useState } from 'react';
import './ReportsList.css';
import { apiClient } from '../apiClient';

function ReportsList({ onSelectReport }) {
  const [filters, setFilters] = useState({ regionId: '', year: '' });
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.regionId.trim()) params.region_id = filters.regionId.trim();
      if (filters.year.trim()) params.year = filters.year.trim();

      const response = await apiClient.get('/reports', { params });
      const rows = response.data?.data ?? response.data?.reports ?? response.data ?? [];
      setReports(Array.isArray(rows) ? rows : []);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载报告列表失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (field, value) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handleReset = () => {
    setFilters({ regionId: '', year: '' });
    fetchReports();
  };

  const renderJobInfo = (job) => {
    if (!job) return <span className="tag muted">无任务</span>;
    const status = (job.status || 'unknown').toLowerCase();
    return (
      <div className="job-info">
        <span className={`tag status-${status}`}>{job.status || '未知'}</span>
        {job.progress !== undefined && job.progress !== null && (
          <span className="progress">进度：{job.progress}%</span>
        )}
        {job.error_message && <span className="error-text">错误：{job.error_message}</span>}
      </div>
    );
  };

  const handleDeleteReport = async (reportId) => {
    if (!window.confirm(`确认删除报告 #${reportId} 吗？该操作将删除版本与任务记录。`)) return;
    setError('');
    try {
      await apiClient.delete(`/reports/${reportId}`);
      await fetchReports();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`删除报告失败：${message}`);
    }
  };

  return (
    <div className="reports-list">
      <div className="card">
        <div className="card-header">
          <div>
            <h2>报告列表</h2>
            <p className="subtitle">按地区和年份筛选，查看最新任务状态与生效版本</p>
          </div>
          <div className="actions">
            <button className="secondary-btn" onClick={handleReset} disabled={loading}>
              重置
            </button>
            <button className="primary-btn" onClick={fetchReports} disabled={loading}>
              {loading ? '加载中…' : '查询'}
            </button>
          </div>
        </div>

        <div className="filters">
          <div className="form-group">
            <label htmlFor="regionId">region_id</label>
            <input
              id="regionId"
              type="number"
              placeholder="如：310000"
              value={filters.regionId}
              onChange={(e) => handleInputChange('regionId', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="year">year</label>
            <input
              id="year"
              type="number"
              placeholder="如：2024"
              value={filters.year}
              onChange={(e) => handleInputChange('year', e.target.value)}
            />
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="report-cards">
          {!loading && reports.length === 0 && <p className="empty">暂无报告</p>}
          {reports.map((report) => (
            <div key={report.report_id} className="report-card">
              <div className="report-main">
                <div>
                  <h3>报告 #{report.report_id}</h3>
                  <p className="meta">地区：{report.region_id} | 年份：{report.year}</p>
                  <p className="meta">
                    生效版本：
                    {report.active_version_id ? (
                      <span className="tag">ID {report.active_version_id}</span>
                    ) : (
                      <span className="tag muted">暂无</span>
                    )}
                  </p>
                </div>
                <div>{renderJobInfo(report.latest_job)}</div>
              </div>
              <div className="report-footer">
                <button className="link-btn" onClick={() => onSelectReport(report)}>
                  查看详情 →
                </button>
                <button className="link-btn" onClick={() => handleDeleteReport(report.report_id)}>
                  删除报告
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default ReportsList;
