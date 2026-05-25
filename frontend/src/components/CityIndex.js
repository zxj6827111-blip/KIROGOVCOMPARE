import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './CityIndex.css';
import { apiClient, getCurrentUser } from '../apiClient';
import {
  Search,
  CheckCircle,
  AlertCircle,
  BarChart,
  Eye,
  Trash2,
  Plus,
  RefreshCw
} from 'lucide-react';
import Button from './common/Button';
import PageHeader from './common/PageHeader';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import { appendReturnTo } from '../app/routeRegistry';

// Global cache to persist data across component remounts (e.g., navigating back from detail page)
// This prevents the "loading..." flash when returning to the list
const globalCache = {
  regions: null,
  reports: null,
  checkStatusMap: null,
  lastFetch: 0,
};

export function buildCatalogReturnPath(path = [], search = '') {
  const params = new URLSearchParams(search || '');
  const normalizedPath = path.map((id) => String(id)).filter(Boolean);
  params.delete('returnTo');

  if (normalizedPath.length > 0) {
    params.set('region', normalizedPath.join(','));
  } else {
    params.delete('region');
  }

  const query = params.toString();
  return `/catalog${query ? `?${query}` : ''}`;
}

function CityIndex({ onNavigate, onSelectReport, onViewComparison }) {
  const toast = useToast();
  const confirmAction = useConfirmDialog();
  const currentUser = getCurrentUser();
  const canDeleteReports = Boolean(currentUser?.permissions?.delete_reports);
  // Initialize from cache if available
  const [regions, setRegions] = useState(() => globalCache.regions || []);
  const [reports, setReports] = useState(() => globalCache.reports || []);
  const [loading, setLoading] = useState(() => !globalCache.reports); // Only show loading if no cached data
  const [error, setError] = useState('');
  const [checkStatusMap, setCheckStatusMap] = useState(() => globalCache.checkStatusMap || new Map()); // 报告ID => 勾稽问题数量

  // Determine region type based on naming convention
  const getRegionType = (name) => {
    if (!name) return 'department';

    // Level 1: Province
    if (name.endsWith('省') || name.endsWith('自治区') || name.endsWith('直辖市')) {
      return 'province';
    }

    // Level 3: Town/Street
    // Suffixes: 街道, 街道办事处, 镇, 乡
    if (name.endsWith('街道') || name.endsWith('办事处') || name.endsWith('镇') || name.endsWith('乡')) {
      return 'town'; // internal type for granularity, will map to 'district' tab logic if needed or separate
    }

    // Level 2/3: District/County/City
    // Suffixes: 区, 县, 市, 新区
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
  const [hideEmptyReports, setHideEmptyReports] = useState(true); // 默认隐藏无内容报告
  const [selectedYear, setSelectedYear] = useState('all'); // 年份筛选
  const [batchChecking, setBatchChecking] = useState(false);
  const currentCatalogPath = useMemo(
    () => buildCatalogReturnPath(path, window.location.search),
    [path]
  );
  const goTo = useCallback((target) => {
    if (onNavigate) {
      onNavigate(target);
      return;
    }
    window.location.href = target;
  }, [onNavigate]);

  // extract all unique years from reports
  const availableYears = useMemo(() => {
    const years = new Set(reports.map(r => r.year));
    return Array.from(years).sort((a, b) => b - a); // 降序排列
  }, [reports]);

  const latestReportLabel = useMemo(() => {
    const latestYear = availableYears[0];
    return latestYear ? `${latestYear}年度报告` : '暂无年报';
  }, [availableYears]);

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

  // Fetch consistency check counts for reports (optimized with batch API)
  const [checkStatusLoaded, setCheckStatusLoaded] = useState(() => globalCache.checkStatusMap ? true : false);

  const fetchCheckStatusForReports = useCallback(async (reportList) => {
    // Don't reset checkStatusLoaded if we already have cached data
    // This prevents "loading" flicker when returning from detail page
    if (reportList.length === 0) {
      setCheckStatusMap(new Map());
      globalCache.checkStatusMap = new Map();
      setCheckStatusLoaded(true);
      return;
    }

    try {
      const reportIds = reportList.map(r => r.report_id || r.id).filter(id => id);
      if (!reportIds.length) {
        setCheckStatusMap(new Map());
        globalCache.checkStatusMap = new Map();
        setCheckStatusLoaded(true);
        return;
      }
      const chunkSize = 200;
      const chunks = [];
      for (let i = 0; i < reportIds.length; i += chunkSize) {
        chunks.push(reportIds.slice(i, i + chunkSize));
      }
      const responses = await Promise.all(
        chunks.map((chunk) => apiClient.post('/reports/batch-check-status', { report_ids: chunk }))
      );

      // Merge results into a single Map
      const statusMap = new Map();
      responses.forEach((resp) => {
        const statusData = resp.data || {};
        Object.entries(statusData).forEach(([reportId, counts]) => {
          statusMap.set(Number(reportId), counts);
        });
      });

      setCheckStatusMap(statusMap);
      globalCache.checkStatusMap = statusMap; // Update global cache
      setCheckStatusLoaded(true);
    } catch (err) {
      console.error('Failed to fetch batch check status:', err);
      // On error, keep existing data instead of clearing
      setCheckStatusLoaded(true);
    }
  }, []);

  const fetchAll = useCallback(async (isBackground = false) => {
    // Only show loading if we have no cached data
    const hasCachedData = globalCache.reports && globalCache.reports.length > 0;
    if (!isBackground && !hasCachedData) {
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

      // Update state immediately - reports render first
      const regionsArr = Array.isArray(regionRows) ? regionRows : [];
      const reportsArr = Array.isArray(reportRows) ? reportRows : [];

      setRegions(regionsArr);
      setReports(reportsArr);

      // Update global cache
      globalCache.regions = regionsArr;
      globalCache.reports = reportsArr;
      globalCache.lastFetch = Date.now();

      // IMPORTANT: Set loading=false BEFORE fetching check status
      // This allows report cards to render immediately while check status loads in background
      if (!isBackground) setLoading(false);

      // Fetch consistency check status in background (non-blocking)
      if (reportsArr.length > 0) {
        fetchCheckStatusForReports(reportsArr);
      }
    } catch (err) {
      if (!isBackground) {
        const message = err.response?.data?.error || err.message || '请求失败';
        setError(`加载城市或报告失败：${message} `);
        setLoading(false);
      }
      console.error('Background fetch failed:', err);
    }
  }, [fetchCheckStatusForReports]);

  const handleRefresh = async () => {
    await fetchAll(false);
  };

  // Auto-refresh polling every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAll(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const regionTree = useMemo(() => {
    const byParent = new Map();
    regions.forEach((r) => {
      const pid = r.parent_id != null ? String(r.parent_id) : null;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(r);
    });
    byParent.forEach((arr) => arr.sort((a, b) => (a.level || 1) - (b.level || 1) || (a.sort_order || 0) - (b.sort_order || 0)));
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

  const handleSelectReport = (reportId) => {
    if (!reportId) return;
    if (onSelectReport) {
      onSelectReport(reportId, currentCatalogPath);
      return;
    }
    goTo(appendReturnTo(`/catalog/reports/${reportId}`, currentCatalogPath));
  };

  const handleDeleteReport = async (e, reportId) => {
    e.stopPropagation();
    const confirmed = await confirmAction({
      title: '删除报告',
      message: '确定要删除这份报告吗？此操作不可恢复。',
      confirmText: '删除',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiClient.delete(`/reports/${reportId}`);
      await fetchAll();
      toast.success('报告已删除');
    } catch (err) {
      const message = err.response?.data?.error || err.message || '删除失败';
      toast.error('删除失败', message);
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
      toast.warning('请选择两份报告进行比对');
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
          toast.success('比对任务已创建', '请在比对结果汇总页面查看。');
        }
      } else {
        toast.success('比对任务已创建', '请在比对结果汇总页面查看。');
      }

      setSelectedForCompare([]);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '创建比对失败';
      toast.error('创建比对失败', message);
    } finally {
      setComparing(false);
    }
  };

  const getCardLabel = (region) => {
    // 1. Priority: Explicit Level
    if (region.level === 1) return '省级';
    if (region.level === 2) return '地市';
    if (region.level === 3) return '区县';
    if (region.level === 4) return '街道/乡镇';

    const type = getRegionType(region.name);
    if (type === 'province') return '省级';
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
    // 如果有搜索词，进行全局搜索（搜索所有区域）
    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      return regions.filter(r => {
        // 名称包含搜索词
        if (!r.name.toLowerCase().includes(term)) return false;

        // Tab Filter
        if (activeTab === 'all') return true;
        const type = getRegionType(r.name);
        if (activeTab === 'district') {
          return type === 'district' || type === 'town';
        }
        if (activeTab === 'department') return type === 'department';
        return true;
      });
    }

    // 无搜索词时，只显示当前层级子节点
    return allCards.filter(c => {
      // Tab Filter
      if (activeTab === 'all') return true;
      const type = getRegionType(c.name);

      // 'district' tab includes 'district', 'town', AND 'province' (administrative regions)
      if (activeTab === 'district') {
        return type === 'district' || type === 'town' || type === 'province';
      }

      if (activeTab === 'department') return type === 'department';
      return true;
    });
  }, [allCards, regions, searchTerm, activeTab]);

  const currentReports = useMemo(() => {
    if (!currentParentId) return [];

    let combined = [];

    // 1. Reports belonging directly to this region node
    const direct = reports.filter((r) => String(r.region_id) === String(currentParentId));
    combined = [...combined, ...direct];

    // 2. Reports belonging to "People's Government" child node (e.g. "X County People's Government")
    // These are effectively the region's main reports and should be shown here.
    const currentRegionName = regions.find(r => String(r.id) === String(currentParentId))?.name;

    if (currentRegionName) {
      const govChild = regions.find(r =>
        String(r.parent_id) === String(currentParentId) &&
        r.name === `${currentRegionName}人民政府`
      );
      if (govChild) {
        const govReports = reports.filter(r => String(r.region_id) === String(govChild.id));
        combined = [...combined, ...govReports];
      }
    }

    // Combine and sort by year ascending (from oldest to newest)
    combined.sort((a, b) => (a.year || 0) - (b.year || 0));
    return combined;
  }, [currentParentId, reports, regions]);

  const filteredReports = useMemo(() => {
    let result = [...currentReports];
    if (selectedYear !== 'all') {
      result = result.filter(r => String(r.year) === String(selectedYear));
    }
    return result;
  }, [currentReports, selectedYear]);

  const visibleReports = useMemo(() => {
    return filteredReports.filter(r => {
      if (hideEmptyReports && checkStatusLoaded) {
        const reportId = Number(r.report_id || r.id);
        const checkStatus = checkStatusMap.get(reportId);
        if (checkStatus?.has_content === false) return false;
      }
      return true;
    });
  }, [filteredReports, hideEmptyReports, checkStatusLoaded, checkStatusMap]);

  const handleBatchCheck = async () => {
    if (batchChecking) return;
    const reportIds = visibleReports.map(r => r.report_id || r.id).filter(Boolean);
    if (reportIds.length === 0) {
      toast.warning('当前筛选没有可校验的报告');
      return;
    }

    const confirmed = await confirmAction({
      title: '批量校验',
      message: `确认对当前筛选的 ${reportIds.length} 份报告批量校验？`,
      confirmText: '开始校验',
      tone: 'default',
    });
    if (!confirmed) return;

    setBatchChecking(true);
    try {
      const resp = await apiClient.post('/reports/batch-checks/run', { report_ids: reportIds });
      const data = resp.data || {};
      const processed = data.processed || 0;
      const skipped = data.skipped || 0;
      const failed = data.failed || 0;
      await fetchCheckStatusForReports(reports);
      toast.success('批量校验完成', `成功 ${processed}，跳过 ${skipped}，失败 ${failed}`);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '批量校验失败';
      toast.error('批量校验失败', message);
    } finally {
      setBatchChecking(false);
    }
  };

  return (
    <div className="city-index kc-page">
      <PageHeader
        title="年报工作台"
        subtitle="全区政府信息公开年报数字化归档与分析总览。"
        actions={(
          <>
            <Button variant="secondary" icon={<AlertCircle size={16} />} onClick={() => {
              const regionParam = currentParentId ? `?region=${currentParentId}&name=${encodeURIComponent(currentRegion?.name || '')}` : '';
              goTo(appendReturnTo(`/issues${regionParam}`, currentCatalogPath));
            }}>
              问题清单
            </Button>
            <Button variant="secondary" icon={<AlertCircle size={16} />} onClick={() => goTo(appendReturnTo('/report-maintenance', currentCatalogPath))}>
              年报维护
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => goTo('/upload')}>
              录入新报告
            </Button>
            <Button variant="ghost" icon={<RefreshCw size={16} className={loading ? 'spin' : ''} />} onClick={handleRefresh} title="刷新列表" disabled={loading} />
          </>
        )}
      />

      {/* Global Summary Dashboard */}
      {
        !loading && path.length === 0 && (
          <div className="dashboard-summary kc-summary-grid">
            <div className="kc-summary-card">
              <span className="kc-summary-card__label">已收录年报</span>
              <span className="kc-summary-card__value kc-summary-card__value--primary">{reports.length}</span>
            </div>
            <div className="kc-summary-card">
              <span className="kc-summary-card__label">覆盖区域</span>
              <span className="kc-summary-card__value">{new Set(reports.map(r => r.region_id)).size}</span>
            </div>
            <div className="kc-summary-card">
              <span className="kc-summary-card__label">最新更新</span>
              <span className="kc-summary-card__value dashboard-summary__latest">{latestReportLabel}</span>
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
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                    fontSize: '13px',
                    color: '#666',
                    marginRight: '8px',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="all">全部年份</option>
                  {availableYears.map(year => (
                    <option key={year} value={year}>{year}年</option>
                  ))}
                </select>
                <button
                  className="ghost-btn"
                  onClick={handleBatchCheck}
                  disabled={batchChecking || visibleReports.length === 0}
                  title="对当前筛选报告批量运行勾稽校验"
                >
                  <BarChart size={16} className={batchChecking ? 'spin' : ''} />
                  {batchChecking ? '批量校验中...' : `批量校验(${visibleReports.length})`}
                </button>
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

            {/* 隐藏无内容报告开关 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px', color: '#666' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={hideEmptyReports}
                  onChange={(e) => setHideEmptyReports(e.target.checked)}
                />
                隐藏无内容报告
              </label>
            </div>

            <div className="report-grid">
              {visibleReports.map((r) => {
                const region = regions.find(reg => reg.id === r.region_id);
                const regionName = region?.name || '未知区域';

                return (
                  <div
                    key={r.report_id}
                    className={`report-card ${selectedForCompare.includes(r.report_id) ? 'selected' : ''}`}
                    onClick={() => handleSelectReport(r.report_id)}
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

                        if (!checkStatusLoaded && !checkStatus) {
                          return <span className="status-pill loading">加载中...</span>;
                        }

                        if (!checkStatus && checkStatusLoaded) {
                          return <span className="status-pill gray">⚪ 未解析</span>;
                        }

                        if (checkStatus?.has_content === false) {
                          return <span className="status-pill gray">⚪ 无内容</span>;
                        }

                        if (checkStatus?.checked === false) {
                          return <span className="status-pill gray">⚪ 未校验</span>;
                        }

                        if (typeof checkStatus?.total !== 'number') {
                          return <span className="status-pill gray">⚪ 未校验</span>;
                        }

                        if (checkStatus.total === 0) {
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
                          onClick={(e) => { e.stopPropagation(); handleSelectReport(r.report_id); }}
                          title="查看详情"
                        >
                          <Eye size={16} />
                          <span>查看</span>
                        </button>
                        {canDeleteReports && (
                          <button
                            className="action-btn-ghost red"
                            onClick={(e) => handleDeleteReport(e, r.report_id)}
                            title="删除报告"
                          >
                            <Trash2 size={16} />
                            <span>删除</span>
                          </button>
                        )}
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
            <div className="section-header-row">
              <h3>下级索引</h3>
              <div className="filter-controls">
                {/* Tabs */}
                <div className="tabs kc-segmented">
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
                    {(() => {
                      if (!currentRegion) return '省份';
                      if (currentRegion.level === 1) return '地市';
                      if (currentRegion.level === 3) return '街道/乡镇';
                      return '区县';
                    })()}
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
                  let type = getRegionType(region.name);
                  if (region.level === 1) type = 'province';

                  // Find parent name for display
                  const parentRegion = regions.find(r => r.id === region.parent_id);
                  const parentName = parentRegion ? parentRegion.name : '中国';

                  return (
                    <div key={region.id} className={`city-card type-${type}`} onClick={() => handleEnter(region.id)}>
                      <div className="city-meta">
                        <div className="city-country">{parentName}</div>
                        <div className="city-level">{getCardLabel(region)}</div>
                      </div>
                      <h3 className="city-name">{region.name}</h3>
                      <div className="city-count">
                        <span className={`count-number ${total === 0 ? 'count-zero' : ''}`}>{total}</span>
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
