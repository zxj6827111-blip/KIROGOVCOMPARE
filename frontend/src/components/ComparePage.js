import React, { useEffect, useMemo, useState } from 'react';
import './ComparePage.css';
import JobStatus from './JobStatus';
import { apiClient } from '../apiClient';
import { useJobPolling } from '../hooks/useJobPolling';

const extractField = (payload, key) => payload?.[key] ?? payload?.[key.replace(/_./g, (m) => m[1].toUpperCase())];

function DiffList({ title, items, isOpen, onToggle }) {
  if (!items?.length) return null;

  return (
    <div className="diff-list">
      <button className="toggle-btn" type="button" onClick={onToggle}>
        {isOpen ? '▼' : '▶'} {title}（{items.length}）
      </button>
      {isOpen && (
        <ul>
          {items.map((item, index) => (
            <li key={`${title}-${index}`}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComparisonSummary({ comparison }) {
  const diffSummary = comparison?.diff_summary || comparison?.diffSummary || {};
  const changedItems = diffSummary.changed_items || diffSummary.changedItems || [];
  const addedItems = diffSummary.added_items || diffSummary.addedItems || [];
  const removedItems = diffSummary.removed_items || diffSummary.removedItems || [];

  const totals = {
    changed: diffSummary.changed ?? changedItems.length ?? 0,
    added: diffSummary.added ?? addedItems.length ?? 0,
    removed: diffSummary.removed ?? removedItems.length ?? 0,
  };

  const [open, setOpen] = useState({
    changed: false,
    added: false,
    removed: false,
  });

  const header = useMemo(() => {
    const regionId = extractField(comparison, 'region_id');
    const yearA = extractField(comparison, 'year_a');
    const yearB = extractField(comparison, 'year_b');
    return { regionId, yearA, yearB };
  }, [comparison]);

  return (
    <div className="comparison-result">
      <h3>比对结果</h3>
      <div className="comparison-meta">
        <div><strong>地区 ID:</strong> {header.regionId || '—'}</div>
        <div><strong>年份 A:</strong> {header.yearA || '—'}</div>
        <div><strong>年份 B:</strong> {header.yearB || '—'}</div>
      </div>

      <div className="diff-summary">
        <div className="summary-card">
          <div className="summary-value">{totals.changed}</div>
          <div className="summary-label">修改项</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">{totals.added}</div>
          <div className="summary-label">新增项</div>
        </div>
        <div className="summary-card">
          <div className="summary-value">{totals.removed}</div>
          <div className="summary-label">删除项</div>
        </div>
      </div>

      <div className="diff-lists">
        <DiffList
          title="修改详情"
          items={changedItems}
          isOpen={open.changed}
          onToggle={() => setOpen((prev) => ({ ...prev, changed: !prev.changed }))}
        />
        <DiffList
          title="新增详情"
          items={addedItems}
          isOpen={open.added}
          onToggle={() => setOpen((prev) => ({ ...prev, added: !prev.added }))}
        />
        <DiffList
          title="删除详情"
          items={removedItems}
          isOpen={open.removed}
          onToggle={() => setOpen((prev) => ({ ...prev, removed: !prev.removed }))}
        />
      </div>
    </div>
  );
}

function ComparePage() {
  const [regionId, setRegionId] = useState('');
  const [yearA, setYearA] = useState('');
  const [yearB, setYearB] = useState('');
  const [jobId, setJobId] = useState('');
  const [comparisonId, setComparisonId] = useState('');
  const [message, setMessage] = useState('');
  const [parseWarning, setParseWarning] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [comparison, setComparison] = useState(null);
  const [isFetchingResult, setIsFetchingResult] = useState(false);
  const [hasFetchedResult, setHasFetchedResult] = useState(false);

  const { job, error: jobError } = useJobPolling(jobId, { interval: 3000, timeoutMs: 180000 });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setParseWarning('');
    setSubmissionError('');
    setComparison(null);
    setHasFetchedResult(false);

    if (!regionId.trim() || !yearA.trim() || !yearB.trim()) {
      setSubmissionError('请填写地区 ID 和两个年份');
      return;
    }

    try {
      const response = await apiClient.post('/comparisons', {
        region_id: regionId.trim(),
        year_a: parseInt(yearA.trim(), 10),
        year_b: parseInt(yearB.trim(), 10),
      });
      const data = response.data || {};
      setJobId(extractField(data, 'job_id') || '');
      setComparisonId(extractField(data, 'comparison_id') || extractField(data, 'id') || '');
      setMessage('✅ 已创建比对任务，正在轮询状态');
    } catch (error) {
      const errorCode = error.response?.data?.error_code || error.response?.data?.code;
      if (errorCode === 'PARSE_NOT_READY') {
        setParseWarning('⚠️ 需先完成报告解析，请在上传页面完成解析后再试。');
      } else {
        setSubmissionError(error.response?.data?.error || error.message || '创建比对任务失败');
      }
    }
  };

  useEffect(() => {
    const shouldFetch = job?.status === 'succeeded' && comparisonId && !hasFetchedResult;
    if (!shouldFetch) return;

    let cancelled = false;

    const fetchComparison = async () => {
      setIsFetchingResult(true);
      try {
        const response = await apiClient.get(`/comparisons/${comparisonId}`);
        if (cancelled) return;
        setComparison(response.data);
        setMessage('✅ 比对完成，以下是结果');
      } catch (error) {
        if (cancelled) return;
        setSubmissionError(error.response?.data?.error || '获取比对结果失败');
      } finally {
        if (!cancelled) {
          setIsFetchingResult(false);
          setHasFetchedResult(true);
        }
      }
    };

    fetchComparison();

    return () => {
      cancelled = true;
    };
  }, [comparisonId, hasFetchedResult, job?.status]);

  return (
    <div className="compare-page">
      <div className="compare-card">
        <h2>🔀 报告比对</h2>
        <p className="subtitle">输入地区与年份，创建对比任务</p>

        <form className="compare-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="regionId">地区 ID</label>
            <input
              id="regionId"
              type="text"
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              placeholder="例如：310000"
            />
          </div>

          <div className="form-row inline">
            <div>
              <label htmlFor="yearA">年份 A</label>
              <input
                id="yearA"
                type="number"
                value={yearA}
                onChange={(e) => setYearA(e.target.value)}
                placeholder="2023"
              />
            </div>
            <div>
              <label htmlFor="yearB">年份 B</label>
              <input
                id="yearB"
                type="number"
                value={yearB}
                onChange={(e) => setYearB(e.target.value)}
                placeholder="2024"
              />
            </div>
          </div>

          <button type="submit" className="submit-btn">开始比对</button>
        </form>

        {parseWarning && <div className="warning-box">{parseWarning}</div>}
        {submissionError && <div className="error-box">{submissionError}</div>}
        {message && <div className="info-box">{message}</div>}

        {(jobId || jobError) && (
          <div className="status-section">
            <h3>任务状态</h3>
            <JobStatus jobId={jobId} />
            {job?.status === 'failed' && (
              <div className="error-box">任务失败：{job?.error_message || job?.error_code || '未知原因'}</div>
            )}
            {jobError && <div className="error-box">轮询失败：{jobError.message}</div>}
          </div>
        )}

        {isFetchingResult && <div className="info-box">正在获取比对结果...</div>}
        {comparison && <ComparisonSummary comparison={comparison} />}
      </div>
    </div>
  );
}

export default ComparePage;
