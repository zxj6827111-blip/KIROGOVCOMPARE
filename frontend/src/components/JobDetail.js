import React, { useState, useEffect, useCallback } from 'react';
import './JobDetail.css';
import { apiClient } from '../apiClient';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import { getAxiosFriendlyError, getRawErrorDetail, translateJobError } from '../utils/errorTranslator';

function JobDetail({ versionId, onBack }) {
    const toast = useToast();
    const confirmAction = useConfirmDialog();
    const [job, setJob] = useState(null);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);

    const loadJobDetail = useCallback(async () => {
        if (!versionId) return;

        try {
            const resp = await apiClient.get(`/jobs/${versionId}`);
            setJob(resp.data);
        } catch (error) {
            console.error('Failed to load job detail:', error);
        } finally {
            setLoading(false);
        }
    }, [versionId]);

    useEffect(() => {
        loadJobDetail();
    }, [loadJobDetail]);

    // Auto-refresh when job is queued or processing
    useEffect(() => {
        if (!job) return;

        const isInProgress = job.status === 'queued' || job.status === 'processing';
        if (!isInProgress) return;

        const interval = setInterval(() => {
            loadJobDetail();
        }, 3000); // Poll every 3 seconds

        return () => clearInterval(interval);
    }, [job, loadJobDetail]);

    const [cancelling, setCancelling] = useState(false);

    const handleRetry = async () => {
        if (!versionId) return;

        setRetrying(true);
        try {
            await apiClient.post(`/jobs/${versionId}/retry`);
            toast.success('重试已触发', '任务已重新加入队列。');
            loadJobDetail();
        } catch (error) {
            const friendly = getAxiosFriendlyError(error, '重试失败，请稍后再试。');
            toast.error('重试失败', friendly.message, { detail: friendly.detail });
        } finally {
            setRetrying(false);
        }
    };

    const handleCancel = async () => {
        if (!versionId) return;
        const shouldCancel = await confirmAction({
            title: '取消任务',
            message: '确定要取消该任务吗？取消后需要重新提交或重试。',
            confirmText: '取消任务',
            cancelText: '暂不处理',
            tone: 'warning',
        });
        if (!shouldCancel) return;

        setCancelling(true);
        try {
            await apiClient.post(`/jobs/${versionId}/cancel`);
            toast.success('任务已取消');
            loadJobDetail();
        } catch (error) {
            const friendly = getAxiosFriendlyError(error, '取消任务失败，请稍后重试。');
            toast.error('取消失败', friendly.message, { detail: friendly.detail });
        } finally {
            setCancelling(false);
        }
    };

    const getStatusBadge = (status) => {
        const statusMap = {
            queued: { label: '排队中', className: 'status-queued' },
            processing: { label: '处理中', className: 'status-processing' },
            succeeded: { label: '成功', className: 'status-success' },
            failed: { label: '失败', className: 'status-failed' },
            cancelled: { label: '已取消', className: 'status-failed' }, // Re-use failed style or add new
        };
        const config = statusMap[status] || { label: status, className: '' };
        return <span className={`status-badge ${config.className}`}>{config.label}</span>;
    };

    // Define 5-step progress
    const steps = [
        { code: 'RECEIVED', name: '已接收并保存文件', order: 1 },
        { code: 'ENQUEUED', name: '已入库并创建解析任务', order: 2 },
        { code: 'PARSING', name: 'AI 解析中', order: 3 },
        { code: 'POSTPROCESS', name: '结果校验与入库', order: 4 },
        { code: 'DONE', name: '完成', order: 5 },
    ];

    const getCurrentStepOrder = (stepCode) => {
        const step = steps.find((s) => s.code === stepCode);
        return step ? step.order : 0;
    };

    const currentStepOrder = job ? getCurrentStepOrder(job.step_code) : 0;
    const friendlyError = job ? translateJobError(job) : '';
    const rawErrorDetail = job ? getRawErrorDetail(job) : '';

    if (loading) {
        return <div className="job-detail-loading">加载中...</div>;
    }

    if (!job) {
        return <div className="job-detail-error">任务不存在</div>;
    }

    return (
        <div className="job-detail">
            <div className="job-detail-header">
                {onBack && (
                    <button className="btn-back" onClick={onBack}>
                        ← 返回列表
                    </button>
                )}
                <h2>任务详情</h2>
            </div>

            <div className="job-detail-content">
                {/* Basic Info */}
                <div className="info-section">
                    <h3>基本信息</h3>
                    <div className="info-grid">
                        <div className="info-item">
                            <label>区域</label>
                            <span>区域 ID: {job.region_id}</span>
                        </div>
                        <div className="info-item">
                            <label>年份</label>
                            <span>{job.year}</span>
                        </div>
                        <div className="info-item">
                            <label>单位</label>
                            <span>{job.unit_name || '-'}</span>
                        </div>
                        <div className="info-item">
                            <label>文件名</label>
                            <span>{job.file_name || '-'}</span>
                        </div>
                        <div className="info-item">
                            <label>状态</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {getStatusBadge(job.status)}
                                {(job.status === 'queued' || job.status === 'processing') && (
                                    <button
                                        onClick={handleCancel}
                                        disabled={cancelling}
                                        style={{
                                            backgroundColor: '#dc3545',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '4px',
                                            padding: '4px 8px',
                                            cursor: 'pointer',
                                            fontSize: '0.85em',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '4px'
                                        }}
                                        title="取消当前任务"
                                    >
                                        {cancelling ? '取消中...' : '⛔ 取消'}
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="info-item">
                            <label>尝试次数</label>
                            <span>第 {job.attempt || 1} 轮</span>
                        </div>
                    </div>
                </div>

                {/* 5-Step Progress Bar */}
                <div className="progress-section">
                    <h3>解析进度</h3>
                    <div className="progress-steps">
                        {steps.map((step, index) => {
                            const isActive = currentStepOrder >= step.order;
                            const isCurrent = currentStepOrder === step.order;
                            const isCompleted = currentStepOrder > step.order;
                            const isFailedCurrent = job.status === 'failed' && isCurrent;

                            return (
                                <div key={step.code} className="progress-step">
                                    <div className={`step-indicator ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isFailedCurrent ? 'failed-current' : ''}`}>
                                        {isCompleted ? '✓' : step.order}
                                    </div>
                                    <div className="step-label">{step.name}</div>
                                    {index < steps.length - 1 && (
                                        <div className={`step-connector ${isCompleted ? 'completed' : ''}`}></div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="progress-percent">
                        <div className="progress-bar-bg">
                            <div className={`progress-bar-fill ${job.status === 'failed' ? 'failed' : ''}`} style={{ width: `${job.progress}%` }}></div>
                        </div>
                        <span className="progress-text">{job.progress}%</span>
                    </div>
                </div>

                {/* Error Info */}
                {job.status === 'failed' && job.error_message && (
                    <div className="error-section">
                        <h3>失败原因</h3>
                        <div className="error-code">错误代码: {job.error_code || '未知'}</div>
                        <div className="error-message" title={rawErrorDetail || job.error_message}>
                            {friendlyError}
                        </div>
                        {rawErrorDetail && rawErrorDetail !== friendlyError && (
                            <details className="error-detail">
                                <summary>查看原始错误</summary>
                                <pre>{rawErrorDetail}</pre>
                            </details>
                        )}
                        {job.status === 'failed' && (
                            <button className="btn-retry" onClick={handleRetry} disabled={retrying}>
                                {retrying ? '重试中...' : '🔄 手动重试'}
                            </button>
                        )}
                    </div>
                )}

                {/* Sub Jobs (Optional, for debugging) */}
                {job.jobs && job.jobs.length > 0 && (
                    <div className="sub-jobs-section">
                        <h3>子任务详情 (调试用)</h3>
                        <table className="sub-jobs-table">
                            <thead>
                                <tr>
                                    <th>类型</th>
                                    <th>状态</th>
                                    <th>进度</th>
                                    <th>步骤</th>
                                    <th>开始时间</th>
                                    <th>完成时间</th>
                                </tr>
                            </thead>
                            <tbody>
                                {job.jobs.map((subJob) => (
                                    <tr key={subJob.id}>
                                        <td>{subJob.kind}</td>
                                        <td>{getStatusBadge(subJob.status)}</td>
                                        <td>{subJob.progress}%</td>
                                        <td>{subJob.step_name || '-'}</td>
                                        <td>{subJob.started_at ? new Date(subJob.started_at).toLocaleString('zh-CN') : '-'}</td>
                                        <td>{subJob.finished_at ? new Date(subJob.finished_at).toLocaleString('zh-CN') : '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default JobDetail;
