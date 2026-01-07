import React, { useEffect, useMemo, useState } from 'react';
import './CityIndex.css';
import { apiClient } from '../apiClient';
import {
  Search,
  CheckCircle,
  AlertCircle,
  FileText,
  CalendarDays,
  ChevronRight,
  Filter,
  BarChart,
  Eye,
  Trash2,
  Download,
  Map as MapIcon,
  Plus,
  RefreshCw
} from 'lucide-react';

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
    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''} `;
    window.history.replaceState({}, '', newUrl);
  }, [path]);

  const fetchAll = async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
      setError('');
    }
    try {
      const [regionsResp, reportsResp] = await Promise.all([
        apiClient.get('/regions'),
        apiClient.get('/reports'),
      ]);
      const regionRows = regionsResp.data?.data ?? regionsResp.data ?? [];
      const reportRows = reportsResp.data?.data ?? reportsResp.data ?? [];

      // Update state without flickering
      setRegions(Array.isArray(regionRows) ? regionRows : []);
      setReports(Array.isArray(reportRows) ? reportRows : []);

      // Fetch consistency check status for all reports
      if (Array.isArray(reportRows) && reportRows.length > 0) {
        fetchCheckStatusForReports(reportRows);
      }
    } catch (err) {
      if (!isBackground) {
        const message = err.response?.data?.error || err.message || '请求失败';
        setError(`加载城市或报告失败：${message} `);
      }
      console.error('Background fetch failed:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    await fetchAll(false);
  };

  // Auto-refresh polling every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAll(true);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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
      console.log('[DEBUG] fetchCheckStatusForReports: reportIds =', reportIds, 'from list of', reportList.length, 'reports');
      if (!reportIds) {
        console.log('[DEBUG] fetchCheckStatusForReports: No report IDs found, skipping API call');
        setCheckStatusMap(new Map());
        setCheckStatusLoaded(true);
        return;
      }
      console.log('[DEBUG] fetchCheckStatusForReports: Calling API /reports/batch-check-status?report_ids=' + reportIds);
      const resp = await apiClient.get(`/reports/batch-check-status?report_ids=${reportIds}`);
      const statusData = resp.data || {};
      console.log('[DEBUG] fetchCheckStatusForReports: API response =', JSON.stringify(statusData));

      // Convert to Map - statusData now contains {total, visual, structure, quality, has_content}
      const statusMap = new Map();
      Object.entries(statusData).forEach(([reportId, counts]) => {
        statusMap.set(Number(reportId), counts);
      });
      console.log('[DEBUG] fetchCheckStatusForReports: statusMap size =', statusMap.size, 'entries:', Array.from(statusMap.entries()));

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
      alert(`删除失败：${message} `);
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
      alert(`创建比对失败：${message} `);
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

  const currentReports = useMemo(() => {
    if (!currentParentId) return [];

    // 1. Reports belonging directly to this region node
    const direct = reports.filter((r) => String(r.region_id) === String(currentParentId));

    // 2. Reports belonging to "People's Government" child node (e.g. "X County People's Government")
    // These are effectively the region's main reports and should be shown here.
    const currentRegionName = regions.find(r => String(r.id) === String(currentParentId))?.name;
    let govReports = [];

    if (currentRegionName) {
      const govChild = regions.find(r =>
        String(r.parent_id) === String(currentParentId) &&
        r.name === `${currentRegionName}人民政府`
      );
      if (govChild) {
        govReports = reports.filter(r => String(r.region_id) === String(govChild.id));
      }
    }

    return [...direct, ...govReports];
  }, [currentParentId, reports, regions]);

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
          <h2>数据概览</h2>
          <p className="subtitle">全区政府信息公开年报数字化归档与分析总览。</p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={() => (window.location.href = '/regions')}>
            <MapIcon size={16} /> 区域管理
          </button>
          <button className="primary-btn" onClick={() => (window.location.href = '/upload')}>
            <Plus size={16} /> 录入新报告
          </button>
          <button className="ghost-btn" onClick={handleRefresh} title="刷新列表" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Global Summary Dashboard */}
      {
        !loading && path.length === 0 && (
          <div className="dashboard-summary" style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
            <div className="summary-card" style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>已收录年报</span>
              <span style={{ fontSize: '36px', fontWeight: 800, color: 'var(--primary)', marginTop: '8px' }}>{reports.length}</span>
            </div>
            <div className="summary-card" style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>覆盖区域</span>
              <span style={{ fontSize: '36px', fontWeight: 800, color: 'var(--category-purple)', marginTop: '8px' }}>{regions.length}</span>
            </div>
            <div className="summary-card" style={{ background: '#fff', padding: '20px', borderRadius: '12px', boxShadow: 'var(--shadow-sm)', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>最新更新</span>
              <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 'auto' }}>2024年度报告</span>
            </div>
          </div>
        )
      }

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
      {
        currentParentId && currentReports.length > 0 && (
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
                const reportTitle = `${r.year}年${regionName} 政务公开年报`;

                return (
                  <div
                    key={r.report_id}
                    className={`report-card ${selectedForCompare.includes(r.report_id) ? 'selected' : ''}`}
                    onClick={() => onSelectReport?.(r.report_id)}
                  >
                    {/* ZONE 1: Header */}
                    <div className="report-card-header">
                      <div className="header-top">
                        <input
                          type="checkbox"
                          checked={selectedForCompare.includes(r.report_id)}
                          onChange={(e) => toggleReportSelection(e, r.report_id)}
                          onClick={(e) => e.stopPropagation()}
                          className="report-checkbox"
                        />
                        <span className="year-badge">{r.year}年度</span>
                      </div>
                      <h4 className="report-title-text">{regionName}政务公开年报</h4>
                    </div>

                    {/* ZONE 2: Status */}
                    <div className="report-card-status">
                      {(() => {
                        const reportId = Number(r.report_id || r.id);
                        const checkStatus = checkStatusMap.get(reportId);
                        console.log('[DEBUG RENDER] reportId:', reportId, 'typeof:', typeof reportId, 'checkStatus:', checkStatus, 'mapSize:', checkStatusMap.size);

                        if (!checkStatusLoaded && !checkStatus) {
                          return <span className="status-pill loading">加载中...</span>;
                        }

                        if (checkStatus?.has_content === false) {
                          return <span className="status-pill gray">⚪ 无内容</span>;
                        }

                        if (!checkStatus || checkStatus.total === 0) {
                          return (
                            <span className="status-pill green">
                              <CheckCircle size={14} />
                              <span>无问题发现</span>
                            </span>
                          );
                        }

                        return (
                          <span className="status-pill red">
                            <AlertCircle size={14} />
                            <span>发现 {checkStatus.total} 个问题</span>
                          </span>
                        );
                      })()}
                    </div>

                    {/* ZONE 3: Footer Actions */}
                    <div className="report-card-footer">
                      <div className="footer-date">{r.created_at?.slice(0, 10)}</div>
                      <div className="footer-actions">
                        <button
                          className="action-btn-ghost blue"
                          onClick={(e) => { e.stopPropagation(); onSelectReport?.(r.report_id); }}
                          title="查看详情"
                        >
                          <Eye size={16} />
                          <span>查看</span>
                        </button>
                        <button
                          className="action-btn-ghost red"
                          onClick={(e) => handleDeleteReport(e, r.report_id)}
                          title="删除报告"
                        >
                          <Trash2 size={16} />
                          <span>删除</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      }

      {/* 下级城市区域 */}
      {
        allCards.length > 0 && (
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
                    全部
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'district' ? 'active' : ''}`}
                    onClick={() => setActiveTab('district')}
                  >
                    {currentRegion?.level === 3 ? '街道/乡镇' : '区县'}
                  </button>
                  <button
                    className={`tab-btn ${activeTab === 'department' ? 'active' : ''}`}
                    onClick={() => setActiveTab('department')}
                  >
                    部门
                  </button>
                </div>
                {/* Search */}
                <div className="search-box">
                  <div className="input-with-icon">
                    <Search size={16} className="search-icon-inside" />
                    <input
                      type="text"
                      placeholder="搜索名称..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="search-input"
                    />
                  </div>
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
        )
      }

      {
        !loading && allCards.length === 0 && currentReports.length === 0 && (
          <div className="empty">暂无年报和下级区域</div>
        )
      }
    </div >
  );
}

export default CityIndex;
