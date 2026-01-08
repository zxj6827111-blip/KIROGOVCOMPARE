import React, { useEffect, useState, useCallback } from 'react';
import './ComparisonHistory.css';
import { apiClient } from '../apiClient';
import ComparisonDetailView from './ComparisonDetailView';
import {
  MapPin,
  Calendar,
  Search,
  RefreshCw,
  Eye,
  Printer,
  Trash2,
  Download,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle,
  Filter,
  LayoutGrid,
  List
} from 'lucide-react';

function ComparisonHistory() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [expandedRegions, setExpandedRegions] = useState(new Set());
  const [selectedComparisonId, setSelectedComparisonId] = useState(null);
  const [filterMode, setFilterMode] = useState('all'); // 'all' | 'issues'
  const [viewMode, setViewMode] = useState('card'); // 'card' | 'table'
  const [regionFilter, setRegionFilter] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterMode === 'issues') {
        params.append('hasIssuesOnly', 'true');
      }
      const resp = await apiClient.get(`/comparisons/grouped?${params.toString()}`);
      setData(resp.data?.data || { regions: [] });

      // Auto-expand first 3 regions
      const firstRegions = (resp.data?.data?.regions || []).slice(0, 3).map(r => r.region_id);
      setExpandedRegions(new Set(firstRegions));
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [filterMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleRegion = (regionId) => {
    setExpandedRegions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(regionId)) {
        newSet.delete(regionId);
      } else {
        newSet.add(regionId);
      }
      return newSet;
    });
  };

  const handleViewDetail = (comparisonId) => {
    setSelectedComparisonId(comparisonId);
  };

  const handleBackToList = () => {
    setSelectedComparisonId(null);
  };

  const handleExportPdf = async (id, title) => {
    try {
      const response = await apiClient.post('/pdf-jobs', {
        comparison_id: id,
        title: title
      });

      if (response.data?.success) {
        const goToJobCenter = window.confirm(
          `PDF 导出任务已创建！\n\n任务名称：${response.data.export_title}\n\n点击"确定"前往任务中心查看进度，或点击"取消"继续浏览。`
        );
        if (goToJobCenter) {
          window.location.href = '/jobs?tab=download';
        }
      }
    } catch (error) {
      const message = error.response?.data?.message || error.message || '创建任务失败';
      alert(`创建 PDF 导出任务失败：${message}`);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条比对记录吗？')) return;
    try {
      await apiClient.delete(`/comparisons/${id}`);
      fetchData();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      alert(`删除失败：${message}`);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  // Filter regions by name search
  const filteredRegions = (data?.regions || []).filter(r =>
    !regionFilter || r.region_name.toLowerCase().includes(regionFilter.toLowerCase())
  );

  // If a comparison is selected, show the detail view
  if (selectedComparisonId) {
    return (
      <ComparisonDetailView
        comparisonId={selectedComparisonId}
        onBack={handleBackToList}
      />
    );
  }

  return (
    <div className="comparison-history grouped-view">
      {/* Header */}
      <div className="history-header grouped-header">
        <div className="header-left">
          <h2>比对结果汇总</h2>
          {data && !loading && (
            <div className="summary-badges">
              <span className="badge total">
                共 {data.total_comparisons} 份比对
              </span>
              <span className={`badge ${data.total_with_issues > 0 ? 'issues' : 'success'}`}>
                {data.total_with_issues > 0 ? (
                  <><AlertCircle size={14} /> {data.total_with_issues} 份有问题</>
                ) : (
                  <><CheckCircle size={14} /> 全部正常</>
                )}
              </span>
            </div>
          )}
        </div>
        <div className="header-right">
          <div className="filter-tabs">
            <button
              className={`filter-tab ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              全部
            </button>
            <button
              className={`filter-tab ${filterMode === 'issues' ? 'active' : ''}`}
              onClick={() => setFilterMode('issues')}
            >
              <AlertCircle size={14} /> 仅问题
            </button>
          </div>
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="搜索地区..."
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
            />
          </div>
          <button onClick={fetchData} disabled={loading} className="icon-btn refresh">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && !data && (
        <div className="loading-state">
          <RefreshCw size={32} className="spin" />
          <p>加载中...</p>
        </div>
      )}

      {!loading && filteredRegions.length === 0 && (
        <div className="empty-state">
          <p>暂无比对记录</p>
          <p className="hint">上传年报后，系统将自动生成与上一年的比对报告。</p>
        </div>
      )}

      {/* Card View - Grouped by Region */}
      {!loading && filteredRegions.length > 0 && (
        <div className="region-groups">
          {filteredRegions.map(region => (
            <div key={region.region_id} className="region-group">
              {/* Region Header */}
              <div
                className={`region-group-header ${region.with_issues > 0 ? 'has-issues' : ''}`}
                onClick={() => toggleRegion(region.region_id)}
              >
                <div className="region-expand">
                  {expandedRegions.has(region.region_id)
                    ? <ChevronDown size={20} />
                    : <ChevronRight size={20} />
                  }
                </div>
                <div className="region-info">
                  <span className="region-name">{region.region_name}</span>
                  <span className="region-count">{region.total_comparisons} 份比对</span>
                </div>
                <div className="region-status">
                  {region.with_issues > 0 ? (
                    <span className="status-badge issue">
                      <AlertCircle size={14} /> {region.with_issues} 份有问题
                    </span>
                  ) : (
                    <span className="status-badge ok">
                      <CheckCircle size={14} /> 全部正常
                    </span>
                  )}
                </div>
              </div>

              {/* Comparison Cards */}
              {expandedRegions.has(region.region_id) && (
                <div className="comparison-cards">
                  {region.comparisons.map(c => (
                    <div key={c.id} className={`comparison-card ${c.has_issue ? 'has-issue' : ''}`}>
                      <div className="card-header">
                        <span className="year-range">
                          {c.year_a} → {c.year_b}
                        </span>
                        <span className={`card-status ${c.has_issue ? 'issue' : 'ok'}`}>
                          {c.has_issue ? <AlertCircle size={14} /> : <CheckCircle size={14} />}
                        </span>
                      </div>
                      <div className="card-body">
                        <div className="metric">
                          <span className="label">重复率</span>
                          <span className={`value ${c.similarity > 80 ? 'warning' : ''}`}>
                            {c.similarity != null ? `${c.similarity}%` : '-'}
                          </span>
                        </div>
                        {c.check_status && c.check_status !== '正常' && (
                          <div className="issue-detail">
                            {c.check_status}
                          </div>
                        )}
                      </div>
                      <div className="card-footer">
                        <button
                          className="card-btn view"
                          onClick={() => handleViewDetail(c.id)}
                          title="查看详情"
                        >
                          <Eye size={14} /> 查看
                        </button>
                        <button
                          className="card-btn print"
                          onClick={() => handleExportPdf(c.id, `${region.region_name} ${c.year_a}-${c.year_b} 年报对比`)}
                          title="导出PDF"
                        >
                          <Printer size={14} />
                        </button>
                        <button
                          className="card-btn delete"
                          onClick={() => handleDelete(c.id)}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ComparisonHistory;
