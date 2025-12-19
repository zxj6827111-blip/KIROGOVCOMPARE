import React, { useState } from 'react';
import './UploadReport.css';
import { apiClient } from '../apiClient';

const extractField = (payload, key) => payload?.[key] || payload?.[key.replace(/_./g, (m) => m[1].toUpperCase())];

function UploadReport() {
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [regions, setRegions] = useState([]);
  const [regionsLoaded, setRegionsLoaded] = useState(false);

  const loadRegions = async () => {
    if (regionsLoaded) return;
    try {
      const resp = await apiClient.get('/regions');
      const rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
      setRegions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      // regions is optional; ignore
    } finally {
      setRegionsLoaded(true);
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
    throw new Error('等待解析超时，请稍后在“年报汇总/报告详情”中查看任务状态');
  };

  const doUpload = async () => {

    if (!regionId.trim() || !year.trim() || !file) {
      throw new Error('请填写地区 ID、年份并选择 PDF 文件');
    }

    const formData = new FormData();
    formData.append('region_id', regionId.trim());
    formData.append('year', parseInt(year.trim(), 10));
    formData.append('file', file);

    const response = await apiClient.post('/reports', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const payload = response.data || {};
    const next = {
      reportId: extractField(payload, 'report_id'),
      versionId: extractField(payload, 'version_id'),
      jobId: extractField(payload, 'job_id'),
    };
    setResult(next);
    return next;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setResult(null);
    try {
      const uploaded = await doUpload();
      setMessage('✅ 上传成功，已创建处理任务');
      setResult(uploaded);
    } catch (error) {
      const status = error.response?.status;
      const payload = error.response?.data || {};
      if (status === 409) {
        setMessage('⚠️ 报告已存在，重复上传');
        setResult({
          reportId: extractField(payload, 'report_id'),
          versionId: extractField(payload, 'version_id'),
          jobId: extractField(payload, 'job_id'),
        });
      } else {
        setMessage(error.response?.data?.error || '上传失败，请稍后再试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUploadAndParse = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setResult(null);
    try {
      const uploaded = await doUpload();
      setMessage('⏳ 上传成功，正在自动解析…');
      const job = await pollJob(uploaded.jobId);
      if ((job.status || '').toLowerCase() === 'succeeded') {
        setMessage('✅ 解析完成！可前往“年报汇总 → 报告详情”查看 parsed_json');
      } else {
        setMessage(`❌ 解析失败：${job.error || 'unknown_error'}`);
      }
      setResult(uploaded);
    } catch (error) {
      setMessage(error.response?.data?.error || error.message || '上传/解析失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-container">
      <div className="upload-card">
        <h2>📤 上传 PDF 报告</h2>
        <p className="subtitle">支持“提交上传”或“上传并自动解析（轮询 job 状态）”</p>

        <form onSubmit={handleSubmit} className="upload-form">
          <div className="form-row">
            <label htmlFor="regionId">地区 ID</label>
            <input
              id="regionId"
              type="text"
              placeholder="例如：310000"
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              disabled={loading}
              onFocus={loadRegions}
            />
            {!regionsLoaded ? null : regions.length ? (
              <div style={{ marginTop: 8 }}>
                <select
                  value={regionId}
                  onChange={(e) => setRegionId(e.target.value)}
                  disabled={loading}
                  style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e5e7eb' }}
                >
                  <option value="">— 从列表选择（可选）—</option>
                  {regions.map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.name} (#{r.id}{r.code ? `/${r.code}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div className="form-row">
            <label htmlFor="year">年份</label>
            <input
              id="year"
              type="number"
              placeholder="例如：2024"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <label htmlFor="pdfFile">选择 PDF 文件</label>
            <input
              id="pdfFile"
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={loading}
            />
            {file && <p className="file-name">已选择：{file.name}</p>}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="upload-btn" disabled={loading}>
              {loading ? '处理中...' : '提交上传'}
            </button>
            <button type="button" className="upload-btn" onClick={handleUploadAndParse} disabled={loading}>
              {loading ? '处理中...' : '上传并自动解析'}
            </button>
          </div>
        </form>

        {message && <div className="message">{message}</div>}

        {result && (
          <div className="result-box">
            <h3>返回信息</h3>
            <ul>
              <li>
                <span>job_id</span>
                <strong>{result.jobId || '—'}</strong>
              </li>
              <li>
                <span>version_id</span>
                <strong>{result.versionId || '—'}</strong>
              </li>
              <li>
                <span>report_id</span>
                <strong>{result.reportId || '—'}</strong>
              </li>
            </ul>
            <p className="tips">提示：本页面不轮询状态，后续可在后台查询任务进度。</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadReport;
