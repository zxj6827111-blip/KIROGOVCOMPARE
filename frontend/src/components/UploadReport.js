import React, { useState, useEffect, useRef, useCallback } from 'react';
import './UploadReport.css';
import { apiClient } from '../apiClient';
import BatchUpload from './BatchUpload';
import RegionCascader from './RegionCascader';
import { FileText, FolderOpen, AlertTriangle, UploadCloud } from 'lucide-react';
import {
  extractRegionFromFilename,
  extractUnitNameFromText,
  extractYearFromFilename,
  extractYearFromText,
  normalizeDetectionText,
  stripCommonUnitSuffix,
} from '../utils/uploadAutoDetect';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import { getAxiosFriendlyError } from '../utils/errorTranslator';
import PageHeader from './common/PageHeader';

const extractField = (payload, key) =>
  payload?.[key] || payload?.[key.replace(/_./g, (m) => m[1].toUpperCase())];

const normalizeUploadModelOptions = (rawOptions) => {
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const value = String(item.value || '').trim();
      const label = String(item.label || item.name || item.value || '').trim();
      if (!value || !label) return null;
      return { value, label };
    })
    .filter(Boolean);
};

const DEFAULT_UPLOAD_MODEL_OPTION = { value: 'openai/gpt-5.5', label: 'GPT-5.5' };

let pdfjsModulePromise = null;

const loadPdfjs = async () => {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => mod.default || mod);
  }
  return pdfjsModulePromise;
};

const extractPdfFirstPageText = async (selectedFile) => {
  const pdfjs = await loadPdfjs();
  const buffer = await selectedFile.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    disableFontFace: true,
    isEvalSupported: false,
    useWorkerFetch: false,
  });
  const pdf = await loadingTask.promise;

  try {
    const firstPage = await pdf.getPage(1);
    const textContent = await firstPage.getTextContent();
    const text = textContent.items
      .map((item) => String(item?.str || '').trim())
      .filter(Boolean)
      .join(' ');
    return normalizeDetectionText(text);
  } finally {
    await pdf.destroy?.();
  }
};

function UploadReport() {
  const toast = useToast();
  const confirmAction = useConfirmDialog();
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [unitName, setUnitName] = useState('');
  const [file, setFile] = useState(null);
  const [, setTextContent] = useState('');
  const [model, setModel] = useState('');
  const [modelOptions, setModelOptions] = useState([]);
  const [modelConfigLoading, setModelConfigLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState('single');
  const [duplicate, setDuplicate] = useState(false);
  const [emptyReport, setEmptyReport] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const loadRegions = async () => {
      try {
        const resp = await apiClient.get('/regions');
        let rows = resp.data?.data ?? resp.data?.regions ?? resp.data ?? [];
        if (!Array.isArray(rows)) rows = [];

        const regionMap = new Map();
        const roots = [];

        rows.forEach((region) => {
          region.children = [];
          regionMap.set(region.id, region);
        });

        rows.forEach((region) => {
          if (region.parent_id && regionMap.has(region.parent_id)) {
            regionMap.get(region.parent_id).children.push(region);
          } else {
            roots.push(region);
          }
        });

        const sortNodes = (nodes) => {
          nodes.sort((a, b) => a.id - b.id);
          nodes.forEach((node) => sortNodes(node.children));
        };
        sortNodes(roots);

        const sortedRows = [];
        const traverse = (nodes) => {
          nodes.forEach((node) => {
            const { children, ...rest } = node;
            sortedRows.push(rest);
            traverse(children);
          });
        };
        traverse(roots);

        setRegions(sortedRows);
      } catch {
        // Keep upload page usable even if region list load fails temporarily.
      }
    };

    loadRegions();
  }, []);

  useEffect(() => {
    const loadModelConfig = async () => {
      try {
        const resp = await apiClient.get('/ai/config');
        const uploadParse = resp.data?.uploadParse || {};
        const options = normalizeUploadModelOptions(uploadParse.options);
        const defaultModel = String(uploadParse.defaultModel || '').trim();

        setModelOptions(options);
        setModel((current) => {
          if (current && options.some((item) => item.value === current)) {
            return current;
          }
          if (defaultModel && options.some((item) => item.value === defaultModel)) {
            return defaultModel;
          }
          return options[0]?.value || current || '';
        });
      } catch (err) {
        console.error('Failed to load upload model config:', err);
        setModelOptions([DEFAULT_UPLOAD_MODEL_OPTION]);
        setModel(DEFAULT_UPLOAD_MODEL_OPTION.value);
      } finally {
        setModelConfigLoading(false);
      }
    };

    loadModelConfig();
  }, []);

  const autoMatchRegion = useCallback(
    (name) => {
      if (!name || !regions.length) return;

      const regionMap = new Map();
      regions.forEach((region) => regionMap.set(region.id, region));

      let bestMatchId = null;
      let maxScore = -1;
      const searchName = stripCommonUnitSuffix(name);

      regions.forEach((region) => {
        const dbName = stripCommonUnitSuffix(region.name);
        if (!dbName) return;
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

        let current = region;
        let depth = 0;
        while (current.parent_id && regionMap.has(current.parent_id) && depth < 10) {
          const parent = regionMap.get(current.parent_id);
          const parentName = stripCommonUnitSuffix(parent.name);
          if (parentName && searchName.includes(parentName)) {
            score += 20;
          }
          current = parent;
          depth += 1;
        }

        if (score > maxScore) {
          maxScore = score;
          bestMatchId = region.id;
        } else if (score === maxScore) {
          if (region.level > (regionMap.get(bestMatchId)?.level || 0)) {
            bestMatchId = region.id;
          }
        }
      });

      if (bestMatchId) {
        setRegionId(String(bestMatchId));
      }
    },
    [regions]
  );

  const applyDetectedTextMetadata = useCallback(
    (detectedText, extractedRegion) => {
      const extractedName = extractUnitNameFromText(detectedText);
      const detectedYear = extractYearFromText(detectedText);

      if (detectedYear) {
        setYear(detectedYear);
      }

      if (!extractedName) {
        return;
      }

      if (!extractedRegion) {
        setUnitName(extractedName);
        autoMatchRegion(extractedName);
        return;
      }

      const normalizedFilenameGuess = stripCommonUnitSuffix(extractedRegion);
      const normalizedPdfGuess = stripCommonUnitSuffix(extractedName);
      if (normalizedPdfGuess && normalizedPdfGuess.length > normalizedFilenameGuess.length) {
        setUnitName(extractedName);
        autoMatchRegion(extractedName);
      }
    },
    [autoMatchRegion]
  );

  useEffect(() => {
    if (!unitName || regionId || regions.length === 0) {
      return;
    }
    autoMatchRegion(unitName);
  }, [autoMatchRegion, regionId, regions.length, unitName]);

  const processFile = async (selectedFile) => {
    setFile(selectedFile);
    setMessage('');

    const filename = selectedFile.name || '';
    const extractedYear = extractYearFromFilename(filename);
    if (extractedYear) {
      setYear(extractedYear);
    }

    const extractedRegion = extractRegionFromFilename(filename);
    if (extractedRegion) {
      setUnitName(extractedRegion);
      autoMatchRegion(extractedRegion);
    }

    try {
      if (selectedFile.type === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
        const firstPageText = await extractPdfFirstPageText(selectedFile);
        setTextContent(firstPageText.slice(0, 5000));
        applyDetectedTextMetadata(firstPageText, extractedRegion);
      } else if (selectedFile.type === 'text/html' || filename.toLowerCase().endsWith('.html')) {
        const text = await selectedFile.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const bodyText = doc.body?.textContent || '';
        setTextContent(bodyText.slice(0, 5000));
        applyDetectedTextMetadata(bodyText, extractedRegion);
      } else if (
        selectedFile.type === 'text/plain' ||
        filename.toLowerCase().endsWith('.txt') ||
        filename.toLowerCase().endsWith('.md') ||
        filename.toLowerCase().endsWith('.markdown')
      ) {
        const text = await selectedFile.text();
        setTextContent(text.slice(0, 10000));
        applyDetectedTextMetadata(text, extractedRegion);
      } else {
        setTextContent('不支持的文件类型，请上传 PDF、HTML、TXT 或 Markdown 文件');
      }
    } catch (err) {
      console.error('Error processing file:', err);
      setTextContent('文件读取失败');
    }
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleFileSelect = (event) => {
    const selectedFile = event.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const handleDropZoneClick = () => {
    fileInputRef.current?.click();
  };

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
            const parsedJson =
              detail.active_version?.parsed_json ||
              detail.parsed_json ||
              detail.latest_version?.parsed_json;
            const hasContent = parsedJson && Object.keys(parsedJson).length > 0;
            setEmptyReport(!hasContent);
          } catch {
            setEmptyReport(false);
          }
        } else {
          setDuplicate(false);
          setEmptyReport(false);
        }
      } catch {
        setDuplicate(false);
        setEmptyReport(false);
      }
    };

    const timer = setTimeout(checkDuplicate, 500);
    return () => clearTimeout(timer);
  }, [regionId, year]);

  const handleUpload = async (autoParse = false) => {
    if (!regionId || !file) {
      const warning = '请选择文件并选择所属区域';
      setMessage(`❌ ${warning}`);
      toast.warning('上传信息不完整', warning);
      return;
    }

    if (duplicate) {
      const confirmMsg = emptyReport
        ? '该报告已存在但内容为空，是否覆盖并重新解析？'
        : '该报告已存在，是否继续上传并覆盖？';
      const shouldOverwrite = await confirmAction({
        title: '覆盖已有报告',
        message: confirmMsg,
        confirmText: '继续覆盖',
        cancelText: '取消',
        tone: 'warning',
      });
      if (!shouldOverwrite) {
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

      setMessage('✅ 任务已创建，正在跳转到任务中心...');

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
        const friendly = getAxiosFriendlyError(error, '上传失败，请稍后重试。');
        setMessage(`❌ ${friendly.message}`);
        toast.error('上传失败', friendly.message, { detail: friendly.detail });
      }
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
  };

  const messageTone = message.startsWith('❌')
    ? 'error'
    : message.startsWith('⚠️')
      ? 'warning'
      : 'success';

  return (
    <div className="upload-report-page">
      <PageHeader
        title="上传报告"
        subtitle="上传单份或批量年报文件，系统会自动识别首页信息并创建解析任务。"
      />
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
            <div className="form-section">
              <label>AI 模型</label>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={loading || modelConfigLoading || modelOptions.length === 0}
              >
                {modelOptions.length > 0 ? (
                  modelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))
                ) : (
                  <option value={DEFAULT_UPLOAD_MODEL_OPTION.value}>
                    {modelConfigLoading ? 'AI 模型配置加载中...' : DEFAULT_UPLOAD_MODEL_OPTION.label}
                  </option>
                )}
              </select>
            </div>

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
                accept=".pdf,.html,.txt,.md,.markdown"
                className="hidden"
              />
              {file ? (
                <div className="file-info" onClick={(event) => event.stopPropagation()}>
                  <span className="file-icon">
                    <FileText size={24} />
                  </span>
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
                  <p className="upload-title">
                    <strong>点击上传</strong> 或 <strong>拖拽文件至此</strong>
                  </p>
                  <p className="hint">支持 PDF、HTML、TXT 或 Markdown 文件</p>
                </div>
              )}
            </div>

            <div className="form-section">
              <label>所属年度</label>
              <input
                type="number"
                value={year}
                onChange={(event) => setYear(parseInt(event.target.value, 10) || new Date().getFullYear())}
                className="max-w-200"
              />
            </div>

            <div className="form-section">
              <label>
                所属区域 <span className="label-hint">(自动匹配或手动选择)</span>
              </label>
              <RegionCascader regions={regions} value={regionId} onChange={(value) => setRegionId(value)} />
            </div>

            {message && <div className={`message ${messageTone}`}>{message}</div>}

            <div className="form-actions">
              {message.startsWith('✅') ? (
                <button type="button" className="btn-primary" onClick={handleCancel}>
                  确定
                </button>
              ) : (
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
        <BatchUpload
          isEmbedded={true}
          model={model}
          onModelChange={setModel}
          modelOptions={modelOptions}
          modelConfigLoading={modelConfigLoading}
        />
      )}
    </div>
  );
}

export default UploadReport;
