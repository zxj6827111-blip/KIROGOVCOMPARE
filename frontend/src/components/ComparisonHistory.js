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
  CheckCircle
} from 'lucide-react';

function ComparisonHistory() {
  const [comparisons, setComparisons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedComparisonId, setSelectedComparisonId] = useState(null);

  const [regionFilter, setRegionFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [showIssuesOnly, setShowIssuesOnly] = useState(false); // Filter for issues only

  // Tree structure state
  const [treeData, setTreeData] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [viewMode, setViewMode] = useState('tree'); // 'tree' | 'flat'
  const [isTreeReady, setIsTreeReady] = useState(false); // Prevents flicker

  const fetchComparisons = useCallback(async () => {
    setLoading(true);
    setError('');
    setIsTreeReady(false); // Reset tree ready state
    try {
      const params = new URLSearchParams({
        page: page,
        pageSize: 100, // Get more for tree view
      });
      if (regionFilter) params.append('region_name', regionFilter);
      if (yearFilter) params.append('year', yearFilter);

      const resp = await apiClient.get(`/comparisons/history?${params.toString()}`);
      const data = resp.data?.data || [];
      setComparisons(data);
      setTotalPages(resp.data?.totalPages || 1);

      // Build tree structure
      await buildTree(data);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载失败：${message}`);
    } finally {
      setLoading(false);
    }
  }, [page, regionFilter, yearFilter]);

  // Build tree structure from flat comparison list
  const buildTree = async (comparisons) => {
    // Get regions hierarchy
    try {
      const regionsResp = await apiClient.get('/regions');
      const regions = regionsResp.data?.data || [];

      // Create region lookup map
      const regionMap = new Map();
      regions.forEach(r => regionMap.set(r.id, r));

      // Group comparisons by region
      const compByRegion = new Map();
      comparisons.forEach(c => {
        if (!compByRegion.has(c.regionId)) {
          compByRegion.set(c.regionId, []);
        }
        compByRegion.get(c.regionId).push(c);
      });

      // Build tree nodes
      const buildNode = (regionId) => {
        const region = regionMap.get(regionId);
        if (!region) return null;

        const comps = compByRegion.get(regionId) || [];
        const children = regions
          .filter(r => r.parent_id === regionId)
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
          .map(r => buildNode(r.id))
          .filter(Boolean);

        // Only include if has comparisons or children with comparisons
        const hasComparisons = comps.length > 0;
        const hasChildComparisons = children.some(c => c.hasComparisons);

        if (!hasComparisons && !hasChildComparisons) return null;

        // Count issues
        const issueCount = comps.filter(c => c.checkStatus && c.checkStatus !== '正常').length;
        const childIssueCount = children.reduce((sum, c) => sum + c.totalIssues, 0);

        return {
          id: regionId,
          name: region.name,
          level: region.level,
          comparisons: comps,
          children: children,
          hasComparisons: hasComparisons || hasChildComparisons,
          issueCount: issueCount,
          totalIssues: issueCount + childIssueCount,
          totalComparisons: comps.length + children.reduce((sum, c) => sum + c.totalComparisons, 0)
        };
      };

      // Build from root regions
      const rootNodes = regions
        .filter(r => !r.parent_id || r.parent_id === 0)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .map(r => buildNode(r.id))
        .filter(Boolean);

      setTreeData(rootNodes);

      // Auto-expand first level
      const firstLevelIds = rootNodes.map(n => n.id);
      setExpandedNodes(new Set(firstLevelIds));
      setIsTreeReady(true); // Tree is ready, allow rendering
    } catch (err) {
      console.error('Failed to build tree:', err);
      // Fallback to flat view
      setViewMode('flat');
      setIsTreeReady(true); // Still mark as ready to show flat fallback
    }
  };

  useEffect(() => {
    fetchComparisons();
  }, [fetchComparisons]);

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

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

  // Batch download
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

  // Render tree node with its comparisons
  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;

    // Apply showIssuesOnly filter
    const filteredComps = showIssuesOnly
      ? (node.comparisons || []).filter(c => c.checkStatus && c.checkStatus !== '正常')
      : (node.comparisons || []);
    const hasComps = filteredComps.length > 0;

    // When filtering by issues, skip nodes with no issues
    if (showIssuesOnly && node.totalIssues === 0) return null;

    return (
      <React.Fragment key={node.id}>
        {/* Region Header Row */}
        <tr className={`region-header-row level-${node.level}`} onClick={() => toggleNode(node.id)}>
          <td colSpan="8">
            <div className="region-header-content" style={{ paddingLeft: depth * 24 }}>
              <span className="expand-icon">
                {(hasChildren || hasComps) && (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
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

        {/* Comparisons under this region */}
        {isExpanded && hasComps && filteredComps.map(c => (
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

      {/* Summary Stats */}
      {!loading && comparisons.length > 0 && (
        <div className="summary-bar">
          <span className="summary-item">
            共 <strong>{comparisons.length}</strong> 份比对记录
          </span>
          <span className="summary-item issue">
            <AlertCircle size={14} />
            <strong>{comparisons.filter(c => c.checkStatus && c.checkStatus !== '正常').length}</strong> 份存在问题
          </span>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {loading && comparisons.length === 0 ? (
        <div className="loading-state">加载中...</div>
      ) : comparisons.length === 0 ? (
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
              {viewMode === 'tree' && isTreeReady && treeData.length > 0 ? (
                treeData.map(node => renderTreeNode(node, 0))
              ) : viewMode === 'tree' && !isTreeReady ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#9ca3af' }}>构建层级结构中...</td></tr>
              ) : (
                comparisons.map((c) => (
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
                ))
              )}
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
      )}
    </div>
  );
}

export default ComparisonHistory;
