import React, { useState, useEffect } from 'react';
import './JobCenter.css';
import { apiClient } from '../apiClient';
import { ListTodo, Trash2, RefreshCw, AlertTriangle, Ban, Eye } from 'lucide-react';

function JobCenter() {
    // Pagination
    const PAGE_SIZE = 20;
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalJobs, setTotalJobs] = useState(0);

    // Selection state
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        status: '',
        region_id: '',
        year: '',
        unit_name: '',
    });
    const [regions, setRegions] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]); // Now stores job_id instead of version_id

    // Confirm Dialog State
    const [confirmDialog, setConfirmDialog] = useState({
        isOpen: false,
        message: '',
        onConfirm: null,
    });

    const closeConfirm = () => {
        setConfirmDialog({ isOpen: false, message: '', onConfirm: null });
    };

    const showConfirm = (message, onConfirm) => {
        setConfirmDialog({
            isOpen: true,
            message,
            onConfirm: () => {
                try {
                    onConfirm();
                } catch (e) {
                    console.log('Error executing onConfirm callback:', e);
                }
                closeConfirm();
            }
        });
    };

    // Load regions for filter
    useEffect(() => {
        const loadRegions = async () => {
            try {
                const resp = await apiClient.get('/regions');
                const rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
                setRegions(Array.isArray(rows) ? rows : []);
            } catch (err) {
                console.error('Failed to load regions:', err);
            }
        };
        loadRegions();
    }, []);

    // Load jobs when filters or page changes
    useEffect(() => {
        loadJobs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filters, currentPage]);

    // Auto-refresh polling (keep current page)
    useEffect(() => {
        const intervalId = setInterval(() => {
            loadJobs(true); // isBackground=true
        }, 3000);
        return () => clearInterval(intervalId);
    }, [filters, currentPage]);

    const loadJobs = async (isBackground = false) => {
        if (!isBackground) setLoading(true);
        try {
            const params = {
                page: currentPage,
                limit: PAGE_SIZE,
            };
            if (filters.status) params.status = filters.status;
            if (filters.region_id) params.region_id = filters.region_id;
            if (filters.year) params.year = filters.year;
            if (filters.unit_name) params.unit_name = filters.unit_name;

            const resp = await apiClient.get('/jobs', { params });
            const jobsList = resp.data?.jobs ?? [];
            const pagination = resp.data?.pagination ?? {};

            setJobs(jobsList);
            setTotalPages(pagination.totalPages || 1);
            setTotalJobs(pagination.total || jobsList.length);
        } catch (error) {
            console.error('Failed to load jobs:', error);
        } finally {
            if (!isBackground) setLoading(false);
        }
    };

    const handleFilterChange = (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setCurrentPage(1); // Reset to first page on filter change
    };

    const handleRegionChange = (level, value) => {
        const val = value ? Number(value) : '';
        setFilters((prev) => {
            const newFilters = { ...prev };
            if (level === 'province') {
                newFilters.province_id = val;
                newFilters.city_id = '';
                newFilters.district_id = '';
                newFilters.region_id = val || '';
            } else if (level === 'city') {
                newFilters.city_id = val;
                newFilters.district_id = '';
                newFilters.region_id = val || newFilters.province_id;
            } else if (level === 'district') {
                newFilters.district_id = val;
                newFilters.region_id = val || newFilters.city_id;
            }
            return newFilters;
        });
    };

    const handleCancel = (versionId) => {
        if (!versionId) return;
        showConfirm('确定要取消该任务吗？', async () => {
            try {
                await apiClient.post(`/jobs/${versionId}/cancel`);
                loadJobs();
            } catch (error) {
                alert(`取消失败: ${error.response?.data?.error || error.message}`);
            }
        });
    };

    const handleViewDetail = (versionId) => {
        window.location.href = `/jobs/${versionId}`;
    };

    const getStatusBadge = (status) => {
        // Map DB status to display status
        const normalizeStatus = (s) => (s === 'running' ? 'processing' : s);

        const statusMap = {
            queued: { label: '排队中', className: 'status-queued' },
            processing: { label: '处理中', className: 'status-processing' },
            succeeded: { label: '成功', className: 'status-success' },
            failed: { label: '失败', className: 'status-failed' },
            cancelled: { label: '已取消', className: 'status-cancelled' },
        };
        const config = statusMap[normalizeStatus(status)] || { label: status, className: '' };
        return <span className={`status-badge ${config.className}`}>{config.label}</span>;
    };

    const getRegionName = (regionId) => {
        const region = regions.find((r) => r.id === regionId);
        return region?.name || `区域 ${regionId}`;
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(jobs.map((j) => j.job_id));
        } else {
            setSelectedIds([]);
        }
    };

    const handleSelectOne = (jobId, checked) => {
        if (checked) {
            setSelectedIds((prev) => [...prev, jobId]);
        } else {
            setSelectedIds((prev) => prev.filter((id) => id !== jobId));
        }
    };

    const handleDelete = (jobId) => {
        showConfirm('确定要删除该任务记录吗？此操作不可恢复。', async () => {
            try {
                // Note: Backend still uses version_id for deletion - we need to send job_id
                // For now, we'll reload the job list after delete
                // TODO: Add backend support for job_id based deletion
                const job = jobs.find(j => j.job_id === jobId);
                if (job) {
                    await apiClient.delete(`/jobs/${job.version_id}`);
                }
                setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
                setSelectedIds((prev) => prev.filter((id) => id !== jobId));
            } catch (error) {
                console.error('Delete failed:', error);
                alert(`删除失败: ${error.response?.data?.error || error.message}`);
            }
        });
    };

    const handleBatchDelete = () => {
        if (selectedIds.length === 0) return;
        showConfirm(`确定要删除选中的 ${selectedIds.length} 个任务吗？`, async () => {
            try {
                await apiClient.post('/jobs/batch-delete', { version_ids: selectedIds });
                loadJobs();
                setSelectedIds([]);
                alert('批量删除成功');
            } catch (error) {
                alert(`批量删除失败: ${error.response?.data?.error || error.message}`);
            }
        });
    };

    const handleDeleteAll = () => {
        showConfirm('⚠️ 警告：确定要清空所有任务历史吗？此操作将永久删除所有记录，不可恢复！', async () => {
            try {
                await apiClient.delete('/jobs/all');
                loadJobs();
                setSelectedIds([]);
                alert('所有记录已清空');
            } catch (error) {
                alert(`清空失败: ${error.response?.data?.error || error.message}`);
            }
        });
    };

    return (
        <div className="job-center">
            <div className="job-center-header">
                <div className="job-filters">
                    <div className="filter-group">
                        <label>状态</label>
                        <select value={filters.status} onChange={(e) => handleFilterChange('status', e.target.value)}>
                            <option value="">全部</option>
                            <option value="queued">排队中</option>
                            <option value="processing">处理中</option>
                            <option value="succeeded">成功</option>
                            <option value="failed">失败</option>
                            <option value="cancelled">已取消</option>
                        </select>
                    </div>
                    <div className="filter-group">
                        <label>地区筛选</label>
                        <div className="region-filters" style={{ display: 'flex', gap: '8px' }}>
                            <select
                                value={filters.province_id || ''}
                                onChange={(e) => handleRegionChange('province', e.target.value)}
                                style={{ width: '100px' }}
                            >
                                <option value="">省/直辖市</option>
                                {regions.filter(r => r.level === 1).map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>

                            <select
                                value={filters.city_id || ''}
                                onChange={(e) => handleRegionChange('city', e.target.value)}
                                style={{ width: '100px' }}
                                disabled={!filters.province_id}
                            >
                                <option value="">市/地区</option>
                                {regions.filter(r => r.level === 2 && r.parent_id === Number(filters.province_id)).map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>

                            <select
                                value={filters.district_id || ''}
                                onChange={(e) => handleRegionChange('district', e.target.value)}
                                style={{ width: '100px' }}
                                disabled={!filters.city_id}
                            >
                                <option value="">区/县</option>
                                {regions.filter(r => r.level === 3 && r.parent_id === Number(filters.city_id)).map((r) => (
                                    <option key={r.id} value={r.id}>{r.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="filter-group">
                        <label>年份</label>
                        <input type="number" value={filters.year} onChange={(e) => handleFilterChange('year', e.target.value)} placeholder="全部年份" style={{ width: '90px' }} />
                    </div>
                    <div className="filter-group">
                        <label>单位</label>
                        <input type="text" value={filters.unit_name} onChange={(e) => handleFilterChange('unit_name', e.target.value)} placeholder="单位名称" />
                    </div>
                </div>
                <div className="header-actions">
                    {selectedIds.length > 0 && (
                        <button className="btn-batch-delete" onClick={handleBatchDelete}>
                            <Trash2 size={16} /> 删除选中 ({selectedIds.length})
                        </button>
                    )}
                    <button className="btn-delete-all" onClick={handleDeleteAll}>
                        <AlertTriangle size={16} /> 清空所有
                    </button>
                    <button className="btn-refresh" onClick={() => loadJobs(false)} disabled={loading}>
                        <RefreshCw size={16} className={loading ? 'spin' : ''} /> 刷新
                    </button>
                </div>
            </div>

            {/* Jobs count info */}
            <div className="jobs-info" style={{ marginBottom: '12px', color: '#666', fontSize: '14px' }}>
                共 {totalJobs} 条任务记录 {totalPages > 1 && `(第 ${currentPage}/${totalPages} 页)`}
            </div>

            {loading ? (
                <div className="loading-message">加载中...</div>
            ) : jobs.length === 0 ? (
                <div className="empty-message">暂无任务</div>
            ) : (
                <div className="jobs-list-container">
                    <table className="jobs-table">
                        <thead>
                            <tr>
                                <th style={{ width: '40px' }}>
                                    <input
                                        type="checkbox"
                                        checked={jobs.length > 0 && jobs.every(j => selectedIds.includes(j.job_id))}
                                        onChange={handleSelectAll}
                                    />
                                </th>
                                <th>区域</th>
                                <th>年份</th>
                                <th>单位</th>
                                <th>状态</th>
                                <th>进度</th>
                                <th>步骤</th>
                                <th>尝试次数</th>
                                <th>模型</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map((job) => (
                                <tr key={job.job_id}>
                                    <td>
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(job.job_id)}
                                            onChange={(e) => handleSelectOne(job.job_id, e.target.checked)}
                                        />
                                    </td>
                                    <td>{getRegionName(job.region_id)}</td>
                                    <td>{job.year}</td>
                                    <td>{job.unit_name || '-'}</td>
                                    <td>{getStatusBadge(job.status)}</td>
                                    <td>
                                        <div className="progress-cell">
                                            <div className="progress-bar">
                                                <div className="progress-fill" style={{ width: `${job.progress}%` }}></div>
                                            </div>
                                            <span className="progress-text">{job.progress}%</span>
                                        </div>
                                    </td>
                                    <td>{job.step_name || '-'}</td>
                                    <td>第 {job.attempt || 1} 轮</td>
                                    <td>{job.model || '-'}</td>
                                    <td>{job.created_at ? new Date(job.created_at).toLocaleString('zh-CN') : '-'}</td>
                                    <td>
                                        <div className="action-buttons" style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                className="icon-btn view"
                                                onClick={() => handleViewDetail(job.version_id)}
                                                title="查看详情"
                                            >
                                                <Eye size={14} />
                                                <span>查看</span>
                                            </button>
                                            {(job.status === 'queued' || job.status === 'processing' || job.status === 'running') ? (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCancel(job.version_id);
                                                    }}
                                                    className="icon-btn cancel"
                                                    title="取消任务"
                                                >
                                                    <Ban size={14} />
                                                    <span>取消</span>
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(job.job_id);
                                                    }}
                                                    className="icon-btn delete"
                                                    title="删除记录"
                                                >
                                                    <Trash2 size={14} />
                                                    <span>删除</span>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="pagination" style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '16px',
                    padding: '12px 0'
                }}>
                    <button
                        className="btn-page"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                    >
                        首页
                    </button>
                    <button
                        className="btn-page"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                    >
                        上一页
                    </button>
                    <span style={{ margin: '0 12px', color: '#333' }}>
                        第 {currentPage} / {totalPages} 页
                    </span>
                    <button
                        className="btn-page"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                    >
                        下一页
                    </button>
                    <button
                        className="btn-page"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                    >
                        末页
                    </button>
                </div>
            )}
            {/* Custom Confirm Modal */}
            {confirmDialog.isOpen && (
                <div className="confirm-modal-overlay">
                    <div className="confirm-modal">
                        <div className="confirm-modal-icon">
                            <AlertTriangle size={48} />
                        </div>
                        <h3>确认操作</h3>
                        <p>{confirmDialog.message}</p>
                        <div className="confirm-modal-actions">
                            <button className="btn-cancel-modal" onClick={closeConfirm}>取消</button>
                            <button className="btn-confirm-modal" onClick={confirmDialog.onConfirm}>确定</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default JobCenter;
