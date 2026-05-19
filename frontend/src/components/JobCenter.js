import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './JobCenter.css';
import { apiClient, API_BASE_URL } from '../apiClient';
import { Trash2, RefreshCw, AlertTriangle, Ban, Eye, Download, RotateCw, Upload, FileDown } from 'lucide-react';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import Button from './common/Button';
import PageHeader from './common/PageHeader';
import StatusBadge from './common/StatusBadge';

const UPLOAD_POLL_ACTIVE_MS = 3000;
const UPLOAD_POLL_IDLE_MS = 10000;
const DOWNLOAD_POLL_ACTIVE_MS = 5000;
const DOWNLOAD_POLL_IDLE_MS = 12000;
const HIDDEN_POLL_MS = 30000;
const BATCH_DELETE_CONCURRENCY = 6;

async function runBatchWithConcurrency(items, worker, concurrency = BATCH_DELETE_CONCURRENCY) {
    let successCount = 0;
    for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const settled = await Promise.allSettled(chunk.map(worker));
        successCount += settled.filter((result) => result.status === 'fulfilled' && result.value === true).length;
    }
    return {
        successCount,
        failedCount: items.length - successCount,
    };
}

function JobCenter() {
    const toast = useToast();
    const confirmAction = useConfirmDialog();

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

    // Tab state: 'upload' (parse jobs) or 'download' (pdf_export jobs)
    const [activeTab, setActiveTab] = useState(() => {
        // Check URL params for initial tab
        const params = new URLSearchParams(window.location.search);
        return params.get('tab') === 'download' ? 'download' : 'upload';
    });

    // Download jobs state
    const [downloadJobs, setDownloadJobs] = useState([]);
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [downloadCurrentPage, setDownloadCurrentPage] = useState(1);
    const [downloadTotalPages, setDownloadTotalPages] = useState(1);
    const [downloadTotalJobs, setDownloadTotalJobs] = useState(0);
    const [downloadSelectedIds, setDownloadSelectedIds] = useState([]);
    const [isPageVisible, setIsPageVisible] = useState(() => {
        if (typeof document === 'undefined') return true;
        return !document.hidden;
    });

    const uploadPollInFlightRef = useRef(false);
    const downloadPollInFlightRef = useRef(false);

    // Confirm Dialog State
    const [confirmDialog, setConfirmDialog] = useState({
        isOpen: false,
        message: '',
        onConfirm: null,
    });

    const hasActiveUploadJobs = jobs.some((job) =>
        job.status === 'queued' || job.status === 'processing' || job.status === 'running'
    );
    const hasActiveDownloadJobs = downloadJobs.some((job) =>
        job.status === 'queued' || job.status === 'processing' || job.status === 'running'
    );

    const downloadSummary = useMemo(() => {
        const isActive = (status) => status === 'queued' || status === 'processing' || status === 'running';
        const isReady = (job) => job.status === 'done' && job.file_exists;
        const isExpired = (job) => job.status === 'done' && !job.file_exists;
        const selectedReady = downloadSelectedIds.filter((id) => {
            const job = downloadJobs.find((item) => item.job_id === id);
            return job && isReady(job);
        }).length;

        return {
            ready: downloadJobs.filter(isReady).length,
            running: downloadJobs.filter((job) => isActive(job.status)).length,
            failed: downloadJobs.filter((job) => job.status === 'failed').length,
            expired: downloadJobs.filter(isExpired).length,
            selectedReady,
        };
    }, [downloadJobs, downloadSelectedIds]);

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

    const loadJobs = useCallback(async (isBackground = false) => {
        if (isBackground && uploadPollInFlightRef.current) {
            return;
        }
        uploadPollInFlightRef.current = true;
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
            uploadPollInFlightRef.current = false;
            if (!isBackground) setLoading(false);
        }
    }, [currentPage, filters]);

    // Load download (PDF export) jobs
    const loadDownloadJobs = useCallback(async (isBackground = false) => {
        if (isBackground && downloadPollInFlightRef.current) {
            return;
        }
        downloadPollInFlightRef.current = true;
        if (!isBackground) setDownloadLoading(true);
        try {
            const resp = await apiClient.get('/pdf-jobs', {
                params: {
                    page: downloadCurrentPage,
                    limit: PAGE_SIZE
                }
            });
            const jobsList = resp.data?.jobs ?? [];
            const pagination = resp.data?.pagination ?? {};

            setDownloadJobs(jobsList);
            setDownloadTotalPages(pagination.totalPages || 1);
            setDownloadTotalJobs(pagination.total || jobsList.length);
        } catch (error) {
            console.error('Failed to load download jobs:', error);
        } finally {
            downloadPollInFlightRef.current = false;
            if (!isBackground) setDownloadLoading(false);
        }
    }, [downloadCurrentPage]);

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsPageVisible(!document.hidden);
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, []);

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
        if (activeTab === 'upload') {
            loadJobs();
        }
    }, [activeTab, loadJobs]);

    // Auto-refresh polling (keep current page)
    useEffect(() => {
        if (activeTab !== 'upload') return;
        const intervalMs = !isPageVisible
            ? HIDDEN_POLL_MS
            : hasActiveUploadJobs
                ? UPLOAD_POLL_ACTIVE_MS
                : UPLOAD_POLL_IDLE_MS;
        const intervalId = setInterval(() => {
            loadJobs(true); // isBackground=true
        }, intervalMs);
        return () => clearInterval(intervalId);
    }, [activeTab, hasActiveUploadJobs, isPageVisible, loadJobs]);

    // Load download jobs when tab is 'download'
    useEffect(() => {
        if (activeTab === 'download') {
            loadDownloadJobs();
        }
    }, [activeTab, loadDownloadJobs]);

    // Auto-refresh for download jobs
    useEffect(() => {
        if (activeTab !== 'download') return;
        const intervalMs = !isPageVisible
            ? HIDDEN_POLL_MS
            : hasActiveDownloadJobs
                ? DOWNLOAD_POLL_ACTIVE_MS
                : DOWNLOAD_POLL_IDLE_MS;
        const intervalId = setInterval(() => {
            loadDownloadJobs(true);
        }, intervalMs);
        return () => clearInterval(intervalId);
    }, [activeTab, hasActiveDownloadJobs, isPageVisible, loadDownloadJobs]);

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
                    await apiClient.delete(`/jobs/task/${job.job_id}`);
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
                // Map job_ids to version_ids
                const versionIds = selectedIds
                    .map(jobId => jobs.find(j => j.job_id === jobId)?.version_id)
                    .filter(vid => vid !== undefined);

                await apiClient.post('/jobs/batch-delete', { version_ids: versionIds });
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

    const requestRegenerateDownloadJob = async (jobId) => {
        try {
            await apiClient.post(`/pdf-jobs/${jobId}/regenerate`);
            toast.success('已重新加入生成队列', '请稍后在任务中心查看生成进度。');
            loadDownloadJobs();
        } catch (error) {
            toast.error('重新生成失败', error.response?.data?.message || error.message);
        }
    };

    // Download task handlers
    const handleDownloadPdf = async (job) => {
        if (!job.file_exists) {
            const shouldRegenerate = await confirmAction({
                title: '文件已过期',
                message: '原 PDF 文件已被清理，需要重新生成后才能下载。',
                confirmText: '重新生成',
                cancelText: '暂不处理',
                tone: 'warning',
            });
            if (shouldRegenerate) {
                await requestRegenerateDownloadJob(job.job_id);
            }
            return;
        }

        // Download the file
        try {
            const response = await apiClient.get(`/pdf-jobs/${job.job_id}/download`, {
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = job.file_name || `comparison_${job.comparison_id}.pdf`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            if (error.response?.status === 410) {
                const shouldRegenerate = await confirmAction({
                    title: '文件已过期',
                    message: '下载文件已过期，需要重新生成后才能下载。',
                    confirmText: '重新生成',
                    cancelText: '暂不处理',
                    tone: 'warning',
                });
                if (shouldRegenerate) {
                    await requestRegenerateDownloadJob(job.job_id);
                }
            } else {
                toast.error('下载失败', error.response?.data?.message || error.message);
            }
        }
    };

    const handleRegeneratePdf = async (jobId) => {
        const shouldRegenerate = await confirmAction({
            title: '重新生成 PDF',
            message: '将重新创建该 PDF 导出任务。',
            confirmText: '重新生成',
            cancelText: '取消',
        });
        if (shouldRegenerate) {
            await requestRegenerateDownloadJob(jobId);
        }
    };

    const handleDeleteDownloadJob = async (jobId) => {
        const shouldDelete = await confirmAction({
            title: '删除下载任务',
            message: '确认删除此下载任务？关联 PDF 文件也会被删除。',
            confirmText: '删除',
            cancelText: '取消',
            tone: 'danger',
        });
        if (!shouldDelete) return;

        try {
            await apiClient.delete(`/pdf-jobs/${jobId}`);
            toast.success('下载任务已删除');
            loadDownloadJobs();
        } catch (error) {
            toast.error('删除失败', error.response?.data?.message || error.message);
        }
    };

    // Download selection handlers
    const toggleDownloadSelect = (jobId) => {
        setDownloadSelectedIds(prev =>
            prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId]
        );
    };

    const toggleDownloadSelectAll = () => {
        if (downloadSelectedIds.length === downloadJobs.length && downloadJobs.length > 0) {
            setDownloadSelectedIds([]);
        } else {
            setDownloadSelectedIds(downloadJobs.map(j => j.job_id));
        }
    };

    const handleBatchDeleteDownload = async () => {
        if (downloadSelectedIds.length === 0) return;

        const shouldDelete = await confirmAction({
            title: '批量删除下载任务',
            message: `确认删除选中的 ${downloadSelectedIds.length} 个下载任务？关联 PDF 文件也会被删除。`,
            confirmText: '批量删除',
            cancelText: '取消',
            tone: 'danger',
        });
        if (!shouldDelete) return;

        const { successCount, failedCount } = await runBatchWithConcurrency(
            downloadSelectedIds,
            async (jobId) => {
                try {
                    await apiClient.delete(`/pdf-jobs/${jobId}`);
                    return true;
                } catch (err) {
                    console.error('Failed to delete download job:', jobId, err);
                    return false;
                }
            }
        );
        setDownloadSelectedIds([]);
        loadDownloadJobs();
        toast.success('批量删除完成', `成功 ${successCount} 个，失败 ${failedCount} 个。`);
    };

    // Batch download as ZIP
    const handleBatchDownloadZip = async () => {
        if (downloadSelectedIds.length === 0) {
            toast.warning('请选择下载任务', '批量下载前需要先勾选任务。');
            return;
        }

        // Filter only completed jobs with existing files
        const completedIds = downloadSelectedIds.filter(id => {
            const job = downloadJobs.find(j => j.job_id === id);
            return job && job.status === 'done' && job.file_exists;
        });

        if (completedIds.length === 0) {
            toast.warning('没有可下载文件', '批量下载仅包含已完成且文件未过期的任务。');
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/pdf-jobs/batch-download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ job_ids: completedIds })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || '批量下载失败');
            }

            // Get filename from Content-Disposition header
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = '批量下载.zip';
            if (contentDisposition) {
                const match = contentDisposition.match(/filename\*=UTF-8''(.+)/);
                if (match) {
                    filename = decodeURIComponent(match[1]);
                }
            }

            // Download the blob
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            setDownloadSelectedIds([]);
        } catch (error) {
            toast.error('批量下载失败', error.message);
        }
    };

    const getDownloadStatusBadge = (status, fileExists) => {
        if (status === 'done' && !fileExists) {
            return <span className="status-badge expired">已过期</span>;
        }
        const statusMap = {
            queued: { label: '排队中', className: 'queued' },
            processing: { label: '生成中', className: 'processing' },
            done: { label: '已完成', className: 'done' },
            failed: { label: '失败', className: 'failed' }
        };
        const info = statusMap[status] || { label: status, className: 'unknown' };
        return <span className={`status-badge ${info.className}`}>{info.label}</span>;
    };

    const renderDownloadStatusBadge = (status, fileExists) => {
        if (status === 'done' && !fileExists) return <StatusBadge tone="warning">已过期</StatusBadge>;
        const statusMap = {
            queued: { label: '排队中', tone: 'info' },
            processing: { label: '生成中', tone: 'warning' },
            done: { label: '已完成', tone: 'success' },
            failed: { label: '失败', tone: 'danger' },
        };
        const info = statusMap[status] || { label: status || '未知', tone: 'neutral' };
        return <StatusBadge tone={info.tone}>{info.label}</StatusBadge>;
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    return (
        <div className="job-center">
            <PageHeader
                title="任务中心"
                subtitle={activeTab === 'download' ? '查看 PDF 导出任务、下载文件和重新生成过期文件' : '查看上传解析任务和处理进度'}
                badges={activeTab === 'download' ? (
                    <>
                        <StatusBadge tone="success">可下载 {downloadSummary.ready}</StatusBadge>
                        <StatusBadge tone="warning">生成中 {downloadSummary.running}</StatusBadge>
                        {downloadSummary.failed > 0 && <StatusBadge tone="danger">失败 {downloadSummary.failed}</StatusBadge>}
                    </>
                ) : (
                    <StatusBadge tone="info">{totalJobs} 个上传任务</StatusBadge>
                )}
                actions={(
                    <>
                        {activeTab === 'download' && downloadSelectedIds.length > 0 && (
                            <Button
                                variant="primary"
                                onClick={handleBatchDownloadZip}
                                disabled={downloadSummary.selectedReady === 0}
                                icon={<Download size={16} />}
                            >
                                批量下载 ({downloadSelectedIds.length})
                            </Button>
                        )}
                        <Button
                            onClick={() => activeTab === 'download' ? loadDownloadJobs(false) : loadJobs(false)}
                            disabled={activeTab === 'download' ? downloadLoading : loading}
                            icon={<RefreshCw size={16} className={(activeTab === 'download' ? downloadLoading : loading) ? 'spin' : ''} />}
                        >
                            刷新
                        </Button>
                    </>
                )}
            />
            {/* Tab Navigation */}
            <div className="job-center-tabs" style={{
                display: 'flex',
                borderBottom: '2px solid #e5e7eb',
                marginBottom: '16px'
            }}>
                <button
                    className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
                    onClick={() => setActiveTab('upload')}
                    style={{
                        padding: '12px 24px',
                        border: 'none',
                        background: activeTab === 'upload' ? '#fff' : 'transparent',
                        borderBottom: activeTab === 'upload' ? '2px solid #2563eb' : '2px solid transparent',
                        marginBottom: '-2px',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'upload' ? '600' : '400',
                        color: activeTab === 'upload' ? '#2563eb' : '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <Upload size={18} /> 上传任务
                </button>
                <button
                    className={`tab-btn ${activeTab === 'download' ? 'active' : ''}`}
                    onClick={() => setActiveTab('download')}
                    style={{
                        padding: '12px 24px',
                        border: 'none',
                        background: activeTab === 'download' ? '#fff' : 'transparent',
                        borderBottom: activeTab === 'download' ? '2px solid #2563eb' : '2px solid transparent',
                        marginBottom: '-2px',
                        cursor: 'pointer',
                        fontWeight: activeTab === 'download' ? '600' : '400',
                        color: activeTab === 'download' ? '#2563eb' : '#6b7280',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <FileDown size={18} /> 下载任务
                </button>
            </div>

            {/* Upload Tasks Tab */}
            {activeTab === 'upload' && (
                <>
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
                                        {regions.filter(r => r.level === 1 || (!r.parent_id && !r.level)).map((r) => (
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
                                        {filters.province_id && regions.filter(r => String(r.parent_id) === String(filters.province_id)).map((r) => (
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
                                        {filters.city_id && regions.filter(r => String(r.parent_id) === String(filters.city_id)).map((r) => (
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
                </>
            )
            }

            {/* Download Tasks Tab */}
            {
                activeTab === 'download' && (
                    <>
                        <div className="job-center-header" style={{ marginBottom: '16px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                <span style={{ color: '#666', fontSize: '14px' }}>
                                    共 {downloadTotalJobs} 条下载任务
                                </span>
                            </div>
                            <div className="header-actions" style={{ display: 'flex', gap: '8px' }}>
                                {downloadSelectedIds.length > 0 && (
                                    <>
                                        <button
                                            className="btn-batch-download"
                                            onClick={handleBatchDownloadZip}
                                            disabled={downloadSummary.selectedReady === 0}
                                            title={downloadSummary.selectedReady === 0 ? '仅已完成且文件未过期的任务可批量下载' : '打包下载已完成且文件未过期的任务'}
                                        >
                                            <Download size={16} /> 批量下载 ({downloadSelectedIds.length})
                                        </button>
                                        <button className="btn-batch-delete" onClick={handleBatchDeleteDownload}>
                                            <Trash2 size={16} /> 批量删除 ({downloadSelectedIds.length})
                                        </button>
                                    </>
                                )}
                                <button className="btn-refresh" onClick={() => loadDownloadJobs(false)} disabled={downloadLoading}>
                                    <RefreshCw size={16} className={downloadLoading ? 'spin' : ''} /> 刷新
                                </button>
                            </div>
                        </div>

                        <div className="download-summary-panel">
                            <div className="download-summary-grid">
                                <div className="download-summary-card ready">
                                    <span>可下载</span>
                                    <strong>{downloadSummary.ready}</strong>
                                </div>
                                <div className="download-summary-card running">
                                    <span>生成中</span>
                                    <strong>{downloadSummary.running}</strong>
                                </div>
                                <div className="download-summary-card failed">
                                    <span>失败</span>
                                    <strong>{downloadSummary.failed}</strong>
                                </div>
                                <div className="download-summary-card expired">
                                    <span>已过期</span>
                                    <strong>{downloadSummary.expired}</strong>
                                </div>
                            </div>
                            <div className="download-batch-hint">
                                批量下载只会打包“已完成且文件未过期”的任务；已过期文件请先点击“重新生成”。
                                {downloadSelectedIds.length > 0 && (
                                    <span> 当前已选 {downloadSelectedIds.length} 个，其中 {downloadSummary.selectedReady} 个可下载。</span>
                                )}
                            </div>
                        </div>

                        {downloadLoading ? (
                            <div className="loading-message">加载中...</div>
                        ) : downloadJobs.length === 0 ? (
                            <div className="empty-message">暂无下载任务</div>
                        ) : (
                            <div className="jobs-list-container">
                                <table className="jobs-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={downloadSelectedIds.length === downloadJobs.length && downloadJobs.length > 0}
                                                    onChange={toggleDownloadSelectAll}
                                                    title="全选/取消全选"
                                                />
                                            </th>
                                            <th>任务名称</th>
                                            <th>状态</th>
                                            <th>进度</th>
                                            <th>文件大小</th>
                                            <th>创建时间</th>
                                            <th>完成时间</th>
                                            <th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {downloadJobs.map((job) => (
                                            <tr key={job.job_id} className={downloadSelectedIds.includes(job.job_id) ? 'selected' : ''}>
                                                <td>
                                                    <input
                                                        type="checkbox"
                                                        checked={downloadSelectedIds.includes(job.job_id)}
                                                        onChange={() => toggleDownloadSelect(job.job_id)}
                                                    />
                                                </td>
                                                <td>{job.export_title || `比对 #${job.comparison_id}`}</td>
                                                <td>{renderDownloadStatusBadge(job.status, job.file_exists)}</td>
                                                <td>
                                                    <div className="progress-cell">
                                                        <div className="progress-bar">
                                                            <div className="progress-fill" style={{ width: `${job.progress}%` }}></div>
                                                        </div>
                                                        <span className="progress-text">{job.progress}%</span>
                                                    </div>
                                                </td>
                                                <td>{formatFileSize(job.file_size)}</td>
                                                <td>{job.created_at ? new Date(job.created_at).toLocaleString('zh-CN') : '-'}</td>
                                                <td>{job.finished_at ? new Date(job.finished_at).toLocaleString('zh-CN') : '-'}</td>
                                                <td>
                                                    <div className="action-buttons" style={{ display: 'flex', gap: '8px' }}>
                                                        {job.status === 'done' && !job.file_exists && (
                                                            <span className="download-expired-note">文件已过期，请重新生成</span>
                                                        )}
                                                        {job.status === 'done' && (
                                                            <button
                                                                className="icon-btn view"
                                                                onClick={() => handleDownloadPdf(job)}
                                                                title={job.file_exists ? '下载文件' : '文件已过期，点击重新生成'}
                                                            >
                                                                <Download size={14} />
                                                                <span>{job.file_exists ? '下载' : '重新生成'}</span>
                                                            </button>
                                                        )}
                                                        {job.status === 'failed' && (
                                                            <button
                                                                className="icon-btn view"
                                                                onClick={() => handleRegeneratePdf(job.job_id)}
                                                                title="重新生成"
                                                            >
                                                                <RotateCw size={14} />
                                                                <span>重试</span>
                                                            </button>
                                                        )}
                                                        {(job.status === 'queued' || job.status === 'processing') && (
                                                            <span style={{ color: '#888', fontSize: '12px' }}>生成中...</span>
                                                        )}
                                                        <button
                                                            className="icon-btn delete"
                                                            onClick={() => handleDeleteDownloadJob(job.job_id)}
                                                            title="删除"
                                                        >
                                                            <Trash2 size={14} />
                                                            <span>删除</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {/* Download Tasks Pagination */}
                        {downloadTotalPages > 1 && (
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
                                    onClick={() => setDownloadCurrentPage(1)}
                                    disabled={downloadCurrentPage === 1}
                                >
                                    首页
                                </button>
                                <button
                                    className="btn-page"
                                    onClick={() => setDownloadCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={downloadCurrentPage === 1}
                                >
                                    上一页
                                </button>
                                <span style={{ margin: '0 12px', color: '#333' }}>
                                    第 {downloadCurrentPage} / {downloadTotalPages} 页
                                </span>
                                <button
                                    className="btn-page"
                                    onClick={() => setDownloadCurrentPage(p => Math.min(downloadTotalPages, p + 1))}
                                    disabled={downloadCurrentPage === downloadTotalPages}
                                >
                                    下一页
                                </button>
                                <button
                                    className="btn-page"
                                    onClick={() => setDownloadCurrentPage(downloadTotalPages)}
                                    disabled={downloadCurrentPage === downloadTotalPages}
                                >
                                    末页
                                </button>
                            </div>
                        )}
                    </>
                )}

            {/* Custom Confirm Modal */}
            {
                confirmDialog.isOpen && (
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
                )
            }
        </div >
    );
}

export default JobCenter;
