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

  const fetchComparisons = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get(`/comparisons/history?page=${page}&pageSize=20`);
      setComparisons(resp.data?.data || []);
      setTotalPages(resp.data?.totalPages || 1);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchComparisons();
  }, [fetchComparisons]);

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条比对记录吗？')) return;
    try {
      await apiClient.delete(`/comparisons/${id}`);
      fetchComparisons();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      alert(`删除失败：${message}`);
    }
  };

  const handleViewDetail = (comparison) => {
    setSelectedComparisonId(comparison.id);
  };

  const handleBackToList = () => {
    setSelectedComparisonId(null);
  };

  const handleExportPdf = async (id) => {
    setExporting(id);
    setShowWatermarkModal(null);
    try {
      const response = await apiClient.post(`/comparisons/${id}/export/pdf`, {
        watermark_text: watermarkText || undefined,
        watermark_opacity: 0.1,
      }, { responseType: 'blob' });

      const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comparison_${id}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('导出失败');
    } finally {
      setExporting(null);
      setWatermarkText('');
    }
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
                  <td className="actions">
                    <button
                      className="action-btn view-btn"
                      onClick={() => handleViewDetail(c)}
                    >
                      👁️ 查看
                    </button>
                    <button
                      className="action-btn export-btn"
                      onClick={() => setShowWatermarkModal(c.id)}
                      disabled={exporting === c.id}
                    >
                      {exporting === c.id ? '导出中...' : '📥 导出PDF'}
                    </button>
                    <button
                      className="action-btn delete-btn"
                      onClick={() => handleDelete(c.id)}
                    >
                      🗑️ 删除
                    </button>
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
