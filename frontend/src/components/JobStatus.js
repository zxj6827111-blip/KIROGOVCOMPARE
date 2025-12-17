import React, { useMemo } from 'react';
import { useJobPolling } from '../hooks/useJobPolling';

function JobStatus({ jobId }) {
  const { job, error, isPolling } = useJobPolling(jobId, {
    interval: 3000,
    timeoutMs: 120000,
  });

  const statusText = useMemo(() => {
    if (!jobId) return '未提供 Job ID';
    if (error) return '轮询失败';
    if (!job) return '加载中...';
    return job.status || '未知状态';
  }, [error, job, jobId]);

  return (
    <div className="job-status">
      <div><strong>Job:</strong> {jobId || '-'}</div>
      <div><strong>状态:</strong> {statusText}</div>
      {isPolling && <div>轮询中...</div>}
      {job?.error_code && <div><strong>错误码:</strong> {job.error_code}</div>}
      {job?.error_message && <div><strong>错误信息:</strong> {job.error_message}</div>}
      {error && !job?.error_message && (
        <div className="job-status-error">{error.message}</div>
      )}
    </div>
  );
}

export default JobStatus;
