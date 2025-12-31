import React, { useEffect, useMemo, useState } from 'react';
import './CityIndex.css';
import { apiClient } from '../apiClient';

function CityIndex({ onSelectReport, onViewComparison }) {
  const [regions, setRegions] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkStatusMap, setCheckStatusMap] = useState(new Map()); // 报告ID => 勾稽问题数量

  // Determine region type based on naming convention
  const getRegionType = (name) => {
    if (!name) return 'department';

    // Strict Suffix Check for Level 2 (Districts) and Level 3 (Towns/Streets)

    // Town/Street level: Must END with or contain specific identifiers that denote a region
    // "街道", "办事处", "镇", "乡" are strong indicators.
    // User: "只要带镇、区、街道的都归纳到街道/乡镇... 其他都归纳到部门"
    // CAUTION: "区" is also in "District".
    // Let's separate based on commonly accepted suffixes.

    // 1. Street/Town (Level 3)
    // Suffixes: 街道, 街道办事处, 镇, 乡
    if (name.endsWith('街道') || name.endsWith('办事处') || name.endsWith('镇') || name.endsWith('乡')) {
      return 'town'; // internal type for granularity, will map to 'district' tab logic if needed or separate
    }

    // 2. District/County (Level 2)
    // Suffixes: 区, 县, 市, 新区
    // MUST END WITH these to avoid "市财政局" (starts with 市) being matched.
    if (name.endsWith('区') || name.endsWith('县') || name.endsWith('市') || name.endsWith('新区')) {
      return 'district';
    }

    // Default: Department
    return 'department';
  };

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
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'district', 'department'
  const [searchTerm, setSearchTerm] = useState(''); // Search filter

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

  // Fetch consistency check counts for reports (optimized with batch API)
  const [checkStatusLoaded, setCheckStatusLoaded] = useState(false);

  const fetchCheckStatusForReports = async (reportList) => {
    setCheckStatusLoaded(false);
    if (reportList.length === 0) {
      setCheckStatusMap(new Map());
      setCheckStatusLoaded(true);
      return;
    }

    try {
      const reportIds = reportList.map(r => r.report_id || r.id).filter(id => id).join(',');
      if (!reportIds) {
        setCheckStatusMap(new Map());
        setCheckStatusLoaded(true);
        return;
      }
      const resp = await apiClient.get(`/reports/batch-check-status?report_ids=${reportIds}`);
      const statusData = resp.data || {};

      // Convert to Map - statusData now contains {total, visual, structure, quality, has_content}
      const statusMap = new Map();
      Object.entries(statusData).forEach(([reportId, counts]) => {
        statusMap.set(Number(reportId), counts);
      });

      setCheckStatusMap(statusMap);
    } catch (err) {
      console.error('Failed to fetch batch check status:', err);
      setCheckStatusMap(new Map()); // Empty map on error
    } finally {
      setCheckStatusLoaded(true);
    }
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

  const getCardLabel = (region) => {
    const type = getRegionType(region.name);
    if (type === 'town') {
      return '街道/乡镇';
    }
    if (type === 'district') {
      return '区县';
    }
    return '部门';
  };

  const allCards = childrenOf(currentParentId);

  const filteredCards = useMemo(() => {
    return allCards.filter(c => {
      // Search Filter
      if (searchTerm && !c.name.includes(searchTerm)) return false;

      // Tab Filter
      if (activeTab === 'all') return true;
      const type = getRegionType(c.name);

      // 'district' tab includes 'district' AND 'town' (administrative regions)
      if (activeTab === 'district') {
        return type === 'district' || type === 'town';
      }

      if (activeTab === 'department') return type === 'department';
      return true;
    });
  }, [allCards, searchTerm, activeTab]);

  const currentReports = currentParentId ? reports.filter((r) => String(r.region_id) === String(currentParentId)) : [];

  // Count availability for tabs (to show counts or hide empty tabs if desired)
  const tabCounts = useMemo(() => {
    let district = 0;
    let department = 0;
    allCards.forEach(c => {
      const type = getRegionType(c.name);
      if (type === 'district' || type === 'town') district++;
      else department++;
    });
    return { district, department, all: allCards.length };
  }, [allCards]);

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
                    {/* Consistency Check Status Badges - 分组显示 */}
                    {(() => {
                      const reportId = r.report_id || r.id;
                      const checkStatus = checkStatusMap.get(reportId);
                      if (!checkStatus) {
                        // If API is still loading, show loading indicator
                        // If API is done but report not in map, it means no active version (empty content)
                        if (!checkStatusLoaded) {
                          return <span className="check-status-loading">加载中...</span>;
                        }
                        return <span className="check-status-badge error">✗ 无内容</span>;
                      }

                      const { total, visual, structure, quality, has_content } = checkStatus;

                      // Check if report has no content (empty parsed_json)
                      if (has_content === false) {
                        return <span className="check-status-badge error">✗ 无内容</span>;
                      }

                      if (total === 0) {
                        return <span className="check-status-badge ok">✓ 无问题</span>;
                      }

                      return (
                        <div className="check-badges-group">
                          {visual > 0 && (
                            <span className="check-badge visual" title="表格审计问题">
                              表格 {visual}
                            </span>
                          )}
                          {structure > 0 && (
                            <span className="check-badge structure" title="勾稽关系问题">
                              勾稽 {structure}
                            </span>
                          )}
                          {quality > 0 && (
                            <span className="check-badge quality" title="语义审计问题">
                              语义 {quality}
                            </span>
                          )}
                        </div>
                      );
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
      {allCards.length > 0 && (
        <div className="children-section">
          <div className="section-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3>下级索引</h3>
            <div className="filter-controls" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              {/* Tabs */}
              <div className="tabs" style={{ display: 'flex', gap: '8px' }}>
                <button
                  className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveTab('all')}
                >
                  全部 <span className="badge">{tabCounts.all}</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'district' ? 'active' : ''}`}
                  onClick={() => setActiveTab('district')}
                >
                  {currentRegion?.level === 3 ? '街道/乡镇' : '区县'} <span className="badge">{tabCounts.district}</span>
                </button>
                <button
                  className={`tab-btn ${activeTab === 'department' ? 'active' : ''}`}
                  onClick={() => setActiveTab('department')}
                >
                  部门 <span className="badge">{tabCounts.department}</span>
                </button>
              </div>
              {/* Search */}
              <div className="search-box">
                <input
                  type="text"
                  placeholder="🔍 搜索名称..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ddd', width: '200px' }}
                />
              </div>
            </div>
          </div>

          {filteredCards.length > 0 ? (
            <div className="card-grid">
              {filteredCards.map((region) => {
                const total = countWithDescendants(region.id);
                const directReports = reportCountMap.get(region.id) || 0;
                const type = getRegionType(region.name);
                return (
                  <div key={region.id} className={`city-card type-${type}`} onClick={() => handleEnter(region.id)}>
                    <div className="city-meta">
                      <div className="city-country">{region.province || '中国'}</div>
                      <div className="city-level">{getCardLabel(region)}</div>
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
          ) : (
            <div className="empty-search-state" style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
              未找到 "{searchTerm}" 相关内容
            </div>
          )}
        </div>
      )}

      {!loading && allCards.length === 0 && currentReports.length === 0 && (
        <div className="empty">暂无年报和下级区域</div>
      )}
    </div>
  );
}

export default CityIndex;
