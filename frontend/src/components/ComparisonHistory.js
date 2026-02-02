import React, { useEffect, useState, useCallback } from 'react';
import './ComparisonHistory.css';
import { apiClient } from '../apiClient';
import ComparisonDetailView from './ComparisonDetailView';
import CompareFailureModal from './CompareFailureModal';
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
  Zap,
  Loader
} from 'lucide-react';

function ComparisonHistory() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedComparisonId, setSelectedComparisonId] = useState(null);

  const [regionFilter, setRegionFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [batchCreating, setBatchCreating] = useState(false);

  // New state for failure modal
  const [showFailureModal, setShowFailureModal] = useState(false);
  const [failedJobCount, setFailedJobCount] = useState(0);

  // Server-side tree structure state
  const [treeData, setTreeData] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [grandTotalIssues, setGrandTotalIssues] = useState(0);
  const [expandedNodes, setExpandedNodes] = useState(new Set());

  // Lazy-loaded comparisons per region: { regionId: { data: [...], loading: boolean, loaded: boolean } }
  const [regionComparisons, setRegionComparisons] = useState({});

  const fetchFailedCount = useCallback(async () => {
    try {
      const res = await apiClient.get('/comparisons/failed-jobs');
      const jobs = res.data || [];
      setFailedJobCount(jobs.length);
    } catch (err) {
      console.error('Failed to fetch failed jobs count', err);
    }
  }, []);

  // Fetch tree structure from server (no individual comparisons)
  // preserveCache: if true, don't clear regionComparisons (used after delete/modify)
  const fetchTree = useCallback(async (preserveCache = false) => {
    setLoading(true);
    setError('');

    try {
      // 1. Fetch Tree Data
      const params = new URLSearchParams();
      if (regionFilter) params.append('region_name', regionFilter);
      if (yearFilter) params.append('year', yearFilter);
      if (showIssuesOnly) params.append('showIssuesOnly', 'true');

      const resp = await apiClient.get(`/comparisons/tree?${params.toString()}`);
      const data = resp.data;

      setTreeData(data.tree || []);
      setGrandTotal(data.grandTotal || 0);
      setGrandTotalIssues(data.grandTotalIssues || 0);

      // Only auto-expand on initial load (when no nodes are expanded)
      setExpandedNodes(prev => {
        if (prev.size === 0 && data.tree && data.tree.length > 0) {
          const firstLevelIds = data.tree.map(n => n.id);
          return new Set(firstLevelIds);
        }
        return prev;
      });

      // Clear loaded comparisons only when filters change (not on refresh)
      if (!preserveCache) {
        setRegionComparisons({});
      }

      // 2. Fetch Failed Jobs Count
      fetchFailedCount();

    } catch (err) {
      console.error('Failed to fetch tree:', err);
      const message = err.response?.data?.error || err.message || '加载失败';
      setError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [regionFilter, yearFilter, showIssuesOnly, fetchFailedCount]);

  // Fetch comparisons for a specific region (lazy loading)
  const fetchRegionComparisons = useCallback(async (regionId) => {
    // Mark as loading
    setRegionComparisons(prev => ({
      ...prev,
      [regionId]: { ...prev[regionId], loading: true }
    }));

    try {
      const params = new URLSearchParams({
        region_id: regionId,
        pageSize: 100
      });
      if (yearFilter) params.append('year', yearFilter);
      if (showIssuesOnly) params.append('showIssuesOnly', 'true');

      const resp = await apiClient.get(`/comparisons/by-region?${params.toString()}`);
      const comparisons = resp.data?.data || [];

      setRegionComparisons(prev => ({
        ...prev,
        [regionId]: { data: comparisons, loading: false, loaded: true }
      }));
    } catch (err) {
      console.error('Failed to fetch region comparisons:', err);
      setRegionComparisons(prev => ({
        ...prev,
        [regionId]: { data: [], loading: false, loaded: true, error: err.message }
      }));
    }
  }, [yearFilter, showIssuesOnly]);

  // Initial load
  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  // Toggle node expansion and trigger lazy load if needed
  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
        // Trigger lazy load if not already loaded
        const regionState = regionComparisons[nodeId];
        if (!regionState?.loaded && !regionState?.loading) {
          fetchRegionComparisons(nodeId);
        }
      }
      return newSet;
    });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条比对记录吗？')) return;
    try {
      await apiClient.delete(`/comparisons/${id}`);

      // Remove from local cache immediately for instant UI update
      setRegionComparisons(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(regionId => {
          if (updated[regionId]?.data) {
            updated[regionId] = {
              ...updated[regionId],
              data: updated[regionId].data.filter(c => c.id !== id)
            };
          }
        });
        return updated;
      });

      // Also remove from selected
      setSelectedIds(prev => prev.filter(i => i !== id));

      // Refresh tree to get updated stats (but preserve cache)
      fetchTree(true);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      alert(`删除失败：${message}`);
    }
  };

  const handleSearch = () => {
    fetchTree();
  };

  const handleViewDetail = (comparison) => {
    setSelectedComparisonId(comparison.id);
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

  // Selection handlers - need to collect all loaded comparisons
  const getAllLoadedComparisons = () => {
    const all = [];
    Object.values(regionComparisons).forEach(region => {
      if (region.data) {
        all.push(...region.data);
      }
    });
    return all;
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const allComps = getAllLoadedComparisons();
    if (selectedIds.length === allComps.length && allComps.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(allComps.map(c => c.id));
    }
  };

  // Batch download
  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) {
      alert('请先选择要导出的记录');
      return;
    }

    if (!window.confirm(`确定要批量导出 ${selectedIds.length} 个比对报告吗？`)) return;

    const allComps = getAllLoadedComparisons();
    let successCount = 0;
    for (const id of selectedIds) {
      const c = allComps.find(comp => comp.id === id);
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
    fetchTree();
    alert(`已删除 ${successCount} 条记录`);
  };

  // 一键比对：批量创建比对任务
  const handleBatchCreate = async () => {
    if (!window.confirm('将为所有有连续两年年报但尚未创建比对任务的区域批量生成比对任务，确定继续？')) {
      return;
    }

    setBatchCreating(true);
    try {
      const resp = await apiClient.post('/comparisons/batch-create');
      const data = resp.data;

      if (data.success) {
        if (data.created_count > 0) {
          alert(`${data.message}`);
          fetchTree();
        } else {
          alert(data.message || '没有符合条件的待比对区域');
        }
      } else {
        alert('批量创建失败：' + (data.error || '未知错误'));
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || '批量创建失败';
      alert(`批量创建失败：${message}`);
    } finally {
      setBatchCreating(false);
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

  // Render tree node with lazy-loaded comparisons
  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const regionState = regionComparisons[node.id] || { data: [], loading: false, loaded: false };
    const comparisons = regionState.data || [];
    const isLoadingComps = regionState.loading;

    // When filtering by issues, skip nodes with no issues
    if (showIssuesOnly && node.totalIssues === 0) return null;

    // Filter comparisons for issues only if needed
    const filteredComps = showIssuesOnly
      ? comparisons.filter(c => (c.checkStatus && c.checkStatus !== '正常') || (c.similarity && c.similarity > 60))
      : comparisons;

    return (
      <React.Fragment key={node.id}>
        {/* Region Header Row */}
        <tr className={`region-header-row level-${node.level}`} onClick={() => toggleNode(node.id)}>
          <td colSpan="8">
            <div className="region-header-content" style={{ paddingLeft: depth * 24 }}>
              <span className="expand-icon">
                {(hasChildren || node.totalComparisons > 0) && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
              </span>
              <span className="region-name">{node.name}</span>
              <span className="region-stats">
                <span className="stat-badge">{node.totalComparisons} 份比对</span>
                {node.totalIssues > 0 && (
                  <span className="stat-badge issue">
                    <AlertCircle size={12} /> {node.totalIssues} 份异常
                  </span>
                )}
              </span>
            </div>
          </td>
        </tr>

        {/* Loading indicator for this node's comparisons */}
        {isExpanded && isLoadingComps && (
          <tr className="loading-row">
            <td colSpan="8" style={{ paddingLeft: (depth + 1) * 24 }}>
              <span className="loading-indicator">
                <Loader size={14} className="spin" /> 加载比对记录中...
              </span>
            </td>
          </tr>
        )}

        {/* Comparisons under this region (lazy loaded) */}
        {isExpanded && !isLoadingComps && filteredComps.map(c => (
          <tr key={c.id} className={`comparison-row level-${node.level} ${selectedIds.includes(c.id) ? 'selected-row' : ''}`}>
            <td style={{ paddingLeft: (depth + 1) * 24 }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(c.id)}
                onChange={() => toggleSelect(c.id)}
                onClick={e => e.stopPropagation()}
              />
            </td>
            <td className="cell-region">
              <span className="sub-region-name">{c.regionName || node.name}</span>
            </td>
            <td className="cell-year">{c.yearA}</td>
            <td className="cell-year">{c.yearB}</td>
            <td className="cell-date">{formatDate(c.createdAt)}</td>
            <td className="cell-similarity">
              {c.similarity != null ? (
                <span className={`similarity-value ${c.similarity > 80 ? 'high' : c.similarity > 60 ? 'medium' : 'low'}`}>
                  {c.similarity}%
                </span>
              ) : <span className="text-gray-400">-</span>}
            </td>
            <td className="cell-status">
              {c.checkStatus?.startsWith('异常') ? (
                <span className="status-badge issue">{c.checkStatus}</span>
              ) : c.checkStatus === '正常' ? (
                <span className="status-badge ok">正常</span>
              ) : (
                <span className="text-gray-400">-</span>
              )}
            </td>
            <td className="cell-actions">
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
                  onClick={() => handleExportPdf(c.id, `${c.regionName || node.name} ${c.yearA}-${c.yearB} 年报对比`)}
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

        {/* Child regions */}
        {isExpanded && hasChildren && node.children.map(child => renderTreeNode(child, depth + 1))}
      </React.Fragment>
    );
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
          <button
            onClick={() => setShowIssuesOnly(!showIssuesOnly)}
            className={`filter-toggle-btn ${showIssuesOnly ? 'active' : ''}`}
            title={showIssuesOnly ? '显示全部' : '只看问题'}
          >
            <AlertCircle size={16} />
            {showIssuesOnly ? '显示全部' : '只看问题'}
          </button>
          <button
            onClick={handleBatchCreate}
            disabled={batchCreating || loading}
            className="batch-create-btn iconic-btn"
            title="为所有有连续两年年报但未比对的区域批量创建比对任务"
          >
            <Zap size={16} className={batchCreating ? 'spin' : ''} />
            {batchCreating ? '创建中...' : '一键比对'}
          </button>
          <button
            onClick={fetchTree}
            disabled={loading}
            className="refresh-btn iconic-btn"
            title="刷新列表"
          >
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {loading ? '刷新中...' : '刷新'}
          </button>
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
        </div>
      </div>

      {/* Summary Stats */}
      {!loading && (grandTotal > 0 || failedJobCount > 0) && (
        <div className="summary-bar">
          <span className="summary-item">
            共 <strong>{grandTotal}</strong> 份比对记录
          </span>
          {grandTotalIssues > 0 && (
            <span className="summary-item issue">
              <AlertCircle size={14} />
              <strong>{grandTotalIssues}</strong> 份存在问题
            </span>
          )}
          {failedJobCount > 0 && (
            <span
              className="summary-item failure clickable"
              onClick={() => setShowFailureModal(true)}
              title="点击查看并重试失败任务"
            >
              <AlertCircle size={14} />
              <strong>{failedJobCount}</strong> 份比对失败
            </span>
          )}
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="loading-state">加载中...</div>
      ) : grandTotal === 0 ? (
        <div className="empty-state">
          <p>暂无比对记录</p>
          <p className="hint">上传年报后，系统将自动生成与上一年的比对报告。</p>
        </div>
      ) : (
        <>
          <table className="history-table tree-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.length > 0 && selectedIds.length === getAllLoadedComparisons().length}
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
              {treeData.length > 0 ? (
                treeData.map(node => renderTreeNode(node, 0))
              ) : (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}

      <CompareFailureModal
        isOpen={showFailureModal}
        onClose={() => setShowFailureModal(false)}
        onJobRetried={() => {
          fetchFailedCount();
          // Optional: refresh tree if successful retries created new valid records immediately (unlikely, they go to queue first)
        }}
      />
    </div>
  );
}

export default ComparisonHistory;
