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
  Download
} from 'lucide-react';

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
  const [selectedIds, setSelectedIds] = useState([]);

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

  const handleExportPdf = async (id, title) => {
    // Create async PDF export job instead of synchronous download
    try {
      const response = await apiClient.post('/pdf-jobs', {
        comparison_id: id,
        title: title
      });

      if (response.data?.success) {
        // Show success message with option to go to Job Center
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

  // Selection handlers
  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === comparisons.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(comparisons.map(c => c.id));
    }
  };

  // Batch download - creates PDF export jobs for all selected
  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) {
      alert('请先选择要导出的记录');
      return;
    }

    if (!window.confirm(`确定要批量导出 ${selectedIds.length} 个比对报告吗？`)) return;

    let successCount = 0;
    for (const id of selectedIds) {
      const c = comparisons.find(comp => comp.id === id);
      if (c) {
        try {
          await apiClient.post('/pdf-jobs', {
            comparison_id: id,
            title: `${c.regionName || '未知地区'} ${c.yearA}-${c.yearB} 年报对比`
          });
          successCount++;
        } catch (err) {
          console.error('Failed to create PDF job for', id, err);
        }
      }
    }

    setSelectedIds([]);
    alert(`已创建 ${successCount} 个导出任务，请前往任务中心查看进度`);
  };

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      alert('请先选择要删除的记录');
      return;
    }

    if (!window.confirm(`确定要删除选中的 ${selectedIds.length} 条比对记录吗？此操作不可恢复。`)) return;

    let successCount = 0;
    for (const id of selectedIds) {
      try {
        await apiClient.delete(`/comparisons/${id}`);
        successCount++;
      } catch (err) {
        console.error('Failed to delete comparison', id, err);
      }
    }

    setSelectedIds([]);
    fetchComparisons();
    alert(`已删除 ${successCount} 条记录`);
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
        <div className="filter-bar" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div className="input-with-icon">
            <MapPin size={16} className="input-icon" />
            <input
              type="text"
              placeholder="按地区筛选"
              value={regionFilter}
              onChange={e => setRegionFilter(e.target.value)}
              className="filter-input"
            />
          </div>
          <div className="input-with-icon">
            <Calendar size={16} className="input-icon" />
            <input
              type="text"
              placeholder="按年份筛选"
              value={yearFilter}
              onChange={e => setYearFilter(e.target.value)}
              className="filter-input"
              style={{ width: '120px' }}
            />
          </div>
          <button
            onClick={handleSearch}
            className="search-btn"
          >
            <Search size={16} /> 查询
          </button>
        </div>

        <div className="header-actions" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {selectedIds.length > 0 && (
            <>
              <button onClick={handleBatchDownload} className="batch-btn download-btn">
                <Download size={16} /> 批量导出 ({selectedIds.length})
              </button>
              <button onClick={handleBatchDelete} className="batch-btn delete-btn">
                <Trash2 size={16} /> 批量删除 ({selectedIds.length})
              </button>
            </>
          )}
          <button onClick={fetchComparisons} disabled={loading} className="refresh-btn iconic-btn">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
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
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.length === comparisons.length && comparisons.length > 0}
                    onChange={toggleSelectAll}
                    title="全选/取消全选"
                  />
                </th>
                <th>地区</th>
                <th>年份A</th>
                <th>年份B</th>
                <th>创建时间</th>
                <th>文字重复率</th>
                <th>数据勾稽问题</th>
                <th style={{ minWidth: '220px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((c) => (
                <tr key={c.id} className={selectedIds.includes(c.id) ? 'selected-row' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(c.id)}
                      onChange={() => toggleSelect(c.id)}
                    />
                  </td>
                  <td>{c.regionName || '未知'}</td>
                  <td>{c.yearA}</td>
                  <td>{c.yearB}</td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>
                    {c.similarity != null ? <span className="font-bold">{c.similarity}%</span> : <span className="text-gray-400">-</span>}
                  </td>
                  <td>
                    {c.checkStatus?.startsWith('异常') ? <span className="text-red-600 font-bold">{c.checkStatus}</span> :
                      c.checkStatus === '正常' ? <span className="text-green-600">正常</span> :
                        <span className="text-gray-400">-</span>}
                  </td>
                  <td>
                    <div className="actions">
                      <button
                        className="icon-btn view"
                        onClick={() => handleViewDetail(c)}
                        title="查看详情"
                      >
                        <Eye size={16} />
                        <span>查看</span>
                      </button>
                      <button
                        className="icon-btn print"
                        onClick={() => handleExportPdf(c.id, `${c.regionName || '未知地区'} ${c.yearA}-${c.yearB} 年报对比`)}
                        title="打印导出"
                      >
                        <Printer size={16} />
                        <span>打印</span>
                      </button>
                      <button
                        className="icon-btn delete"
                        onClick={() => handleDelete(c.id)}
                        title="删除记录"
                      >
                        <Trash2 size={16} />
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
