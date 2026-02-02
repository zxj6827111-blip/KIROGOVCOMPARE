import React, { useState, useEffect } from 'react';
import { X, RefreshCw, AlertCircle } from 'lucide-react';
import { apiClient } from '../apiClient';
import './CompareFailureModal.css';

const CompareFailureModal = ({ isOpen, onClose, onJobRetried }) => {
    const [failedJobs, setFailedJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [retrying, setRetrying] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchFailedJobs();
        }
    }, [isOpen]);

    const fetchFailedJobs = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/comparisons/failed-jobs');
            setFailedJobs(res.data || []);
        } catch (error) {
            console.error('Failed to fetch failed jobs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRetryAll = async () => {
        if (!window.confirm(`确定要重试所有 ${failedJobs.length} 个失败任务吗？`)) return;

        setRetrying(true);
        try {
            await apiClient.post('/comparisons/retry-jobs', { all: true });
            // Clear list locally to reflect immediate "disappearance"
            setFailedJobs([]);
            if (onJobRetried) onJobRetried();
            alert('已将所有失败任务加入重试队列');
            onClose();
        } catch (error) {
            console.error('Failed to retry all jobs:', error);
            alert('重试失败，请稍后重试');
        } finally {
            setRetrying(false);
        }
    };

    const handleRetryOne = async (jobId) => {
        setRetrying(true);
        try {
            await apiClient.post('/comparisons/retry-jobs', { jobIds: [jobId] });
            setFailedJobs(prev => prev.filter(job => job.id !== jobId));
            if (onJobRetried) onJobRetried();
        } catch (error) {
            console.error('Failed to retry job:', error);
            alert('重试失败');
        } finally {
            setRetrying(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="failure-modal-overlay">
            <div className="failure-modal-content">
                <div className="failure-modal-header">
                    <h3>
                        <AlertCircle size={20} className="header-icon" />
                        比对失败任务 ({failedJobs.length})
                    </h3>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="failure-modal-body">
                    {loading ? (
                        <div className="loading-state">加载中...</div>
                    ) : failedJobs.length === 0 ? (
                        <div className="empty-state">暂无失败任务</div>
                    ) : (
                        <div className="failed-jobs-table-container">
                            <table className="failed-jobs-table">
                                <thead>
                                    <tr>
                                        <th>地区</th>
                                        <th>年份</th>
                                        <th>失败原因</th>
                                        <th>时间</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {failedJobs.map(job => (
                                        <tr key={job.id}>
                                            <td>{job.regionName}</td>
                                            <td>{job.yearA} vs {job.yearB}</td>
                                            <td className="error-msg" title={job.errorMessage}>
                                                {job.errorMessage || '未知错误'}
                                            </td>
                                            <td>{new Date(job.failedAt).toLocaleString()}</td>
                                            <td>
                                                <button
                                                    className="retry-btn-small"
                                                    onClick={() => handleRetryOne(job.id)}
                                                    disabled={retrying}
                                                >
                                                    重试
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="failure-modal-footer">
                    <button className="cancel-btn" onClick={onClose}>关闭</button>
                    {failedJobs.length > 0 && (
                        <button
                            className="retry-all-btn"
                            onClick={handleRetryAll}
                            disabled={retrying || loading}
                        >
                            <RefreshCw size={16} className={retrying ? 'spinning' : ''} />
                            一键重试所有
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CompareFailureModal;
