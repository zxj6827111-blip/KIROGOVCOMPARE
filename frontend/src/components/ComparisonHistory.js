import React, { useEffect, useState, useCallback } from 'react';
import './ComparisonHistory.css';
import { apiClient } from '../apiClient';
import ComparisonDetailView from './ComparisonDetailView';
import CompareFailureModal from './CompareFailureModal';
import { useToast } from './common/ToastProvider';
import { useTaskDrawer } from './tasks/TaskDrawerProvider';
import Button from './common/Button';
import DataTable from './common/DataTable';
import EmptyState from './common/EmptyState';
import ErrorState from './common/ErrorState';
import ExportPanel from './ExportPanel';
import PageHeader from './common/PageHeader';
import StatusBadge from './common/StatusBadge';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import { getAxiosFriendlyError } from '../utils/errorTranslator';
import {
  MapPin,
  Calendar,
  Search,
  RefreshCw,
  Eye,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Zap,
  Loader
} from 'lucide-react';

const BATCH_REQUEST_CONCURRENCY = 6;

async function runBatchWithConcurrency(items, worker, concurrency = BATCH_REQUEST_CONCURRENCY) {
  let successCount = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(worker));
    successCount += settled.filter(result => result.status === 'fulfilled' && result.value === true).length;
  }
  return {
    successCount,
    failedCount: items.length - successCount,
  };
}

function ComparisonHistory() {
  const toast = useToast();
  const taskDrawer = useTaskDrawer();
  const confirmAction = useConfirmDialog();
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
    const shouldDelete = await confirmAction({
      title: '删除比对记录',
      message: '确定要删除这条比对记录吗？',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
    });
    if (!shouldDelete) return;
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
      toast.error('删除失败', message);
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
        taskDrawer.trackPdfJob({
          job_id: response.data.job_id,
          comparison_id: id,
          status: 'queued',
          progress: 0,
          export_title: response.data.export_title || title,
          file_name: response.data.file_name,
          file_exists: false,
        });
        taskDrawer.openDrawer();
        toast.success('PDF 导出任务已创建', `${response.data.export_title || title} 已加入任务中心。`, {
          actionLabel: '查看导出任务',
          onAction: () => { window.location.href = '/jobs?tab=download'; },
          duration: 8000,
        });
      }
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '创建任务失败，请稍后重试。');
      toast.error('创建 PDF 导出任务失败', friendly.message, { detail: friendly.detail });
    }
  };

  const handlePrintPreview = (id) => {
    window.open(`/print/comparison/${id}`, '_blank', 'noopener,noreferrer');
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
      toast.warning('请先选择要导出的记录');
      return;
    }

    const shouldExport = await confirmAction({
      title: '批量导出比对报告',
      message: `确定要批量导出 ${selectedIds.length} 个比对报告吗？`,
      confirmText: '批量导出',
      cancelText: '取消',
    });
    if (!shouldExport) return;

    const allComps = getAllLoadedComparisons();
    const compMap = new Map(allComps.map(comp => [comp.id, comp]));
    const targets = selectedIds
      .map(id => {
        const comp = compMap.get(id);
        if (!comp) return null;
        return {
          id,
          title: `${comp.regionName || '未知地区'} ${comp.yearA}-${comp.yearB} 年报对比`
        };
      })
      .filter(Boolean);

    if (targets.length === 0) {
      toast.warning('没有可导出的记录', '请先展开地区并选择已加载的比对记录。');
      return;
    }

    const { successCount, failedCount } = await runBatchWithConcurrency(
      targets,
      async (target) => {
        try {
          const response = await apiClient.post('/pdf-jobs', {
            comparison_id: target.id,
            title: target.title
          });
          if (response.data?.success) {
            taskDrawer.trackPdfJob({
              job_id: response.data.job_id,
              comparison_id: target.id,
              status: 'queued',
              progress: 0,
              export_title: response.data.export_title || target.title,
              file_name: response.data.file_name,
              file_exists: false,
            });
          }
          return true;
        } catch (err) {
          console.error('Failed to create PDF job for', target.id, err);
          return false;
        }
      }
    );

    setSelectedIds([]);
    if (successCount > 0) {
      taskDrawer.openDrawer();
    }
    toast.success('批量导出任务已创建', `成功 ${successCount} 个，失败 ${failedCount} 个。`, {
      actionLabel: '查看导出任务',
      onAction: () => { window.location.href = '/jobs?tab=download'; },
      duration: 9000,
    });
  };

  // Batch delete
  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) {
      toast.warning('请先选择要删除的记录');
      return;
    }

    const shouldDelete = await confirmAction({
      title: '批量删除比对记录',
      message: `确定要删除选中的 ${selectedIds.length} 条比对记录吗？此操作不可恢复。`,
      confirmText: '批量删除',
      cancelText: '取消',
      tone: 'danger',
    });
    if (!shouldDelete) return;

    const { successCount, failedCount } = await runBatchWithConcurrency(
      selectedIds,
      async (id) => {
        try {
          await apiClient.delete(`/comparisons/${id}`);
          return true;
        } catch (err) {
          console.error('Failed to delete comparison', id, err);
          return false;
        }
      }
    );

    setSelectedIds([]);
    fetchTree();
    toast.success('批量删除完成', `已删除 ${successCount} 条记录，失败 ${failedCount} 条。`);
  };

  // 一键比对：批量创建比对任务
  const handleBatchCreate = async () => {
    const shouldCreate = await confirmAction({
      title: '批量生成比对任务',
      message: '将为所有有连续两年年报但尚未创建比对任务的区域批量生成比对任务，确定继续？',
      confirmText: '开始生成',
      cancelText: '取消',
    });
    if (!shouldCreate) {
      return;
    }

    setBatchCreating(true);
    try {
      const resp = await apiClient.post('/comparisons/batch-create');
      const data = resp.data;

      if (data.success) {
        if (data.created_count > 0) {
          toast.success('批量创建完成', `${data.message}`);
          fetchTree();
        } else {
          toast.info('没有新增任务', data.message || '没有符合条件的待比对区域');
        }
      } else {
        toast.error('批量创建失败', data.error || '未知错误');
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || '批量创建失败';
      toast.error('批量创建失败', message);
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
                <ExportPanel
                  compact
                  exportLabel="生成 PDF"
                  onCreatePdfJob={() => handleExportPdf(c.id, `${c.regionName || node.name} ${c.yearA}-${c.yearB} 年报对比`)}
                  onPrintPreview={() => handlePrintPreview(c.id)}
                  onOpenJobs={() => { window.location.href = '/jobs?tab=download'; }}
                />
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
      <PageHeader
        title="比对历史"
        subtitle="按地区查看年报比对结果，集中创建 PDF 导出任务"
        badges={(
          <>
            <StatusBadge tone="info">{grandTotal} 份比对</StatusBadge>
            {grandTotalIssues > 0 && <StatusBadge tone="warning">{grandTotalIssues} 份异常</StatusBadge>}
            {failedJobCount > 0 && <StatusBadge tone="danger">{failedJobCount} 个失败任务</StatusBadge>}
          </>
        )}
        actions={(
          <>
            <Button
              onClick={handleBatchCreate}
              disabled={batchCreating || loading}
              variant="secondary"
              icon={<Zap size={16} className={batchCreating ? 'spin' : ''} />}
            >
              {batchCreating ? '创建中...' : '一键比对'}
            </Button>
            <Button
              onClick={fetchTree}
              disabled={loading}
              variant="secondary"
              icon={<RefreshCw size={16} className={loading ? 'spin' : ''} />}
            >
              刷新
            </Button>
            <Button
              onClick={() => { window.location.href = '/jobs?tab=download'; }}
              variant="ghost"
            >
              查看导出任务
            </Button>
          </>
        )}
      />
      <div className="history-header">
        <div className="comparison-filter-bar">
          <div className="comparison-filter-left">
            <div className="input-with-icon">
              <MapPin size={16} className="input-icon" />
              <input
                type="text"
                placeholder="按地区筛选"
                value={regionFilter}
                onChange={e => setRegionFilter(e.target.value)}
                className="filter-input region-filter-input"
              />
            </div>
            <div className="input-with-icon">
              <Calendar size={16} className="input-icon" />
              <input
                type="text"
                placeholder="按年份筛选"
                value={yearFilter}
                onChange={e => setYearFilter(e.target.value)}
                className="filter-input year-filter-input"
              />
            </div>
          </div>
          <div className="comparison-filter-actions">
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
                <ExportPanel
                  compact
                  exportLabel={`生成 PDF (${selectedIds.length})`}
                  onCreatePdfJob={handleBatchDownload}
                  onOpenJobs={() => { window.location.href = '/jobs?tab=download'; }}
                />
                <button onClick={handleBatchDelete} className="batch-btn delete-btn">
                  <Trash2 size={16} /> 批量删除 ({selectedIds.length})
                </button>
              </>
            )}
          </div>
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

      {error && <ErrorState className="alert error" message={error} title="加载失败" />}

      {loading ? (
        <div className="loading-state">加载中...</div>
      ) : grandTotal === 0 ? (
        <EmptyState
          className="empty-state"
          description="上传年报后，系统将自动生成与上一年的比对报告。"
          title="暂无比对记录"
        />
      ) : (
        <>
          <DataTable className="history-table tree-table">
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
          </DataTable>
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
