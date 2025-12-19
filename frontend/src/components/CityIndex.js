import React, { useEffect, useMemo, useState } from 'react';
import './CityIndex.css';
import { apiClient } from '../apiClient';

function CityIndex({ onSelectReport }) {
  const [regions, setRegions] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState([]); // 保存层级路径的 region_id
  const [tab, setTab] = useState('children'); // children | current

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      setError('');
      try {
        const [regionsResp, reportsResp] = await Promise.all([
          apiClient.get('/regions'),
          apiClient.get('/reports'),
        ]);
        const regionRows = regionsResp.data?.data ?? regionsResp.data ?? [];
        const reportRows = reportsResp.data?.data ?? reportsResp.data ?? [];
        setRegions(Array.isArray(regionRows) ? regionRows : []);
        setReports(Array.isArray(reportRows) ? reportRows : []);
      } catch (err) {
        const message = err.response?.data?.error || err.message || '请求失败';
        setError(`加载城市或报告失败：${message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const regionTree = useMemo(() => {
    const byParent = new Map();
    regions.forEach((r) => {
      const pid = r.parent_id ?? null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(r);
    });
    byParent.forEach((arr) => arr.sort((a, b) => (a.level || 1) - (b.level || 1) || a.name.localeCompare(b.name)));
    return byParent;
  }, [regions]);

  const reportCountMap = useMemo(() => {
    const map = new Map();
    reports.forEach((r) => {
      const key = r.region_id;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [reports]);

  const childrenOf = (regionId) => regionTree.get(regionId ?? null) || [];

  // 递归计算包含子节点的报告总数
  const countWithDescendants = (regionId) => {
    const direct = reportCountMap.get(regionId) || 0;
    const children = childrenOf(regionId);
    if (!children.length) return direct;
    return direct + children.reduce((sum, c) => sum + countWithDescendants(c.id), 0);
  };

  const currentParentId = path.length ? path[path.length - 1] : null;
  const breadcrumb = path.map((id) => regions.find((r) => r.id === id)).filter(Boolean);
  const currentRegion = breadcrumb[breadcrumb.length - 1] || null;

  const levelLabel = (level) => {
    if (level === 1) return '省级';
    if (level === 2) return '市级';
    if (level === 3) return '区县';
    return '区域';
  };

  const handleEnter = (regionId) => {
    setPath((prev) => [...prev, regionId]);
    setTab('children');
  };

  const handleBack = () => {
    setPath((prev) => prev.slice(0, -1));
    setTab('children');
  };

  const handleReset = () => {
    setPath([]);
    setTab('children');
  };

  const cards = childrenOf(currentParentId);
  const currentReports = currentParentId ? reports.filter((r) => r.region_id === currentParentId) : [];

  return (
    <div className="city-index">
      <div className="header-row">
        <div>
          <h2>城市索引库</h2>
          <p className="subtitle">选择城市以查看其已发布的政府信息公开年报，按层级浏览。</p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => (window.location.href = '/regions')}>配置城市结构</button>
          <button className="primary-btn" onClick={() => (window.location.href = '/upload')}>录入新报告</button>
        </div>
      </div>

      <div className="breadcrumb-row">
        <span className="crumb" onClick={handleReset}>顶层</span>
        {breadcrumb.map((node, idx) => (
          <React.Fragment key={node.id}>
            <span className="crumb-sep">/</span>
            <span className="crumb" onClick={() => setPath(path.slice(0, idx + 1))}>{node.name}</span>
          </React.Fragment>
        ))}
        {path.length > 0 && (
          <button className="link-btn" onClick={handleBack}>返回上一级</button>
        )}
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="alert">加载中…</div>}

      <div className="tab-row">
        <button
          className={`tab-btn ${tab === 'children' ? 'active' : ''}`}
          onClick={() => setTab('children')}
        >
          查看下级城市年报
        </button>
        <button
          className={`tab-btn ${tab === 'current' ? 'active' : ''}`}
          onClick={() => setTab('current')}
          disabled={!currentParentId}
        >
          查看本级城市年报
        </button>
      </div>

      {tab === 'children' && (
        <>
          {!loading && cards.length === 0 && <div className="empty">暂无下级区域</div>}
          <div className="card-grid">
            {cards.map((region) => {
              const total = countWithDescendants(region.id);
              return (
                <div key={region.id} className="city-card" onClick={() => handleEnter(region.id)}>
                  <div className="city-meta">
                    <div className="city-country">{region.province || '中国'}</div>
                    <div className="city-level">{levelLabel(region.level)}</div>
                  </div>
                  <h3 className="city-name">{region.name}</h3>
                  <div className="city-count">
                    <span className="count-number">{total}</span>
                    <span className="count-label">份报告</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'current' && currentParentId && (
        <div className="report-list-panel">
          <div className="report-list-header">
            <div>
              <h3>{currentRegion?.name || '当前城市'}的年报</h3>
              <p className="subtitle">共 {currentReports.length} 份</p>
            </div>
          </div>
          {currentReports.length === 0 && <div className="empty">暂无本级年报</div>}
          <div className="report-grid">
            {currentReports.map((r) => (
              <div key={r.report_id} className="report-card" onClick={() => onSelectReport?.(r.report_id)}>
                <div className="report-title">报告 #{r.report_id}</div>
                <div className="report-meta">年份：{r.year}</div>
                <div className="report-meta">active_version: {r.active_version_id || '暂无'}</div>
                <div className="report-meta">最新任务：{r.latest_job?.status || '无'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default CityIndex;
