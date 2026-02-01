import React, { useCallback, useEffect, useState, useMemo } from 'react';
import './ReportMaintenance.css';
import { apiClient } from '../apiClient';
import {
    ArrowLeft,
    RefreshCw,
    Download,
    AlertTriangle,
    FileX,
    Search,
    Calendar,
    MapPin,
    CheckCircle
} from 'lucide-react';

function ReportMaintenance({ onBack, onNavigate }) {

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState(null);
    const [exporting, setExporting] = useState(false);

    // URL 参数初始化 helper
    const getInitialParams = () => {
        const params = new URLSearchParams(window.location.search);
        const urlYear = params.get('year');
        const urlRegionId = params.get('main_region_id'); // Use distinct param name to avoid conflict with 'region' used by CityIndex if shared, but here it is separate page usually. 
        // Logic: if we are on /report-maintenance, we own the params.
        // User asked to return to "screening page" state.

        return {
            year: urlYear ? Number(urlYear) : (new Date().getFullYear() - 1),
            regionId: urlRegionId ? Number(urlRegionId) : null
        };
    };

    const initialParams = useMemo(() => getInitialParams(), []);

    // 筛选条件
    const [year, setYear] = useState(initialParams.year);
    const [regionId, setRegionId] = useState(initialParams.regionId);

    // 区域数据
    const [regions, setRegions] = useState([]);
    const [regionPath, setRegionPath] = useState([]); // 级联选择路径

    // Sync State to URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        params.set('year', year);
        if (regionId) {
            params.set('main_region_id', regionId);
        } else {
            params.delete('main_region_id');
        }
        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
    }, [year, regionId]);


    // 年份列表
    const years = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const yearList = [];
        for (let y = currentYear; y >= 2015; y--) {
            yearList.push(y);
        }
        return yearList;
    }, []);

    // 加载区域数据
    useEffect(() => {
        const fetchRegions = async () => {
            try {
                const resp = await apiClient.get('/regions');
                const regionRows = resp.data?.data ?? resp.data ?? [];
                setRegions(Array.isArray(regionRows) ? regionRows : []);
            } catch (err) {
                console.error('Failed to fetch regions:', err);
            }
        };
        fetchRegions();
    }, []);

    // Rebuild Region Path from ID (for restoring Cascade state)
    useEffect(() => {
        if (regions.length > 0 && regionId && regionPath.length === 0) {
            const regionMap = new Map(regions.map(r => [r.id, r]));
            const path = [];
            let curr = regionMap.get(regionId);
            while (curr) {
                path.unshift(curr.id);
                curr = regionMap.get(curr.parent_id);
            }
            if (path.length > 0) {
                setRegionPath(path);
            }
        }
    }, [regions, regionId, regionPath.length]);

    // 构建区域树
    const regionTree = useMemo(() => {
        const byParent = new Map();
        regions.forEach((r) => {
            const pid = r.parent_id != null ? String(r.parent_id) : null;
            if (!byParent.has(pid)) byParent.set(pid, []);
            byParent.get(pid).push(r);
        });
        byParent.forEach((arr) => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
        return byParent;
    }, [regions]);

    // 获取指定层级的区域选项
    const getRegionOptions = (parentId) => {
        return regionTree.get(parentId != null ? String(parentId) : null) || [];
    };

    // 级联选择器配置
    const cascadeLevels = [
        { label: '省份', placeholder: '全部省份' },
        { label: '城市', placeholder: '全部城市' },
        { label: '区县', placeholder: '全部区县' },
        { label: '街道', placeholder: '全部街道' }
    ];

    // 更新级联选择
    const handleCascadeChange = (level, value) => {
        const newPath = [...regionPath.slice(0, level)];
        if (value) {
            newPath.push(Number(value));
        }
        setRegionPath(newPath);
        // 设置最后一个有效的 region_id
        setRegionId(newPath.length > 0 ? newPath[newPath.length - 1] : null);
    };

    // 加载数据
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ year: String(year) });
            if (regionId) {
                params.set('region_id', String(regionId));
            }
            const resp = await apiClient.get(`/report-maintenance?${params.toString()}`);
            setData(resp.data?.data || { total: 0, missing_count: 0, empty_count: 0, regions: [] });
        } catch (err) {
            const message = err.response?.data?.error || err.message || '请求失败';
            setError(`加载年报维护数据失败：${message}`);
        } finally {
            setLoading(false);
        }
    }, [year, regionId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // 导出 CSV
    const handleExport = async () => {
        setExporting(true);
        try {
            const params = new URLSearchParams({ year: String(year) });
            if (regionId) {
                params.set('region_id', String(regionId));
            }
            const resp = await apiClient.get(`/report-maintenance/export?${params.toString()}`, {
                responseType: 'blob'
            });

            // 创建下载链接
            const url = window.URL.createObjectURL(new Blob([resp.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `年报维护_${year}年.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            const message = err.response?.data?.error || err.message || '导出失败';
            alert(`导出失败：${message}`);
        } finally {
            setExporting(false);
        }
    };

    // 获取层级名称
    const getLevelName = (level) => {
        switch (level) {
            case 0:
            case 1: return '省级';
            case 2: return '市级';
            case 3: return '区县级';
            case 4: return '街道/乡镇';
            default: return `Level ${level}`;
        }
    };

    return (
        <div className="report-maintenance-page">
            {/* Header */}
            <div className="report-maintenance-header">
                <div className="header-left">
                    <button className="back-btn" onClick={onBack}>
                        <ArrowLeft size={20} />
                        <span>返回</span>
                    </button>
                    <div className="header-title">
                        <h2>
                            <FileX size={24} className="title-icon" />
                            年报维护
                        </h2>
                        <p className="subtitle">筛选目标年份中未上传或内容为空的区域</p>
                    </div>
                </div>
                <div className="header-right">
                    <button
                        className="export-btn"
                        onClick={handleExport}
                        disabled={exporting || !data || data.total === 0}
                    >
                        <Download size={18} className={exporting ? 'spin' : ''} />
                        <span>{exporting ? '导出中...' : '导出 CSV'}</span>
                    </button>
                    <button
                        className="refresh-btn"
                        onClick={fetchData}
                        disabled={loading}
                        title="刷新"
                    >
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Filter Section */}
            <div className="filter-section">
                <div className="filter-group">
                    <label><Calendar size={14} /> 年份</label>
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="filter-select"
                    >
                        {years.map(y => (
                            <option key={y} value={y}>{y}年</option>
                        ))}
                    </select>
                </div>

                {/* 级联区域选择器 */}
                {cascadeLevels.map((level, idx) => {
                    const parentId = idx === 0 ? null : regionPath[idx - 1];
                    const options = getRegionOptions(parentId);
                    const isDisabled = idx > 0 && !regionPath[idx - 1];
                    const currentValue = regionPath[idx] || '';

                    // 只显示有子级的选择器
                    if (idx > 0 && !regionPath[idx - 1]) return null;
                    if (options.length === 0 && idx > 0) return null;

                    return (
                        <div className="filter-group" key={idx}>
                            <label><MapPin size={14} /> {level.label}</label>
                            <select
                                value={currentValue}
                                onChange={(e) => handleCascadeChange(idx, e.target.value)}
                                className="filter-select"
                                disabled={isDisabled}
                            >
                                <option value="">{level.placeholder}</option>
                                {options.map(r => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>
                        </div>
                    );
                })}

                <button className="search-btn" onClick={fetchData} disabled={loading}>
                    <Search size={16} />
                    <span>查询</span>
                </button>
            </div>

            {/* Summary Cards */}
            {data && !loading && (
                <div className="summary-section">
                    <div className="summary-card total">
                        <span className="summary-label">待处理总数</span>
                        <span className={`summary-value ${data.total > 0 ? 'has-issues' : ''}`}>
                            {data.total}
                        </span>
                    </div>
                    <div className="summary-card missing">
                        <span className="summary-label">未上传</span>
                        <span className="summary-value">{data.missing_count}</span>
                    </div>
                    <div className="summary-card empty">
                        <span className="summary-label">内容为空</span>
                        <span className="summary-value">{data.empty_count}</span>
                    </div>
                    <div className="summary-card text-empty">
                        <span className="summary-label">文字为空</span>
                        <span className="summary-value">{data.text_empty_count || 0}</span>
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && <div className="alert error">{error}</div>}

            {/* Loading State */}
            {loading && (
                <div className="loading-state">
                    <RefreshCw size={32} className="spin" />
                    <p>加载中...</p>
                </div>
            )}

            {/* Empty State */}
            {!loading && !error && data && data.total === 0 && (
                <div className="empty-state success">
                    <CheckCircle size={48} />
                    <h3>全部完成</h3>
                    <p>所选年份和区域内的所有年报均已上传且内容完整</p>
                </div>
            )}

            {/* Results Table */}
            {!loading && !error && data && data.regions && data.regions.length > 0 && (
                <div className="results-section">
                    <table className="results-table">
                        <thead>
                            <tr>
                                <th>序号</th>
                                <th>区域名称</th>
                                <th>层级</th>
                                <th>上级区域</th>
                                <th>年份</th>
                                <th>状态</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.regions.map((region, idx) => (
                                <tr key={region.region_id} className={region.status}>
                                    <td>{idx + 1}</td>
                                    <td
                                        className="region-name clickable"
                                        onClick={() => onNavigate && onNavigate(`/catalog?region=${region.region_id}`)}
                                        title="点击跳转到区域详情"
                                    >
                                        {region.region_name}
                                    </td>
                                    <td>{getLevelName(region.level)}</td>
                                    <td className="parent-path">{region.parent_path || '-'}</td>
                                    <td>{region.year}年</td>
                                    <td>
                                        <span className={`status-badge ${region.status}`}>
                                            {region.status === 'missing' && <><AlertTriangle size={14} /> 未上传</>}
                                            {region.status === 'empty' && <><FileX size={14} /> 内容为空</>}
                                            {region.status === 'text_empty' && <><FileX size={14} /> 文字为空</>}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default ReportMaintenance;
