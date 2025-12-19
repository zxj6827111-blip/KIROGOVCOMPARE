import React, { useEffect, useMemo, useState } from 'react';
import './RegionsManager.css';
import { apiClient } from '../apiClient';

function RegionsManager() {
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchRegions = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get('/regions');
      const rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
      setRegions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载城市/区域失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRegions();
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

  const childrenOf = (id) => treeByParent.get(id ?? null) || [];

  const toggleSelect = (id) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const levelLabel = (level) => {
    if (level === 1) return '省/直辖市';
    if (level === 2) return '市/区';
    return '区域';
  };

  const renderTree = (parentId = null, depth = 0) => {
    const nodes = childrenOf(parentId);
    if (!nodes.length) return null;
    return (
      <ul className="tree-level">
        {nodes.map((node) => (
          <li key={node.id}>
            <div
              className={`tree-node ${selectedId === node.id ? 'selected' : ''}`}
              style={{ paddingLeft: `${depth * 16}px` }}
              onClick={() => toggleSelect(node.id)}
            >
              <span className="node-name">{node.name}</span>
              <span className="node-level">{levelLabel(node.level)}</span>
            </div>
            {renderTree(node.id, depth + 1)}
          </li>
        ))}
      </ul>
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

    // 自动生成唯一 code，避免用户填太多字段
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
      await fetchRegions();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`创建失败：${message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="regions-page">
      <div className="manager-card">
        <div className="manager-header">
          <div>
            <h2>城市/区域管理</h2>
            <p className="hint">提示：点击节点选中作为父级，添加新区域。再点击取消选中以添加顶级区域（省/直辖市）。</p>
          </div>
          <button className="ghost-btn" onClick={fetchRegions} disabled={loading}>
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        <div className="tree-container">{renderTree()}</div>

        <form className="add-form" onSubmit={handleCreate}>
          <label className="add-label">添加顶级区域（省/直辖市）：</label>
          <div className="add-row">
            <input
              type="text"
              placeholder="输入名称..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={submitting}
            />
            <button className="primary-btn" type="submit" disabled={submitting}>
              {submitting ? '添加中…' : '添加'}
            </button>
          </div>
          {selectedId && <p className="selected-tip">当前将添加到父级 ID #{selectedId}</p>}
        </form>
      </div>
    </div>
  );
}

export default RegionsManager;
