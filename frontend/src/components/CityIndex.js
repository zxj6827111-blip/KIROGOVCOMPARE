import React, { useEffect, useMemo, useState } from 'react';
import './CityIndex.css';
import { apiClient } from '../apiClient';

function CityIndex({ onSelectReport, onViewComparison }) {
  const [regions, setRegions] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkStatusMap, setCheckStatusMap] = useState(new Map()); // 报告ID => 勾稽问题数量

  // 从 URL 参数读取初始路径
  const getInitialPath = () => {
    const params = new URLSearchParams(window.location.search);
    const regionParam = params.get('region');
    if (regionParam) {
      return regionParam.split(',').filter(Boolean);
    }
    return [];
  };

  const [path, setPath] = useState(getInitialPath); // 保存层级路径的 region_id
  const [selectedForCompare, setSelectedForCompare] = useState([]); // 选中用于比对的报告
  const [comparing, setComparing] = useState(false);

  // 当 path 变化时，更新 URL 参数
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (path.length > 0) {
      params.set('region', path.join(','));
    } else {
      params.delete('region');
    }
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [path]);

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

      // Fetch consistency check status for all reports
      if (Array.isArray(reportRows) && reportRows.length > 0) {
        fetchCheckStatusForReports(reportRows);
      }
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`加载城市或报告失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch consistency check counts for reports (optimized with parallel requests)
  const fetchCheckStatusForReports = async (reportList) => {
    const statusMap = new Map();

    // Fetch all checks in parallel instead of one-by-one for speed
    const fetchPromises = reportList.map(async (report) => {
      try {
        const resp = await apiClient.get(`/reports/${report.report_id}/checks`);
        const data = resp.data?.data || resp.data;
        const groups = data?.groups || [];

        // Count FAIL items that are not dismissed
        let failCount = 0;
        groups.forEach(group => {
          (group.items || []).forEach(item => {
            if (item.auto_status === 'FAIL' && item.human_status !== 'dismissed') {
              failCount++;
            }
          });
        });

        return { reportId: report.report_id, count: failCount };
      } catch (err) {
        console.error(`Failed to fetch checks for report ${report.report_id}:`, err);
        return null; // Skip failed requests
      }
    });

    // Wait for all requests to complete simultaneously
    const results = await Promise.all(fetchPromises);

    // Build the status map from results
    results.forEach(result => {
      if (result) {
        statusMap.set(result.reportId, result.count);
      }
    });

    setCheckStatusMap(statusMap);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const regionTree = useMemo(() => {
    const byParent = new Map();
    regions.forEach((r) => {
      const pid = r.parent_id != null ? String(r.parent_id) : null;
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

  const childrenOf = (regionId) => regionTree.get(regionId != null ? String(regionId) : null) || [];

  // 递归计算包含子节点的报告总数
  const countWithDescendants = (regionId) => {
    const direct = reportCountMap.get(regionId) || 0;
    const children = childrenOf(regionId);
    if (!children.length) return direct;
    return direct + children.reduce((sum, c) => sum + countWithDescendants(c.id), 0);
  };

  const currentParentId = path.length ? path[path.length - 1] : null;
  const breadcrumb = path.map((id) => regions.find((r) => String(r.id) === String(id))).filter(Boolean);
  const currentRegion = breadcrumb[breadcrumb.length - 1] || null;

  const levelLabel = (level) => {
    if (level === 1) return '省级';
    if (level === 2) return '市级';
    if (level === 3) return '区县';
    return '区域';
  };

  const handleEnter = (regionId) => {
    setPath((prev) => [...prev, regionId]);
    setSelectedForCompare([]);
  };

  const handleBack = () => {
    setPath((prev) => prev.slice(0, -1));
    setSelectedForCompare([]);
  };

  const handleReset = () => {
    setPath([]);
    setSelectedForCompare([]);
  };

  const handleDeleteReport = async (e, reportId) => {
    e.stopPropagation();
    if (!window.confirm('确定要删除这份报告吗？此操作不可恢复。')) return;
    try {
      await apiClient.delete(`/reports/${reportId}`);
      await fetchAll();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      alert(`删除失败：${message}`);
    }
  };

  const toggleReportSelection = (e, reportId) => {
    e.stopPropagation();
    setSelectedForCompare((prev) => {
      if (prev.includes(reportId)) {
        return prev.filter((id) => id !== reportId);
      }
      if (prev.length >= 2) {
        return [prev[1], reportId]; // 保留最后一个，添加新的
      }
      return [...prev, reportId];
    });
  };

  const handleCompare = async () => {
    if (selectedForCompare.length !== 2) {
      alert('请选择两份报告进行比对');
      return;
    }

    setComparing(true);
    try {
      // Find the reports to get their years
      const report1 = reports.find(r => r.report_id === selectedForCompare[0]);
      const report2 = reports.find(r => r.report_id === selectedForCompare[1]);

      if (!report1 || !report2) {
        throw new Error('未找到选中的报告');
      }

      // Sort by year (Oldest = Year A / Left, Newest = Year B / Right)
      let reportA = report1;
      let reportB = report2;
      const year1 = parseInt(report1.year, 10) || 0;
      const year2 = parseInt(report2.year, 10) || 0;

      if (year1 > year2) {
        [reportA, reportB] = [report2, report1];
      }

      // Create comparison via API
      const response = await apiClient.post('/comparisons/create', {
        region_id: currentParentId,
        year_a: reportA.year,
        year_b: reportB.year,
        left_report_id: reportA.report_id,
        right_report_id: reportB.report_id,
      });

      if (response.data && response.data.comparisonId) {
        if (onViewComparison) {
          onViewComparison(response.data.comparisonId);
        } else {
          alert('比对任务已创建！请在"比对结果汇总"页面查看。');
        }
      } else {
        alert('比对任务已创建！请在"比对结果汇总"页面查看。');
      }

      setSelectedForCompare([]);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '创建比对失败';
      alert(`创建比对失败：${message}`);
    } finally {
      setComparing(false);
    }
  };

  const cards = childrenOf(currentParentId);
  const currentReports = currentParentId ? reports.filter((r) => String(r.region_id) === String(currentParentId)) : [];

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

      {/* 如果有本级年报，显示本级年报区域 */}
      {currentParentId && currentReports.length > 0 && (
        <div className="current-reports-section">
          <div className="section-header">
            <h3>{currentRegion?.name || '当前城市'}的年报</h3>
            <div className="section-actions">
              {selectedForCompare.length === 2 && (
                <button
                  className="compare-btn"
                  onClick={handleCompare}
                  disabled={comparing}
                >
                  {comparing ? '比对中...' : '🔀 开始比对'}
                </button>
              )}
            </div>
          </div>

          {selectedForCompare.length > 0 && (
            <div className="selection-hint">
              已选择 {selectedForCompare.length} 份报告
              {selectedForCompare.length === 1 && '，请再选择一份进行比对'}
              <button className="clear-btn" onClick={() => setSelectedForCompare([])}>清除选择</button>
            </div>
          )}

          <div className="report-grid">
            {currentReports.map((r) => {
              const region = regions.find(reg => reg.id === r.region_id);
              const regionName = region?.name || '未知区域';
              const reportTitle = `${r.year}年${regionName}政务公开年报`;

              return (
                <div
                  key={r.report_id}
                  className={`report-card ${selectedForCompare.includes(r.report_id) ? 'selected' : ''}`}
                >
                  <div className="report-card-header">
                    <input
                      type="checkbox"
                      checked={selectedForCompare.includes(r.report_id)}
                      onChange={(e) => toggleReportSelection(e, r.report_id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="report-title" onClick={() => onSelectReport?.(r.report_id)}>
                      {reportTitle}
                    </span>
                  </div>
                  <div className="report-actions">
                    {/* Consistency Check Status Badge */}
                    {(() => {
                      const checkCount = checkStatusMap.get(r.report_id);
                      if (checkCount === undefined) {
                        return null; // Still loading or failed to fetch
                      }
                      if (checkCount === 0) {
                        return <span className="check-status-badge ok">✓ 无问题</span>;
                      }
                      return <span className="check-status-badge error">⚠ {checkCount}个问题</span>;
                    })()}
                    <button
                      className="view-btn"
                      onClick={() => onSelectReport?.(r.report_id)}
                    >
                      查看
                    </button>
                    <button
                      className="delete-report-btn"
                      onClick={(e) => handleDeleteReport(e, r.report_id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 下级城市区域 */}
      {cards.length > 0 && (
        <div className="children-section">
          <h3>下级城市</h3>
          <div className="card-grid">
            {cards.map((region) => {
              const total = countWithDescendants(region.id);
              const directReports = reportCountMap.get(region.id) || 0;
              return (
                <div key={region.id} className="city-card" onClick={() => handleEnter(region.id)}>
                  <div className="city-meta">
                    <div className="city-country">{region.province || '中国'}</div>
                    <div className="city-level">{levelLabel(region.level)}</div>
                  </div>
                  <h3 className="city-name">{region.name}</h3>
                  <div className="city-count">
                    <span className="count-number">{total}</span>
                    <span className="count-label">份报告（含下级）</span>
                  </div>
                  {directReports > 0 && (
                    <div className="direct-count">本级 {directReports} 份</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && cards.length === 0 && currentReports.length === 0 && (
        <div className="empty">暂无年报和下级区域</div>
      )}
    </div>
  );
}

export default CityIndex;
