import React, { useEffect, useMemo, useState, useRef } from 'react';
import './RegionsManager.css';
import { apiClient, buildDownloadUrl } from '../apiClient';

function RegionsManager() {
  const [regions, setRegions] = useState([]);
  const [reports, setReports] = useState([]); // 报告列表，用于显示关联数量
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedNodes, setExpandedNodes] = useState(new Set()); // 展开的节点
  const fileInputRef = useRef(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [regionsResp, reportsResp] = await Promise.all([
        apiClient.get('/regions'),
        apiClient.get('/reports'),
      ]);
      const regionRows = regionsResp.data?.data ?? regionsResp.data?.regions ?? regionsResp.data ?? [];
      const reportRows = reportsResp.data?.data ?? reportsResp.data ?? [];
      setRegions(Array.isArray(regionRows) ? regionRows : []);
      setReports(Array.isArray(reportRows) ? reportRows : []);

      // 默认展开第一级
      const topLevelIds = regionRows.filter(r => !r.parent_id).map(r => r.id);
      setExpandedNodes(new Set(topLevelIds));
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载数据失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const treeByParent = useMemo(() => {
    const byParent = new Map();
    regions.forEach((r) => {
      const pid = r.parent_id ?? null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(r);
    });
    byParent.forEach((arr) => arr.sort((a, b) => a.name.localeCompare(b.name)));
    return byParent;
  }, [regions]);

  // 计算每个区域的报告数量
  const reportCountMap = useMemo(() => {
    const map = new Map();
    reports.forEach((r) => {
      const key = String(r.region_id);
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [reports]);

  const childrenOf = (id) => treeByParent.get(id ?? null) || [];

  const hasChildren = (id) => {
    return (treeByParent.get(id) || []).length > 0;
  };

  const toggleExpand = (id) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelect = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const levelLabel = (level) => {
    if (level === 1) return '省/直辖市';
    if (level === 2) return '市/区';
    if (level === 3) return '区/县';
    return '区域';
  };

  const handleDelete = async (e, regionId, regionName) => {
    e.stopPropagation();
    const reportCount = reportCountMap.get(String(regionId)) || 0;
    const childCount = (treeByParent.get(regionId) || []).length;

    let confirmMsg = `确定要删除"${regionName}"吗？`;
    if (childCount > 0) {
      confirmMsg += `\n⚠️ 这将同时删除 ${childCount} 个子区域！`;
    }
    if (reportCount > 0) {
      confirmMsg += `\n⚠️ 该区域有 ${reportCount} 份关联报告，删除区域后报告将无法关联！`;
    }

    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      await apiClient.delete(`/regions/${regionId}`);
      await fetchData();
      setError(''); // 清除之前的错误
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      setError(`删除"${regionName}"失败：${message}`);
    }
  };

  // 展开所有
  const expandAll = () => {
    const allIds = new Set(regions.map(r => r.id));
    setExpandedNodes(allIds);
  };

  // 折叠所有
  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // 过滤后的区域（搜索功能）
  const filteredRegions = useMemo(() => {
    if (!searchTerm.trim()) return null; // 返回 null 表示不过滤，使用树形显示
    const term = searchTerm.toLowerCase();
    return regions.filter(r => r.name.toLowerCase().includes(term));
  }, [regions, searchTerm]);

  const renderTree = (parentId = null, depth = 0) => {
    const nodes = childrenOf(parentId);
    if (!nodes.length) return null;

    return (
      <div className="tree-level">
        {nodes.map((node) => {
          const isExpanded = expandedNodes.has(node.id);
          const isSelected = selectedId === node.id;
          const hasKids = hasChildren(node.id);
          const reportCount = reportCountMap.get(String(node.id)) || 0;

          return (
            <div key={node.id} className="tree-node-container">
              <div
                className={`tree-node ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: `${depth * 20 + 12}px` }}
              >
                {/* 展开/折叠按钮 */}
                <span
                  className={`expand-btn ${hasKids ? 'has-children' : 'no-children'}`}
                  onClick={(e) => { e.stopPropagation(); if (hasKids) toggleExpand(node.id); }}
                >
                  {hasKids ? (isExpanded ? '▼' : '▶') : '•'}
                </span>

                {/* 节点名称 */}
                <span className="node-name" onClick={() => toggleSelect(node.id)}>
                  {node.name}
                </span>

                {/* 级别标签 */}
                <span className="node-level">{levelLabel(node.level)}</span>

                {/* 报告数量 */}
                {reportCount > 0 && (
                  <span className="report-count">{reportCount}份报告</span>
                )}

                {/* 操作按钮 */}
                <div className="node-actions">
                  <button
                    className="action-btn add-btn"
                    onClick={(e) => { e.stopPropagation(); toggleSelect(node.id); setNewName(''); }}
                    title="添加子区域"
                  >
                    +
                  </button>
                  <button
                    className="action-btn delete-btn"
                    onClick={(e) => handleDelete(e, node.id, node.name)}
                    title="删除"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* 子节点 */}
              {isExpanded && renderTree(node.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  // 渲染搜索结果（扁平列表）
  const renderSearchResults = () => {
    if (!filteredRegions) return null;

    if (filteredRegions.length === 0) {
      return <div className="no-results">没有找到匹配的区域</div>;
    }

    return (
      <div className="search-results">
        {filteredRegions.map((node) => {
          const reportCount = reportCountMap.get(String(node.id)) || 0;
          const parentRegion = regions.find(r => r.id === node.parent_id);

          return (
            <div
              key={node.id}
              className={`search-result-item ${selectedId === node.id ? 'selected' : ''}`}
            >
              <div className="result-info" onClick={() => toggleSelect(node.id)}>
                <span className="node-name">{node.name}</span>
                <span className="node-level">{levelLabel(node.level)}</span>
                {parentRegion && <span className="parent-path">← {parentRegion.name}</span>}
                {reportCount > 0 && (
                  <span className="report-count">{reportCount}份报告</span>
                )}
              </div>
              <div className="node-actions">
                <button
                  className="action-btn add-btn"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(node.id); setNewName(''); }}
                  title="添加子区域"
                >
                  +
                </button>
                <button
                  className="action-btn delete-btn"
                  onClick={(e) => handleDelete(e, node.id, node.name)}
                  title="删除"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    const name = newName.trim();
    if (!name) {
      setError('名称不能为空');
      return;
    }

    const code = `AUTO-${Date.now()}`;
    const payload = {
      code,
      name,
      province: null,
      parent_id: selectedId,
    };

    setSubmitting(true);
    try {
      await apiClient.post('/regions', payload);
      setNewName('');
      await fetchData();
      // 如果有父级，确保父级展开
      if (selectedId) {
        setExpandedNodes(prev => new Set([...prev, selectedId]));
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`创建失败：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadTemplate = () => {
    window.open(buildDownloadUrl('/regions/template'), '_blank');
  };

  const handleExport = () => {
    window.open(buildDownloadUrl('/regions/export'), '_blank');
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await apiClient.post('/regions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(resp.data);
      await fetchData();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '导入失败';
      setError(`导入失败：${message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const selectedRegion = selectedId ? regions.find(r => r.id === selectedId) : null;

  return (
    <div className="regions-page">
      <div className="manager-card">
        <div className="manager-header">
          <div>
            <h2>城市/区域管理</h2>
            <p className="hint">点击区域名称选中作为父级，然后在下方添加子区域。点击 + 快速添加子区域，× 删除区域。</p>
          </div>
          <button className="ghost-btn" onClick={fetchData} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>

        {/* Excel Import/Export Toolbar */}
        <div className="import-export-toolbar">
          <button className="tool-btn template-btn" onClick={handleDownloadTemplate}>
            📥 下载模板
          </button>
          <button className="tool-btn import-btn" onClick={handleImportClick} disabled={importing}>
            {importing ? '⏳ 导入中...' : '📤 导入Excel'}
          </button>
          <button className="tool-btn export-btn" onClick={handleExport}>
            📊 导出全部
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
          />
        </div>

        {/* Search and Tree Controls */}
        <div className="search-controls">
          <div className="search-box">
            <input
              type="text"
              placeholder="🔍 搜索区域名称..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="clear-search" onClick={() => setSearchTerm('')}>×</button>
            )}
          </div>
          {!searchTerm && (
            <div className="tree-controls">
              <button className="control-btn" onClick={expandAll}>全部展开</button>
              <button className="control-btn" onClick={collapseAll}>全部折叠</button>
            </div>
          )}
        </div>

        {/* Import Result */}
        {importResult && (
          <div className="alert success">
            ✅ {importResult.message}
            {importResult.errors && importResult.errors.length > 0 && (
              <ul className="import-errors">
                {importResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <div className="alert error">{error}</div>}

        {/* Tree or Search Results */}
        <div className="tree-container">
          {searchTerm ? renderSearchResults() : renderTree()}
        </div>

        {/* Add Form */}
        <form className="add-form" onSubmit={handleCreate}>
          <div className="add-form-header">
            <label className="add-label">
              {selectedRegion
                ? `在「${selectedRegion.name}」下添加子区域：`
                : '添加顶级区域（省/直辖市）：'}
            </label>
            {selectedId && (
              <button type="button" className="clear-select-btn" onClick={() => setSelectedId(null)}>
                取消选中
              </button>
            )}
          </div>
          <div className="add-row">
            <input
              type="text"
              placeholder="输入区域名称..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={submitting}
            />
            <button className="primary-btn" type="submit" disabled={submitting}>
              {submitting ? '添加中…' : '添加'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default RegionsManager;
