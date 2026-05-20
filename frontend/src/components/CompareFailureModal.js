import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { apiClient } from '../apiClient';
import Button from './common/Button';
import DataTable from './common/DataTable';
import EmptyState from './common/EmptyState';
import Modal from './common/Modal';
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

    const footer = (
        <>
            <Button className="cancel-btn" onClick={onClose} variant="secondary">关闭</Button>
            {failedJobs.length > 0 && (
                <Button
                    className="retry-all-btn"
                    icon={<RefreshCw size={16} className={retrying ? 'spinning' : ''} />}
                    onClick={handleRetryAll}
                    disabled={retrying || loading}
                    variant="primary"
                >
                    一键重试所有
                </Button>
            )}
        </>
    );

    return (
        <Modal
            bodyClassName="failure-modal-body"
            className="failure-modal-content"
            footer={footer}
            isOpen={isOpen}
            onClose={onClose}
            overlayClassName="failure-modal-overlay"
            size="lg"
            title={(
                <span className="failure-modal-title">
                    <AlertCircle size={20} className="header-icon" />
                    比对失败任务 ({failedJobs.length})
                </span>
            )}
        >
            {loading ? (
                <div className="loading-state">加载中...</div>
            ) : failedJobs.length === 0 ? (
                <EmptyState className="empty-state" title="暂无失败任务" />
            ) : (
                <DataTable className="failed-jobs-table" containerClassName="failed-jobs-table-container">
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
                                    <Button
                                        className="retry-btn-small"
                                        onClick={() => handleRetryOne(job.id)}
                                        disabled={retrying}
                                        size="sm"
                                        variant="secondary"
                                    >
                                        重试
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </DataTable>
            )}
        </Modal>
    );
};

export default CompareFailureModal;
