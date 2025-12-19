import React, { useEffect, useState } from 'react';
import './ReportDetail.css';
import { apiClient } from '../apiClient';

function ReportDetail({ reportId: propReportId, onBack }) {
  const reportId = propReportId || window.location.pathname.split('/').pop();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showParsed, setShowParsed] = useState(false);
  const handleBack = () => {
    if (onBack) return onBack();
    window.history.back();
  };

  useEffect(() => {
    const fetchDetail = async () => {
      if (!reportId) return;
      setLoading(true);
      setError('');
      try {
        const response = await apiClient.get(`/reports/${reportId}`);
        const payload = response.data?.data ?? response.data?.report ?? response.data;
        setReport(payload || null);
      } catch (err) {
        const message = err.response?.data?.error || err.message || '请求失败';
        setError(`加载报告详情失败：${message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [reportId]);

  const refresh = async () => {
    if (!reportId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}`);
      const payload = response.data?.data ?? response.data?.report ?? response.data;
      setReport(payload || null);
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`刷新失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const pollJob = async (jobId, { timeoutMs = 120000, intervalMs = 1500 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const resp = await apiClient.get(`/jobs/${jobId}`);
      const status = (resp.data?.status || '').toLowerCase();
      if (status === 'succeeded' || status === 'failed') {
        return resp.data;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('等待解析超时，请稍后再试');
  };

  const handleReparse = async () => {
    if (!reportId) return;
    if (!window.confirm('确认重新触发解析吗？将创建新的 parse job。')) return;
    setError('');
    setLoading(true);
    try {
      const resp = await apiClient.post(`/reports/${reportId}/parse`);
      const jobId = resp.data?.job_id || resp.data?.jobId;
      if (!jobId) throw new Error('未返回 job_id');

      const job = await pollJob(jobId);
      if ((job.status || '').toLowerCase() === 'failed') {
        throw new Error(job.error || 'parse_failed');
      }
      await refresh();
    } catch (err) {
      setError(err.message || '重新解析失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!reportId) return;
    if (!window.confirm(`确认删除报告 #${reportId} 吗？`)) return;
    setError('');
    setLoading(true);
    try {
      await apiClient.delete(`/reports/${reportId}`);
      handleBack();
    } catch (err) {
      const message = err.response?.data?.error || err.message || '请求失败';
      setError(`删除失败：${message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderParsedContent = (parsed) => {
    if (!parsed) return <p className="meta">暂无解析内容</p>;
    const text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    const preview = text.length > 600 ? `${text.slice(0, 600)}...` : text;

    return (
      <div className="parsed-section">
        <button className="secondary-btn" onClick={() => setShowParsed((prev) => !prev)}>
          {showParsed ? '折叠解析' : '展开解析'}
        </button>
        {showParsed && <pre className="parsed-json">{preview}</pre>}
      </div>
    );
  };

  const renderJobDetail = (job) => {
    if (!job) return <p className="meta">暂无任务信息</p>;
    return (
      <div className="grid">
        <div>
          <p className="label">任务 ID</p>
          <p className="value">{job.job_id}</p>
        </div>
        <div>
          <p className="label">状态</p>
          <p className="value">{job.status}</p>
        </div>
        <div>
          <p className="label">进度</p>
          <p className="value">{job.progress ?? '—'}%</p>
        </div>
        {job.error_message && (
          <div className="full-row">
            <p className="label">错误信息</p>
            <p className="value error-text">{job.error_message}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="report-detail">
      <div className="card">
        <div className="detail-header">
          <div>
            <h2>报告详情</h2>
            <p className="subtitle">查看报告、最新任务与生效版本信息</p>
          </div>
          <div className="actions">
            <button className="secondary-btn" onClick={refresh} disabled={loading}>
              刷新
            </button>
            <button className="secondary-btn" onClick={handleReparse} disabled={loading}>
              自动解析(轮询)
            </button>
            <button className="secondary-btn" onClick={handleDelete} disabled={loading}>
              删除报告
            </button>
            <button className="secondary-btn" onClick={handleBack}>
              返回列表
            </button>
          </div>
        </div>

        {loading && <p>加载中...</p>}
        {error && <div className="alert error">{error}</div>}

        {!loading && !error && report && (
          <>
            <section className="section">
              <h3>报告信息</h3>
              <div className="grid">
                <div>
                  <p className="label">报告 ID</p>
                  <p className="value">{report.report_id}</p>
                </div>
                <div>
                  <p className="label">region_id</p>
                  <p className="value">{report.region_id}</p>
                </div>
                <div>
                  <p className="label">年份</p>
                  <p className="value">{report.year}</p>
                </div>
              </div>
            </section>

            <section className="section">
              <h3>最新任务</h3>
              {renderJobDetail(report.latest_job)}
            </section>

            <section className="section">
              <h3>生效版本</h3>
              {report.active_version ? (
                <div className="grid">
                  <div>
                    <p className="label">版本 ID</p>
                    <p className="value">{report.active_version.version_id}</p>
                  </div>
                  <div>
                    <p className="label">模型</p>
                    <p className="value">{report.active_version.model || '—'}</p>
                  </div>
                  <div>
                    <p className="label">Provider</p>
                    <p className="value">{report.active_version.provider || '—'}</p>
                  </div>
                  <div>
                    <p className="label">Prompt 版本</p>
                    <p className="value">{report.active_version.prompt_version || '—'}</p>
                  </div>
                  <div>
                    <p className="label">Schema 版本</p>
                    <p className="value">{report.active_version.schema_version || '—'}</p>
                  </div>
                  <div>
                    <p className="label">创建时间</p>
                    <p className="value">{report.active_version.created_at || '—'}</p>
                  </div>
                  <div className="full-row">
                    <p className="label">文件路径</p>
                    <p className="value">{report.active_version.storage_path || '—'}</p>
                  </div>
                  <div className="full-row">
                    <p className="label">文本路径</p>
                    <p className="value">{report.active_version.text_path || '—'}</p>
                  </div>
                  <div className="full-row">
                    <p className="label">文件哈希</p>
                    <p className="value">{report.active_version.file_hash || '—'}</p>
                  </div>
                </div>
              ) : (
                <p className="meta">暂无生效版本</p>
              )}
            </section>

            <section className="section">
              <h3>解析摘要</h3>
              {renderParsedContent(report.active_version?.parsed_json)}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default ReportDetail;
