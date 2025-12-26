import React, { useEffect, useState, useCallback } from 'react';
import './ComparisonHistory.css';
import { apiClient } from '../apiClient';
import ComparisonDetailView from './ComparisonDetailView';

function ComparisonHistory() {
  const [comparisons, setComparisons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [exporting, setExporting] = useState(null);
  const [showWatermarkModal, setShowWatermarkModal] = useState(null);
  const [watermarkText, setWatermarkText] = useState('');
  const [selectedComparisonId, setSelectedComparisonId] = useState(null);

  const [regionFilter, setRegionFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  const fetchComparisons = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: page,
        pageSize: 20,
      });
      if (regionFilter) params.append('region_name', regionFilter);
      if (yearFilter) params.append('year', yearFilter);

      const resp = await apiClient.get(`/comparisons/history?${params.toString()}`);
      setComparisons(resp.data?.data || []);
      setTotalPages(resp.data?.totalPages || 1);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [page, regionFilter, yearFilter]);

  useEffect(() => {
    fetchComparisons();
  }, [fetchComparisons]);

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条比对记录吗？')) return;
    try {
      await apiClient.delete(`/comparisons/${id}`);
      // Refresh list
      fetchComparisons();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      alert(`删除失败：${message}`);
    }
  };

  const handleSearch = () => {
    setPage(1);
    fetchComparisons();
  };

  const handleViewDetail = (comparison) => {
    setSelectedComparisonId(comparison.id);
  };

  const handleBackToList = () => {
    setSelectedComparisonId(null);
  };

  const handleExportPdf = (id) => {
    // Strategy Change: Instead of backend generation, open the detail view 
    // in a new tab with autoPrint flag to use the browser's print engine.
    window.open(`/comparison/${id}?autoPrint=true`, '_blank');
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

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
    <div className="comparison-history">
      <div className="history-header">
        <h2>📋 比对结果汇总</h2>

        <div className="filter-bar" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="📍 按地区筛选"
            value={regionFilter}
            onChange={e => setRegionFilter(e.target.value)}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
          />
          <input
            type="text"
            placeholder="📅 按年份筛选"
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            style={{ padding: '8px', border: '1px solid #ccc', borderRadius: '4px', width: '120px' }}
          />
          <button
            onClick={handleSearch}
            className="refresh-btn"
            style={{ background: '#3b82f6', color: 'white', border: 'none' }}
          >
            🔍 查询
          </button>
        </div>

        <button onClick={fetchComparisons} disabled={loading} className="refresh-btn">
          {loading ? '刷新中...' : '刷新'}
        </button>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading && comparisons.length === 0 ? (
        <div className="loading-state">加载中...</div>
      ) : comparisons.length === 0 ? (
        <div className="empty-state">
          <p>暂无比对记录</p>
          <p className="hint">在年报汇总页面选择两份报告进行比对后，结果将显示在这里。</p>
        </div>
      ) : (
        <>
          <table className="history-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>地区</th>
                <th>年份A</th>
                <th>年份B</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c) => (
                <tr key={c.id}>
                  <td>#{c.id}</td>
                  <td>{c.regionName || '未知'}</td>
                  <td>{c.yearA}</td>
                  <td>{c.yearB}</td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>
                    <div className="actions">
                      <button
                        className="icon-btn view"
                        onClick={() => handleViewDetail(c)}
                        title="查看详情"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        <span>查看</span>
                      </button>
                      <button
                        className="icon-btn print"
                        onClick={() => handleExportPdf(c.id)}
                        title="打印导出"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 6 2 18 2 18 9"></polyline>
                          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                          <rect x="6" y="14" width="12" height="8"></rect>
                        </svg>
                        <span>打印</span>
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() => handleDelete(c.id)}
                        title="删除记录"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        <span>删除</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                上一页
              </button>
              <span>第 {page} / {totalPages} 页</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )
      }

      {/* Watermark Modal */}
      {
        showWatermarkModal && (
          <div className="modal-overlay" onClick={() => setShowWatermarkModal(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h3>导出文档</h3>
              <p>请输入水印文字（可选）：</p>
              <input
                type="text"
                value={watermarkText}
                onChange={e => setWatermarkText(e.target.value)}
                placeholder="例如：公司名称"
                className="watermark-input"
              />
              <div className="modal-actions">
                <button onClick={() => setShowWatermarkModal(null)} className="cancel-btn">
                  取消
                </button>
                <button onClick={() => handleExportPdf(showWatermarkModal)} className="confirm-btn">
                  导出
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default ComparisonHistory;
