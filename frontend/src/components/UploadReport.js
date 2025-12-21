import React, { useState, useEffect, useRef, useCallback } from 'react';
import './UploadReport.css';
import { apiClient } from '../apiClient';

const extractField = (payload, key) => payload?.[key] || payload?.[key.replace(/_./g, (m) => m[1].toUpperCase())];

function UploadReport() {
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [unitName, setUnitName] = useState('');
  const [file, setFile] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Load regions on mount
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const resp = await apiClient.get('/regions');
        const rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
        setRegions(Array.isArray(rows) ? rows : []);
      } catch (err) {
        // Ignore
      }
    };
    loadRegions();
  }, []);

  // Auto-match region based on unit name
  const autoMatchRegion = useCallback((name) => {
    if (!name || !regions.length) return;
    
    let matchedId = null;
    let maxLevel = 0;
    
    regions.forEach(r => {
      if (name.includes(r.name)) {
        if (r.level > maxLevel) {
          maxLevel = r.level;
          matchedId = r.id;
        }
      }
    });
    
    if (matchedId) {
      setRegionId(String(matchedId));
    }
  }, [regions]);

  // Extract year from filename
  const extractYearFromFilename = (filename) => {
    const match = filename.match(/(\d{4})/);
    if (match) {
      const year = parseInt(match[1], 10);
      if (year >= 2000 && year <= 2050) {
        return year;
      }
    }
    return null;
  };

  // Extract unit name from text content
  const extractUnitNameFromText = (text) => {
    // Try to find pattern like "XX市XX区政府信息公开年度报告"
    const patterns = [
      /(.{2,20}(?:市|区|县|省|自治区|直辖市))(?:人民)?政府信息公开/,
      /^(.{2,30})政府信息公开年度报告/m,
      /关于(.{2,20})政府信息公开/,
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  };

  // Process file (PDF or HTML)
  const processFile = async (file) => {
    setFile(file);
    setMessage('');
    
    const filename = file.name || '';
    const extractedYear = extractYearFromFilename(filename);
    if (extractedYear) {
      setYear(extractedYear);
    }

    try {
      if (file.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        // For PDF files, we'll just show a placeholder message
        setTextContent('[ PDF 文件已选择，将由后端进行解析 ]');
        // Try to extract unit name from filename
        const unitMatch = filename.match(/(.+?)(?:年度)?(?:政府)?(?:信息公开)?(?:年报|报告)/);
        if (unitMatch && unitMatch[1]) {
          const cleanName = unitMatch[1].replace(/[\d_-]/g, '').trim();
          if (cleanName.length >= 2) {
            setUnitName(cleanName);
            autoMatchRegion(cleanName);
          }
        }
      } else if (file.type === 'text/html' || filename.toLowerCase().endsWith('.html')) {
        // Read HTML file content
        const text = await file.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const bodyText = doc.body?.textContent || '';
        setTextContent(bodyText.slice(0, 5000));
        
        // Extract unit name
        const extractedName = extractUnitNameFromText(bodyText);
        if (extractedName) {
          setUnitName(extractedName);
          autoMatchRegion(extractedName);
        }
      } else {
        setTextContent('不支持的文件类型，请上传 PDF 或 HTML 文件');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      setTextContent('文件读取失败');
    }
  };

  // Drag handlers
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

  // Poll job status
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
    throw new Error('等待解析超时');
  };

  // Upload handler
  const handleUpload = async (autoParse = false) => {
    if (!regionId || !file) {
      setMessage('❌ 请选择文件并选择所属区域');
      return;
    }

    setLoading(true);
    setMessage('');
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('region_id', regionId);
      formData.append('year', year);
      if (unitName) {
        formData.append('unit_name', unitName);
      }
      formData.append('file', file);

      const response = await apiClient.post('/reports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const payload = response.data || {};
      const uploadResult = {
        reportId: extractField(payload, 'report_id'),
        versionId: extractField(payload, 'version_id'),
        jobId: extractField(payload, 'job_id'),
      };
      setResult(uploadResult);

      if (autoParse && uploadResult.jobId) {
        setMessage('⏳ 上传成功，正在解析...');
        const job = await pollJob(uploadResult.jobId);
        if ((job.status || '').toLowerCase() === 'succeeded') {
          setMessage('✅ 上传并解析成功！');
        } else {
          setMessage(`❌ 解析失败：${job.error_message || '未知错误'}`);
        }
      } else {
        setMessage('✅ 上传成功！');
      }
    } catch (error) {
      const status = error.response?.status;
      if (status === 409) {
        setMessage('⚠️ 该报告已存在');
      } else {
        setMessage(`❌ ${error.response?.data?.error || error.message || '上传失败'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Save text only (no file upload)
  const handleSaveText = async () => {
    if (!regionId || !textContent.trim()) {
      setMessage('❌ 请填写文本内容并选择所属区域');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const response = await apiClient.post('/reports/text', {
        region_id: regionId,
        year,
        unit_name: unitName || undefined,
        raw_text: textContent,
      });

      const payload = response.data || {};
      setResult({
        reportId: extractField(payload, 'report_id'),
        versionId: extractField(payload, 'version_id'),
        jobId: extractField(payload, 'job_id'),
      });
      setMessage('✅ 文本保存成功！');
    } catch (error) {
      setMessage(`❌ ${error.response?.data?.error || error.message || '保存失败'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    setFile(null);
    setTextContent('');
    setUnitName('');
    setRegionId('');
    setMessage('');
    setResult(null);
  };

  // Build region path for display
  const getRegionPath = (regionId) => {
    const region = regions.find(r => String(r.id) === String(regionId));
    if (!region) return '';
    
    const path = [region.name];
    let current = region;
    while (current.parent_id) {
      const parent = regions.find(r => r.id === current.parent_id);
      if (parent) {
        path.unshift(parent.name);
        current = parent;
      } else {
        break;
      }
    }
    return path.join(' / ');
  };

  return (
    <div className="upload-report-modal">
      <div className="upload-modal-content">
        <h2>录入新报告</h2>

        {/* File Drop Zone */}
        <div className="form-section">
          <label>选择文件 (PDF / HTML)</label>
          <div
            className={`drop-zone ${isDragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleDropZoneClick}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept=".pdf,.html"
              style={{ display: 'none' }}
            />
            {file ? (
              <div className="file-info">
                <span className="file-icon">📄</span>
                <span className="file-name">{file.name}</span>
              </div>
            ) : (
              <div className="drop-hint">
                <span className="upload-icon">⬆️</span>
                <p><strong>点击上传</strong> 或 <strong>拖拽文件至此</strong></p>
                <p className="hint">支持 PDF 或 HTML 文件</p>
              </div>
            )}
          </div>
        </div>

        {/* Text Content */}
        <div className="form-section">
          <label>识别的文本内容 <span className="label-hint">(可手动修正)</span></label>
          <textarea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="此处显示识别出的文本，或者您可以直接粘贴文本内容..."
            rows={8}
          />
        </div>

        {/* Metadata */}
        <div className="form-row-grid">
          <div className="form-section">
            <label>单位名称</label>
            <input
              type="text"
              value={unitName}
              onChange={(e) => {
                setUnitName(e.target.value);
                autoMatchRegion(e.target.value);
              }}
              placeholder="例如：淮安区"
            />
          </div>
          <div className="form-section">
            <label>所属年度</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
            />
          </div>
        </div>

        <div className="form-section">
          <label>所属区域 <span className="label-hint">(自动匹配或手动选择)</span></label>
          <select
            value={regionId}
            onChange={(e) => setRegionId(e.target.value)}
          >
            <option value="">-- 请选择 --</option>
            {regions.map(r => (
              <option key={r.id} value={r.id}>
                {getRegionPath(r.id) || r.name}
              </option>
            ))}
          </select>
        </div>

        {/* Messages */}
        {message && (
          <div className={`message ${message.startsWith('❌') ? 'error' : message.startsWith('⚠️') ? 'warning' : 'success'}`}>
            {message}
          </div>
        )}

        {result && (
          <div className="result-info">
            <p>报告 ID: <strong>{result.reportId || '—'}</strong></p>
            <p>版本 ID: <strong>{result.versionId || '—'}</strong></p>
            {result.jobId && <p>任务 ID: <strong>{result.jobId}</strong></p>}
          </div>
        )}

        {/* Actions */}
        <div className="form-actions">
          {message.startsWith('✅') ? (
            // Success state - show confirm button that resets form
            <button 
              type="button" 
              className="btn-primary" 
              onClick={handleCancel}
            >
              确定
            </button>
          ) : (
            // Normal state - show upload buttons
            <>
              <button type="button" className="btn-cancel" onClick={handleCancel} disabled={loading}>
                取消
              </button>
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={handleSaveText}
                disabled={loading || !textContent.trim()}
              >
                仅保存文本
              </button>
              <button 
                type="button" 
                className="btn-primary" 
                onClick={() => handleUpload(true)}
                disabled={loading || !file}
              >
                {loading ? '处理中...' : '上传并启动解析'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default UploadReport;
