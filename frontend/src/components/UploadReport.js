
import React, { useState, useEffect, useRef, useCallback } from 'react';
import './UploadReport.css';
import { apiClient } from '../apiClient';
import BatchUpload from './BatchUpload';
import {
  FileText,
  FolderOpen,
  AlertTriangle,
  UploadCloud
} from 'lucide-react';

const extractField = (payload, key) => payload?.[key] || payload?.[key.replace(/_./g, (m) => m[1].toUpperCase())];

function UploadReport() {
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [unitName, setUnitName] = useState('');
  const [file, setFile] = useState(null);
  const [textContent, setTextContent] = useState('');
  const [model, setModel] = useState('qwen3-235b');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState('single'); // 'single' | 'batch'
  const fileInputRef = useRef(null);

  // Load regions on mount
  useEffect(() => {
    const loadRegions = async () => {
      try {
        const resp = await apiClient.get('/regions');
        let rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
        if (!Array.isArray(rows)) rows = [];

        // Sort hierarchically: Tree sort
        const regionMap = new Map();
        const roots = [];

        // 1. Initialize map and children
        rows.forEach(r => {
          r.children = [];
          regionMap.set(r.id, r);
        });

        // 2. Build tree
        rows.forEach(r => {
          if (r.parent_id && regionMap.has(r.parent_id)) {
            regionMap.get(r.parent_id).children.push(r);
          } else {
            roots.push(r);
          }
        });

        // 3. Sort siblings by ID (preserves creation order/chronology as requested)
        const sortNodes = (nodes) => {
          nodes.sort((a, b) => a.id - b.id);
          nodes.forEach(n => sortNodes(n.children));
        };
        sortNodes(roots);

        // 4. Flatten
        const sortedRows = [];
        const traverse = (nodes) => {
          nodes.forEach(n => {
            const { children, ...rest } = n;
            sortedRows.push(rest);
            traverse(n.children);
          });
        };
        traverse(roots);

        setRegions(sortedRows);
      } catch (err) {
        // Ignore
      }
    };
    loadRegions();
  }, []);

  // Auto-match region based on unit name (Hierarchical Matching)
  const autoMatchRegion = useCallback((name) => {
    if (!name || !regions.length) return;

    // Create a temporary map for lookups (optimization: could be memoized if regions large)
    const regionMap = new Map();
    regions.forEach(r => regionMap.set(r.id, r));

    let bestMatchId = null;
    let maxScore = -1;

    // 预处理搜索词
    const searchName = name.replace(/(?:人民政府|办事处|委员会|政府|总局)$/g, '');

    regions.forEach(r => {
      // 1. 基础名称匹配
      let dbName = r.name.replace(/(?:人民政府|办事处|委员会|政府|总局)$/g, '');

      if (dbName.length < 2 && !searchName.includes(dbName)) return;

      let score = 0;

      if (searchName.includes(dbName)) {
        score += 10;
        score += dbName.length * 0.5;
      } else if (dbName.includes(searchName)) {
        score += 5;
      } else {
        return;
      }

      // 2. 祖先上下文匹配
      let curr = r;
      let depth = 0;
      while (curr.parent_id && regionMap.has(curr.parent_id) && depth < 10) {
        const parent = regionMap.get(curr.parent_id);
        const parentName = parent.name.replace(/(?:人民政府|办事处|委员会|政府)$/g, '');

        if (searchName.includes(parentName)) {
          score += 20; // 匹配到一级祖先奖励20分
        }
        curr = parent;
        depth++;
      }

      if (score > maxScore) {
        maxScore = score;
        bestMatchId = r.id;
      } else if (score === maxScore) {
        if (r.level > (regionMap.get(bestMatchId)?.level || 0)) {
          bestMatchId = r.id;
        }
      }
    });

    if (bestMatchId) {
      setRegionId(String(bestMatchId));
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
    // 1. Try "标题：" format
    const titleMatch = text.match(/标题：(.+)/);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      // Try to extract year from title
      const yearMatch = title.match(/(\d{4})年/);
      if (yearMatch) {
        setYear(parseInt(yearMatch[1], 10));
      }
      // Try to extract unit name from title suffix "宿迁市2024年...报告-宿迁市人民政府"
      if (title.includes('-')) {
        const parts = title.split('-');
        return parts[parts.length - 1].trim();
      }
      // Or prefix: "宿迁市人民政府2024年..."
      const prefixMatch = title.match(/^(.+?)(\d{4}年)?政府信息公开/);
      if (prefixMatch) return prefixMatch[1].trim();
    }

    // 2. Try standard patterns
    const patterns = [
      /(.{2,30}(?:市|区|县|省|自治区|直辖市|街道|镇|乡|办事处|委员会))(?:人民)?政府信息公开/,
      /^(.{2,30})政府信息公开年度报告/m,
      /关于(.{2,30})政府信息公开/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    return '';
  };

  // Extract region name from filename
  const extractRegionFromFilename = (filename) => {
    // Remove extension and date suffix
    let name = filename.replace(/\.(pdf|html|htm|txt)$/i, '');
    // Remove date patterns like _2025-12-30 or -2025-12-30
    name = name.replace(/[-_]\d{4}-\d{2}-\d{2}$/, '');

    // 特别处理乡镇级别的名称
    // 例如: "高墟镇" 或 "沐阳县高墟镇"
    const townPatterns = [
      // 匹配“XX镇”、“XX乡”、“XX街道”等
      /([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))(?:\d{4}年|政府信息|年度报告)/,
      // 匹配“县+镇”格式
      /(?:[\u4e00-\u9fa5]{2,4}县)([\u4e00-\u9fa5]{2,6}(?:镇|乡|街道|办事处))/,
      // 匹配文件名中的乡镇名
      /[-_]([\u4e00-\u9fa5]{2,4}县[\u4e00-\u9fa5]{2,6}(?:镇|乡|街道))/,
    ];

    for (const pattern of townPatterns) {
      const match = name.match(pattern);
      if (match && match[1]) {
        return match[1].replace(/\d+/g, '').trim();
      }
    }

    // 匹配部门名称 (XX局、XX委、XX办等)
    const deptPatterns = [
      // 特别匹配：国家税务总局XX市/县税务局
      /(国家税务总局[\u4e00-\u9fa5]{2,6}(?:市|区|县)税务局)(?:\d{4}年|年度|政府信息)/,
      // 匹配完整部门名称: "沭阳县教育局" 或 "宿迁市发展和改革委员会"
      /([\u4e00-\u9fa5]{2,4}(?:省|市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|院|所|处|站|队))(?:\d{4}年|年度|政府信息)/,
      // 从文件名后半部分提取: -沭阳县教育局_2025-12-30
      /[-_]([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|税务局))(?:[-_]|$)/,
      // 开头匹配: "沭阳县教育局2024年度..."
      /^([\u4e00-\u9fa5]{2,4}(?:市|区|县)[\u4e00-\u9fa5]{2,15}(?:局|委|办|中心|院|所|税务局))\d{4}/,
    ];

    for (const pattern of deptPatterns) {
      const match = name.match(pattern);
      if (match && match[1]) {
        return match[1].replace(/\d+/g, '').trim();
      }
    }

    // Common patterns for district/city level
    const patterns = [
      // 区域名 + 年份
      /^(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|委员会))(?:\d{4})?/,
      // 年份 + 区域名
      /\d{4}年?(.{2,30}(?:市|区|县|省|镇|乡|街道|办事处|委员会))/,
      // 区域名人民政府/办事处
      /^(.{2,30}(?:市|区|县|省|街道|镇|乡))(?:\d{4}年)?(?:人民)?(?:政府|办事处|委员会)/,
      // 通用提取 (Fallback) - 包括局/委
      /(.{2,20}(?:市|区|县|街道|办事处|镇|乡|局|委|办))/,
    ];

    for (const pattern of patterns) {
      const match = name.match(pattern);
      if (match && match[1]) {
        // 移除可能的年份数字
        const regionName = match[1].replace(/\d+/g, '').trim();
        if (regionName.length >= 2) {
          return regionName;
        }
      }
    }
    return null;
  };

  // Process file (PDF or HTML)
  const processFile = async (file) => {
    setFile(file);
    setMessage('');

    const filename = file.name || '';

    // Extract year from filename
    const extractedYear = extractYearFromFilename(filename);
    if (extractedYear) {
      setYear(extractedYear);
    }

    // Extract region from filename (works for both PDF and HTML)
    const extractedRegion = extractRegionFromFilename(filename);
    if (extractedRegion) {
      setUnitName(extractedRegion);
      autoMatchRegion(extractedRegion);
    }

    try {
      if (file.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        // For PDF files, we'll just show a placeholder message
        setTextContent('[ PDF 文件已选择，将由后端进行解析 ]');

      } else if (file.type === 'text/html' || filename.toLowerCase().endsWith('.html')) {
        // Read HTML file content
        const text = await file.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const bodyText = doc.body?.textContent || '';
        setTextContent(bodyText.slice(0, 5000));

        // If no region from filename, try to extract from content
        if (!extractedRegion) {
          const extractedName = extractUnitNameFromText(bodyText);
          if (extractedName) {
            setUnitName(extractedName);
            autoMatchRegion(extractedName);
          }
        }
      } else if (file.type === 'text/plain' || filename.toLowerCase().endsWith('.txt')) {
        // Read TXT file content directly
        const text = await file.text();
        setTextContent(text.slice(0, 10000));

        // Try to extract unit name from text content
        if (!extractedRegion) {
          const extractedName = extractUnitNameFromText(text);
          if (extractedName) {
            setUnitName(extractedName);
            autoMatchRegion(extractedName);
          }
        }
      } else {
        setTextContent('不支持的文件类型，请上传 PDF、HTML 或 TXT 文件');
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

  const [duplicate, setDuplicate] = useState(false);
  const [emptyReport, setEmptyReport] = useState(false); // Existing report has no content

  // Check for duplicate report and its content status
  useEffect(() => {
    const checkDuplicate = async () => {
      if (!regionId || !year) {
        setDuplicate(false);
        setEmptyReport(false);
        return;
      }
      try {
        const resp = await apiClient.get('/reports', { params: { region_id: regionId, year } });
        const list = resp.data?.data || resp.data?.reports || resp.data || [];
        if (Array.isArray(list) && list.length > 0) {
          const existing = list[0];
          setDuplicate(true);
          try {
            const detailResp = await apiClient.get(`/reports/${existing.report_id || existing.id}`);
            const detail = detailResp.data;
            const parsedJson = detail.parsed_json || detail.latest_version?.parsed_json;
            const hasContent = parsedJson && Object.keys(parsedJson).length > 0;
            setEmptyReport(!hasContent);
          } catch (detailErr) {
            setEmptyReport(false);
          }
        } else {
          setDuplicate(false);
          setEmptyReport(false);
        }
      } catch (error) {
        setDuplicate(false);
        setEmptyReport(false);
      }
    };

    const timer = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timer);
  }, [regionId, year]);

  // Upload handler
  const handleUpload = async (autoParse = false) => {
    if (!regionId || !file) {
      setMessage('❌ 请选择文件并选择所属区域');
      return;
    }

    if (duplicate) {
      const confirmMsg = emptyReport
        ? '该报告已存在但内容为空，是否覆盖并重新解析？'
        : '该报告已存在，是否继续上传并覆盖？';
      if (!window.confirm(confirmMsg)) {
        return;
      }
    }

    setLoading(true);
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('region_id', regionId);
      formData.append('year', year);
      if (unitName) {
        formData.append('unit_name', unitName);
      }
      formData.append('file', file);
      if (autoParse) formData.append('auto_parse', 'true');
      if (model) formData.append('model', model);

      const response = await apiClient.post('/reports', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const payload = response.data || {};
      const uploadResult = {
        versionId: extractField(payload, 'version_id'),
      };

      // Show toast message
      setMessage('✅ 任务已创建，正在跳转到任务中心...');

      // Navigate to task center detail page after short delay
      // Navigate to task center detail page after short delay
      setTimeout(() => {
        if (uploadResult.versionId) {
          window.location.href = `/jobs/${uploadResult.versionId}`;
        }
      }, 1000);

    } catch (error) {
      const status = error.response?.status;
      if (status === 409) {
        const payload = error.response?.data || {};
        const versionId = extractField(payload, 'version_id');

        setMessage('⚠️ 该报告已存在，正在跳转到任务详情...');

        setTimeout(() => {
          if (versionId) {
            window.location.href = `/jobs/${versionId}`;
          }
        }, 1000);
      } else {
        setMessage(`❌ ${error.response?.data?.error || error.message || '上传失败'} `);
      }
    } finally {
      setLoading(false);
    }
  };

  // handleSaveText removed as unused

  const handleCancel = () => {
    setFile(null);
    setTextContent('');
    setUnitName('');
    setRegionId('');
    setMessage('');
  };

  // Build region path for display
  const getRegionPath = (regionId) => {
    const region = regions.find(r => String(r.id) === String(regionId));
    if (!region) return '';

    const path = [region.name];
    let curr = region;
    while (curr.parent_id) {
      const parent = regions.find(r => r.id === curr.parent_id);
      if (parent) {
        path.unshift(parent.name);
        curr = parent;
      } else {
        break;
      }
    }
    return path.join(' / ');
  };

  return (
    <div className="upload-report-page">
      {/* 标签页切换 */}
      <div className="upload-tabs">
        <button
          className={`upload-tab ${uploadMode === 'single' ? 'active' : ''}`}
          onClick={() => setUploadMode('single')}
        >
          <FileText size={16} /> 单个上传
        </button>
        <button
          className={`upload-tab ${uploadMode === 'batch' ? 'active' : ''}`}
          onClick={() => setUploadMode('batch')}
        >
          <FolderOpen size={16} /> 批量上传
        </button>
      </div>

      {uploadMode === 'single' ? (
        <div className="upload-report-modal">
          <div className="upload-modal-content">
            {/* File Drop Zone */}
            {/* AI 模型选择 - 结构与批量一致 */}
            <div className="form-section">
              <label>AI 模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value="qwen3-235b">通义千问 Qwen3-235B (ModelScope)</option>
                <option value="mimo-v2">小米 MiMo V2 (极速版)</option>
                <option value="deepseek-v3">DeepSeek V3.2 (ModelScope)</option>
                <option value="gemini/gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                <option value="gemini/gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini/gemini-3-flash">Gemini 3.0 Flash</option>
              </select>
            </div>

            {/* 拖拽区域 - 结构与批量一致，移除上面的 Label */}
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
                accept=".pdf,.html,.txt"
                className="hidden"
              />
              {file ? (
                <div className="file-info" onClick={(e) => e.stopPropagation()}>
                  <span className="file-icon"><FileText size={24} /></span>
                  <span className="file-name">{file.name}</span>
                  {duplicate && (
                    <span className={`duplicate-badge ${emptyReport ? 'empty' : ''}`}>
                      <AlertTriangle size={14} /> {emptyReport ? '内容为空，将覆盖' : '报告已存在'}
                    </span>
                  )}
                </div>
              ) : (
                <div className="drop-hint">
                  <div className="upload-icon-wrapper">
                    <UploadCloud size={48} />
                  </div>
                  <p className="upload-title"><strong>点击上传</strong> 或 <strong>拖拽文件至此</strong></p>
                  <p className="hint">支持 PDF、HTML 或 TXT 文件</p>
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="form-section">
              <label>所属年度</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value) || new Date().getFullYear())}
                className="max-w-200"
              />
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
              <div className={`message ${message.startsWith('❌') ? 'error' : message.startsWith('⚠️') ? 'warning' : 'success'} `}>
                {message}
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
      ) : (
        <BatchUpload isEmbedded={true} />
      )}
    </div>
  );
}

export default UploadReport;
