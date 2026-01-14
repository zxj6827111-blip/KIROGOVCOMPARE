import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../apiClient';
import './DataCenterReportsList.css';

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '进行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'none', label: '无任务' },
];

function DataCenterReportsList({ onSelectReport }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ year: '', unitName: '', status: '' });
  const [query, setQuery] = useState({ year: '', unitName: '', status: '' });

  useEffect(() => {
    const fetchReports = async () => {
      setLoading(true);
      setError('');
      try {
        const params = {};
        if (query.year) params.year = query.year;
        if (query.unitName) params.unit_name = query.unitName;
        if (query.status) params.status = query.status;
        const response = await apiClient.get('/v2/reports', { params });
        const rows = response.data?.data ?? [];
        setReports(Array.isArray(rows) ? rows : []);
      } catch (err) {
        console.error('Failed to load data center reports', err);
        setError('加载报告列表失败');
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, [query]);

  const summary = useMemo(() => {
    const total = reports.length;
    const withActive = reports.filter((r) => r.active_version?.version_id).length;
    const withMaterialize = reports.filter((r) => r.materialize_job?.status).length;
    return { total, withActive, withMaterialize };
  }, [reports]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyFilters = () => {
    setQuery({
      year: filters.year.trim(),
      unitName: filters.unitName.trim(),
      status: filters.status,
    });
  };

  const resetFilters = () => {
    setFilters({ year: '', unitName: '', status: '' });
    setQuery({ year: '', unitName: '', status: '' });
  };

  return (
    <div className="datacenter-reports">
      <div className="datacenter-header">
        <div>
          <h2>Data Center 报告列表</h2>
          <p>按年份/单位/状态筛选，快速定位可 materialize 的报告。</p>
        </div>
        <div className="datacenter-summary">
          <div>
            <span className="label">报告数</span>
            <strong>{summary.total}</strong>
          </div>
          <div>
            <span className="label">已激活版本</span>
            <strong>{summary.withActive}</strong>
          </div>
          <div>
            <span className="label">有 materialize 记录</span>
            <strong>{summary.withMaterialize}</strong>
          </div>
        </div>
      </div>

      <div className="datacenter-filters">
        <div className="filter-group">
          <label>年份</label>
          <input
            type="number"
            value={filters.year}
            onChange={(e) => handleFilterChange('year', e.target.value)}
            placeholder="例如 2023"
          />
        </div>
        <div className="filter-group">
          <label>单位</label>
          <input
            type="text"
            value={filters.unitName}
            onChange={(e) => handleFilterChange('unitName', e.target.value)}
            placeholder="单位名称"
          />
        </div>
        <div className="filter-group">
          <label>状态</label>
          <select
            value={filters.status}
            onChange={(e) => handleFilterChange('status', e.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-actions">
          <button type="button" className="primary" onClick={applyFilters}>
            筛选
          </button>
          <button type="button" className="ghost" onClick={resetFilters}>
            重置
          </button>
        </div>
      </div>

      {error && <div className="datacenter-error">{error}</div>}
      {loading && <div className="datacenter-loading">加载中...</div>}

      <div className="datacenter-report-grid">
        {!loading && reports.length === 0 && <div className="empty">暂无报告</div>}
        {reports.map((report) => (
          <div key={report.report_id} className="datacenter-card">
            <div className="card-header">
              <h3>报告 #{report.report_id}</h3>
              <span className={`status-tag status-${report.materialize_job?.status || 'none'}`}>
                {report.materialize_job?.status || 'none'}
              </span>
            </div>
            <div className="card-body">
              <p>
                <strong>单位：</strong>
                {report.unit_name || report.region_name || report.region_id}
              </p>
              <p>
                <strong>年份：</strong>
                {report.year}
              </p>
              <p>
                <strong>激活版本：</strong>
                {report.active_version?.version_id ? `#${report.active_version.version_id}` : '—'}
              </p>
              <p>
                <strong>版本时间：</strong>
                {report.active_version?.created_at || '—'}
              </p>
              <p>
                <strong>Materialize：</strong>
                {report.materialize_job?.status
                  ? `${report.materialize_job.status} ${report.materialize_job.progress ?? 0}%`
                  : '无'}
              </p>
            </div>
            <div className="card-footer">
              <button type="button" className="link" onClick={() => onSelectReport(report.report_id)}>
                查看详情
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DataCenterReportsList;
