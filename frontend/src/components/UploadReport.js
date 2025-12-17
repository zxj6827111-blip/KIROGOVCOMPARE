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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setResult(null);

    if (!regionId.trim() || !year.trim() || !file) {
      setMessage('请填写地区 ID、年份并选择 PDF 文件');
      return;
    }

    const formData = new FormData();
    formData.append('region_id', regionId.trim());
    formData.append('year', parseInt(year.trim(), 10));
    formData.append('file', file);

    setLoading(true);
    try {
      const response = await apiClient.post('/reports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const payload = response.data || {};
      setResult({
        reportId: extractField(payload, 'report_id'),
        versionId: extractField(payload, 'version_id'),
        jobId: extractField(payload, 'job_id'),
      });
      setMessage('✅ 上传成功，已创建处理任务');
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

  return (
    <div className="upload-container">
      <div className="upload-card">
        <h2>📤 上传 PDF 报告</h2>
        <p className="subtitle">提交 PDF 后端会返回 job_id、version_id、report_id</p>

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
            />
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

          <button type="submit" className="upload-btn" disabled={loading}>
            {loading ? '上传中...' : '提交上传'}
          </button>
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
