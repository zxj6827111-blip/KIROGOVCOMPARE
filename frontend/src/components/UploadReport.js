import React, { useState, useEffect, useRef, useCallback } from 'react';
import './UploadReport.css';
import { apiClient } from '../apiClient';
import BatchUpload from './BatchUpload';
import RegionCascader from './RegionCascader';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Link,
  PlayCircle,
  RefreshCw,
  Search,
  UploadCloud,
} from 'lucide-react';
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
import { useTaskDrawer } from './tasks/TaskDrawerProvider';
import { getAxiosFriendlyError } from '../utils/errorTranslator';
import { appendReturnTo } from '../app/routeRegistry';
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

const URL_DEMO_RULE = {
  province: '江苏省',
  city: '淮安市',
  unit: '政府信息公开年报栏目',
  domain: 'www.huaian.gov.cn',
  status: '已启用',
};

const URL_COLLECTION_MODES = {
  auto: {
    label: '自动识别',
    description: '系统根据网址结构判断单页或栏目页',
  },
  single: {
    label: '单页采集',
    description: '适合具体某一篇年报详情页',
    expected: '预计 1 篇',
  },
  list: {
    label: '栏目批量采集',
    description: '适合年报栏目、列表或汇总页',
    expected: '预计多篇',
  },
};

const URL_MODE_EXAMPLES = {
  single: 'https://scjgj.huaian.gov.cn/col/4039_446643/art/17356608/17364738729029ffO7DUB.html',
  list: 'https://www.huaian.gov.cn/col/18073_668815/index.html',
};

const isPdfCollectionUrl = (url) => /\.pdf(?:$|[?#])/i.test((url || '').trim());

const inferUrlCollectionMode = (url) => {
  const normalized = (url || '').trim().toLowerCase();
  if (!normalized) return 'list';
  if (isPdfCollectionUrl(normalized)) return 'single';
  if (normalized.includes('/art/') || /\/art\/[^/]+\/[^/]+\.html?$/.test(normalized)) return 'single';
  if (normalized.includes('/index.') || normalized.includes('/col/') || normalized.includes('list')) return 'list';
  return 'list';
};

const getUrlHost = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return URL_DEMO_RULE.domain;
  }
};

const URL_DEMO_STATUS = {
  ready: {
    label: '预览命中',
    tone: 'neutral',
    icon: Search,
  },
  queued: {
    label: '已创建解析',
    tone: 'info',
    icon: Clock,
  },
  reused: {
    label: '复用已有任务',
    tone: 'success',
    icon: CheckCircle2,
  },
  imported: {
    label: '已入库',
    tone: 'success',
    icon: CheckCircle2,
  },
  parsing: {
    label: '解析中',
    tone: 'info',
    icon: Clock,
  },
  pending: {
    label: '待匹配',
    tone: 'warning',
    icon: AlertTriangle,
  },
  failed: {
    label: '下载失败',
    tone: 'error',
    icon: AlertCircle,
  },
  downloaded: {
    label: '已下载',
    tone: 'neutral',
    icon: Database,
  },
  skipped: {
    label: '已跳过',
    tone: 'muted',
    icon: AlertCircle,
  },
  collecting: {
    label: '处理中',
    tone: 'info',
    icon: Clock,
  },
};

const mapUrlCollectionItem = (item, index) => {
  const statusMap = {
    ready: 'ready',
    queued: 'queued',
    reused: 'reused',
    pending_match: 'pending',
    failed: 'failed',
  };
  const fileName = item.file_name || '';

  return {
    id: item.id || `${item.url || 'url'}-${index}`,
    unitName: item.unit_name || item.region_name || '待确认单位',
    regionName: item.region_name || '',
    year: item.year || '-',
    title: item.title || item.url || '未命名年报',
    sourceUrl: item.final_url || item.url || '',
    status: statusMap[item.status] || 'downloaded',
    fileType: fileName.toLowerCase().endsWith('.pdf') || isPdfCollectionUrl(item.final_url || item.url) ? 'PDF' : 'HTML',
    message: item.message || '',
    reportId: item.report_id,
    versionId: item.version_id,
    jobId: item.job_id,
    reusedVersion: Boolean(item.reused_version),
    reusedJob: Boolean(item.reused_job),
  };
};

function UrlCollectionDemo({ toast, model, taskDrawer }) {
  const [targetUrl, setTargetUrl] = useState(URL_MODE_EXAMPLES.list);
  const [collectionMode, setCollectionMode] = useState('auto');
  const [targetYear, setTargetYear] = useState('auto');
  const [ruleMode, setRuleMode] = useState('auto');
  const [ruleData, setRuleData] = useState(URL_DEMO_RULE);
  const [started, setStarted] = useState(false);
  const [previewed, setPreviewed] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const inferredMode = inferUrlCollectionMode(targetUrl);
  const effectiveMode = lastResult?.collection_mode || (collectionMode === 'auto' ? inferredMode : collectionMode);
  const modeView = URL_COLLECTION_MODES[effectiveMode];
  const pageTypeLabel = effectiveMode === 'single' ? '具体详情页' : '栏目汇总页';
  const expectedCount =
    lastResult?.summary?.discovered > 0
      ? `已发现 ${lastResult.summary.discovered} 篇年报`
      : effectiveMode === 'single'
        ? '预计 1 篇年报'
        : '预计多篇年报';
  const [rows, setRows] = useState([]);

  const summary = rows.reduce(
    (acc, row) => {
      acc.discovered += row.status === 'skipped' ? 0 : 1;
      if (!['failed', 'skipped'].includes(row.status)) acc.downloaded += 1;
      if (['ready', 'queued', 'reused', 'downloaded'].includes(row.status)) acc.matched += 1;
      if (row.status === 'pending') acc.pending += 1;
      if (row.status === 'failed') acc.failed += 1;
      return acc;
    },
    { discovered: 0, downloaded: 0, matched: 0, pending: 0, failed: 0 }
  );

  const setRowStatus = (id, status) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
  };

  const changeCollectionMode = (mode) => {
    setCollectionMode(mode);
    setStarted(false);
    setPreviewed(false);
    setLastResult(null);
    if (mode === 'single') setTargetUrl(URL_MODE_EXAMPLES.single);
    if (mode === 'list') setTargetUrl(URL_MODE_EXAMPLES.list);
    setRows([]);
  };

  const buildRequestPayload = (dryRun, overrides = {}) => {
    const payload = {
      url: overrides.url || targetUrl.trim(),
      collection_mode: overrides.collectionMode || collectionMode,
      dry_run: dryRun,
      limit: overrides.limit || 50,
    };
    const requestYear = overrides.year ?? targetYear;
    if (requestYear && requestYear !== 'auto') {
      payload.year = Number(requestYear);
    }
    if (model) {
      payload.model = model;
    }
    return payload;
  };

  const applyCollectionResult = (data, options = {}) => {
    const mappedRows = (data?.items || []).map(mapUrlCollectionItem);
    setRows(mappedRows);
    setLastResult(data || null);
    setRuleData({
      province: data?.rule?.province || URL_DEMO_RULE.province,
      city: data?.rule?.city || URL_DEMO_RULE.city,
      unit: data?.rule?.unit || URL_DEMO_RULE.unit,
      domain: data?.rule?.domain || getUrlHost(targetUrl),
      status: data?.rule?.status === 'enabled' ? '已启用' : URL_DEMO_RULE.status,
    });
    setPreviewed(Boolean(options.previewed));
    setStarted(Boolean(options.started));
    return mappedRows;
  };

  const trackCreatedJobs = (mappedRows) => {
    const jobRows = mappedRows.filter((row) => row.jobId);
    jobRows.forEach((row) => {
      taskDrawer.trackParseJob({
        job_id: row.jobId,
        version_id: row.versionId,
        status: 'queued',
        progress: 0,
        step_name: row.reusedJob || row.reusedVersion ? '复用已有解析任务' : '等待解析',
        file_name: row.title,
      });
    });
    if (jobRows.length > 0) {
      taskDrawer.openDrawer();
    }
  };

  const handleIdentifyRule = async () => {
    if (!targetUrl.trim()) {
      toast.warning('请输入网址', '请粘贴政府网站年报详情页或栏目页网址。');
      return;
    }

    setIsPreviewing(true);
    try {
      const response = await apiClient.post('/reports/url-collection', buildRequestPayload(true));
      const mappedRows = applyCollectionResult(response.data, { previewed: true, started: false });
      const discovered = response.data?.summary?.discovered ?? mappedRows.length;
      toast.success('规则识别完成', `后端已预览命中 ${discovered} 条年报内容，尚未写入数据库。`);
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '规则识别失败，请检查网址是否可访问。');
      toast.error('规则识别失败', friendly.message, { detail: friendly.detail });
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleStart = async () => {
    if (!targetUrl.trim()) {
      toast.warning('请输入网址', '请粘贴政府网站年报详情页或栏目页网址。');
      return;
    }

    setIsCollecting(true);
    try {
      const response = await apiClient.post('/reports/url-collection', buildRequestPayload(false));
      const mappedRows = applyCollectionResult(response.data, { previewed: false, started: true });
      trackCreatedJobs(mappedRows);
      const submitted = response.data?.summary?.submitted || 0;
      const reused = response.data?.summary?.reused || 0;
      const pending = response.data?.summary?.pending || 0;
      const failed = response.data?.summary?.failed || 0;
      if (submitted === 0 && reused === 0 && pending === 0 && failed > 0) {
        toast.error('采集导入未成功', `失败 ${failed} 条，请查看采集结果中的原因。`);
      } else if (failed > 0) {
        toast.warning('采集导入部分完成', `已创建 ${submitted} 个解析任务，复用 ${reused} 个，待确认 ${pending} 条，失败 ${failed} 条。`);
      } else {
        toast.success('采集导入已提交', `已创建 ${submitted} 个解析任务，复用 ${reused} 个，待确认 ${pending} 条。`);
      }
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '采集导入失败，请稍后重试。');
      toast.error('采集导入失败', friendly.message, { detail: friendly.detail });
    } finally {
      setIsCollecting(false);
    }
  };

  const handlePendingMatch = () => {
    toast.info('需要人工确认', '当前已保留待匹配结果，人工选择单位并重新入库的接口将在下一步接入。');
  };

  const handleRetry = async (row) => {
    setRowStatus(row.id, 'collecting');
    try {
      const response = await apiClient.post(
        '/reports/url-collection',
        buildRequestPayload(false, {
          url: row.sourceUrl,
          collectionMode: 'single',
          year: row.year === '-' ? targetYear : row.year,
          limit: 1,
        })
      );
      const [nextRow] = (response.data?.items || []).map(mapUrlCollectionItem);
      setRows((current) => current.map((item) => (item.id === row.id ? nextRow || { ...item, status: 'failed' } : item)));
      if (nextRow?.jobId) {
        trackCreatedJobs([nextRow]);
      }
      toast.success('重试已提交', '该条目已重新采集并尝试创建解析任务。');
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '重试失败，请稍后再试。');
      setRows((current) =>
        current.map((item) => (item.id === row.id ? { ...item, status: 'failed', message: friendly.message } : item))
      );
      toast.error('重试失败', friendly.message, { detail: friendly.detail });
    }
  };

  const handleSkip = (id) => {
    setRowStatus(id, 'skipped');
    toast.warning('已跳过', '该条目不会进入本次入库流程。');
  };

  const handleViewTask = (row) => {
    if (row.versionId || row.jobId) {
      taskDrawer.openDrawer();
      return;
    }
    toast.info('暂无任务', row.message || '该条目尚未创建解析任务。');
  };

  return (
    <div className="url-collection-demo">
      <div className="url-collection-panel">
        <div className="url-collection-form">
          <div className="form-section url-input-section">
            <label>目标网址</label>
            <div className="url-input-row">
              <span className="url-input-icon">
                <Link size={18} />
              </span>
              <input
                type="text"
                value={targetUrl}
                onChange={(event) => {
                  setTargetUrl(event.target.value);
                  setStarted(false);
                  setPreviewed(false);
                  setLastResult(null);
                }}
                placeholder="粘贴政府网站年报详情页或栏目页网址"
              />
              <button
                type="button"
                className="btn-secondary btn-icon-text"
                onClick={handleIdentifyRule}
                disabled={isPreviewing || isCollecting}
              >
                <Search size={16} /> {isPreviewing ? '识别中...' : '识别规则'}
              </button>
            </div>
          </div>

          <div className="form-section url-mode-section">
            <label>采集方式</label>
            <div className="url-mode-toggle" role="group" aria-label="采集方式">
              {Object.entries(URL_COLLECTION_MODES).map(([mode, config]) => {
                const ModeIcon = mode === 'single' ? FileText : mode === 'list' ? FolderOpen : Search;
                return (
                  <button
                    type="button"
                    key={mode}
                    className={`url-mode-option ${collectionMode === mode ? 'active' : ''}`}
                    onClick={() => changeCollectionMode(mode)}
                  >
                    <ModeIcon size={16} />
                    <span>
                      <strong>{config.label}</strong>
                      <small>{config.description}</small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="url-mode-hint">
              <span>单页示例：{URL_MODE_EXAMPLES.single}</span>
              <span>栏目示例：{URL_MODE_EXAMPLES.list}</span>
            </div>
          </div>

          <div className="url-collection-grid">
            <div className="form-section">
              <label>年份</label>
              <select value={targetYear} onChange={(event) => setTargetYear(event.target.value)}>
                <option value="auto">自动识别</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
              </select>
            </div>
            <div className="form-section">
              <label>采集规则</label>
              <select value={ruleMode} onChange={(event) => setRuleMode(event.target.value)}>
                <option value="auto">自动匹配规则</option>
                <option value="huaian-common">江苏省 / 淮安市 / 通用年报栏目</option>
                <option value="common">通用采集</option>
              </select>
            </div>
            <div className="form-section">
              <label>采集内容</label>
              <select defaultValue="annual-report">
                <option value="annual-report">政府信息公开年报</option>
                <option value="budget" disabled>
                  预决算报告（后续扩展）
                </option>
              </select>
            </div>
          </div>

          {(previewed || started || ruleData) && (
            <div className="rule-preview">
              <div>
                <p className="rule-preview__label">匹配到的规则</p>
                <h3>
                  {ruleData.province} / {ruleData.city} / {ruleData.unit}
                </h3>
                <p className="rule-preview__mode">
                  当前识别为：<strong>{pageTypeLabel}</strong>，{expectedCount}
                </p>
              </div>
              <div className="rule-preview__meta">
                <span>页面类型：{effectiveMode === 'single' ? 'detail_page' : 'list_page'}</span>
                <span>识别方式：{collectionMode === 'auto' ? '自动识别' : '手动指定'}</span>
                <span>域名：{ruleData.domain || getUrlHost(targetUrl)}</span>
                <span className="rule-preview__enabled">{ruleData.status}</span>
              </div>
            </div>
          )}

          <div className="url-demo-note">
            这里不会显示 API Key、OCR 参数、浏览器路径、调试开关和服务器存储目录；这些内容后续只放在服务端或管理员配置里。
          </div>

          <div className="url-collection-actions">
            <button
              type="button"
              className="btn-primary btn-icon-text"
              onClick={handleStart}
              disabled={isCollecting || isPreviewing || !targetUrl.trim()}
            >
              <PlayCircle size={17} /> {isCollecting ? '采集中...' : '开始采集并导入'}
            </button>
          </div>
        </div>
      </div>

      <div className={`url-task-summary ${started ? 'is-active' : ''}`}>
        {[
          ['发现', summary.discovered],
          ['已下载', summary.downloaded],
          ['已匹配', summary.matched],
          ['待确认', summary.pending],
          ['失败', summary.failed],
        ].map(([label, value]) => (
          <div className="url-summary-item" key={label}>
            <span>{label}</span>
            <strong>{started || previewed ? value : 0}</strong>
          </div>
        ))}
      </div>

      <div className="url-results-panel">
        <div className="url-results-header">
          <div>
            <h3>采集结果</h3>
            <p>
              {isCollecting
                ? '系统正在下载网页、识别年报链接并创建解析任务。'
                : started
                ? effectiveMode === 'single'
                  ? '已调用后端导入单个详情页，解析任务会进入右侧任务抽屉。'
                  : '已调用后端导入栏目页命中的年报内容，解析任务会进入右侧任务抽屉。'
                : previewed
                  ? '这是后端预览结果，尚未写入数据库。'
                  : '点击“识别规则”预览命中内容，点击“开始采集并导入”后写入数据库并创建解析任务。'}
            </p>
          </div>
          <span className="url-results-badge">{effectiveMode === 'single' ? '单页采集' : '栏目批量'}</span>
        </div>

        <div className="url-results-table-wrap">
          <table className="url-results-table">
            <thead>
              <tr>
                <th>单位名称</th>
                <th>年份</th>
                <th>标题</th>
                <th>来源</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan="6" className="url-results-empty">
                    暂无采集结果
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const status = URL_DEMO_STATUS[row.status] || URL_DEMO_STATUS.downloaded;
                const StatusIcon = status.icon;
                return (
                  <tr key={row.id} className={row.status === 'skipped' ? 'is-muted' : ''}>
                    <td>{row.unitName}</td>
                    <td>{row.year}</td>
                    <td>
                      <div className="url-result-title">
                        <span>{row.title}</span>
                        <small>{row.fileType}{row.message ? ` · ${row.message}` : ''}</small>
                      </div>
                    </td>
                    <td className="source-cell">{row.sourceUrl}</td>
                    <td>
                      <span className={`status-pill status-pill--${status.tone}`}>
                        <StatusIcon size={14} /> {status.label}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {row.status === 'pending' && (
                          <>
                            <button type="button" onClick={() => handlePendingMatch(row)}>
                              选择单位
                            </button>
                            <button type="button" onClick={() => handleSkip(row.id)}>
                              跳过
                            </button>
                          </>
                        )}
                        {row.status === 'failed' && (
                          <button type="button" onClick={() => handleRetry(row)}>
                            <RefreshCw size={13} /> 重试
                          </button>
                        )}
                        {['queued', 'reused'].includes(row.status) && (
                          <button type="button" onClick={() => handleViewTask(row)}>
                            查看任务
                          </button>
                        )}
                        {row.status === 'ready' && <span className="muted-action">预览结果</span>}
                        {row.status === 'downloaded' && <button type="button" onClick={() => handleRetry(row)}>继续入库</button>}
                        {row.status === 'collecting' && <span className="muted-action">处理中...</span>}
                        {row.status === 'skipped' && <span className="muted-action">无需处理</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function UploadReport() {
  const toast = useToast();
  const confirmAction = useConfirmDialog();
  const taskDrawer = useTaskDrawer();
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [unitName, setUnitName] = useState('');
  const [file, setFile] = useState(null);
  const [sourceKind, setSourceKind] = useState('pdf'); // 'pdf' | 'package'
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

        const lowerName = String(selectedFile.name || '').toLowerCase();
    if (lowerName.endsWith('.kirogov.zip')) {
      setSourceKind('package');
      setTextContent('');
      setMessage('');
      return;
    }
    if (lowerName.endsWith('.zip')) {
      setFile(null);
      setTextContent('');
      setMessage('⚠️ 本地解析包请使用 .kirogov.zip（普通上传不支持 zip）');
      return;
    }
    if (sourceKind === 'package' && !lowerName.endsWith('.kirogov.zip')) {
      setFile(null);
      setMessage('⚠️ 当前为材料包模式，请选择 .kirogov.zip 文件');
      return;
    }

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
      const isPackage = sourceKind === 'package';
      if (isPackage && !String(file.name || '').toLowerCase().endsWith('.kirogov.zip')) {
        const warning = '本地解析包仅支持 .kirogov.zip 文件';
        setMessage('\u26a0\ufe0f ' + warning);
        toast.warning('文件类型不正确', warning);
        setLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append('region_id', regionId);
      formData.append('year', year);
      if (unitName) {
        formData.append('unit_name', unitName);
      }
      formData.append('file', file);
      if (!isPackage) {
        if (autoParse) formData.append('auto_parse', 'true');
        if (model) formData.append('model', model);
      }

      const endpoint = isPackage ? '/reports/structured-import' : '/reports';
      const response = await apiClient.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const payload = response.data || {};
      const uploadResult = {
        versionId: extractField(payload, 'version_id'),
        jobId: extractField(payload, 'job_id'),
      };

      setMessage('✅ 解析任务已创建，可在右侧任务抽屉查看进度。');

      if (uploadResult.jobId) {
        taskDrawer.trackParseJob({
          job_id: uploadResult.jobId,
          version_id: uploadResult.versionId,
          status: 'queued',
          progress: 0,
          step_name: isPackage ? '等待结构化导入' : '等待解析',
          file_name: file?.name,
        });
        taskDrawer.openDrawer();
      }

      toast.success('解析任务已创建', '无需跳转任务中心，右侧任务抽屉会持续更新进度。', {
        actionLabel: uploadResult.versionId ? '查看任务详情' : '打开任务中心',
        onAction: () => {
          window.location.href = uploadResult.versionId
            ? appendReturnTo(`/jobs/${uploadResult.versionId}`, window.location.pathname + window.location.search)
            : '/jobs';
        },
        duration: 8000,
      });
    } catch (error) {
      const status = error.response?.status;
      if (status === 409) {
        const payload = error.response?.data || {};
        const versionId = extractField(payload, 'version_id');
        const jobId = extractField(payload, 'job_id');

        setMessage('⚠️ 该报告已存在，可在任务抽屉或任务详情查看状态。');

        if (jobId || versionId) {
          taskDrawer.trackParseJob({
            job_id: jobId,
            version_id: versionId,
            status: 'queued',
            progress: 0,
            step_name: '已存在报告，正在同步任务状态',
            file_name: file?.name,
          });
          taskDrawer.openDrawer();
        }

        toast.warning('报告已存在', '已保留当前页面，可从任务抽屉查看或进入任务详情。', {
          actionLabel: versionId ? '查看任务详情' : '打开任务中心',
          onAction: () => {
            window.location.href = versionId
              ? appendReturnTo(`/jobs/${versionId}`, window.location.pathname + window.location.search)
              : '/jobs';
          },
          duration: 8000,
        });
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
        <button
          type="button"
          className={`upload-tab ${uploadMode === 'url' ? 'active' : ''}`}
          onClick={() => setUploadMode('url')}
        >
          <Link size={16} /> 网址采集
        </button>
      </div>

      {uploadMode === 'single' ? (
        <div className="upload-report-modal">
          <div className="upload-modal-content">
                        <div className="form-section source-kind-section">
              <label>上传方式</label>
              <div className="source-kind-options" role="radiogroup" aria-label="上传方式">
                <label className={`source-kind-option ${sourceKind === 'pdf' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="sourceKind"
                    checked={sourceKind === 'pdf'}
                    onChange={() => {
                      setSourceKind('pdf');
                      setFile(null);
                      setTextContent('');
                      setMessage('');
                    }}
                    disabled={loading}
                  />
                  <span>普通 PDF / HTML / 文本（AI 解析）</span>
                </label>
                <label className={`source-kind-option ${sourceKind === 'package' ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="sourceKind"
                    checked={sourceKind === 'package'}
                    onChange={() => {
                      setSourceKind('package');
                      setFile(null);
                      setTextContent('');
                      setMessage('');
                    }}
                    disabled={loading}
                  />
                  <span>本地解析包（.kirogov.zip）</span>
                </label>
              </div>
              {sourceKind === 'package' && (
                <p className="hint source-kind-hint">
                  上传本地生成的标准材料包。服务器只做校验、入库与规则审查，不调用 AI。
                </p>
              )}
            </div>

            {sourceKind !== 'package' && (
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
            )}{/* package-mode: end model */}

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
                accept={sourceKind === 'package' ? '.kirogov.zip,application/zip' : '.pdf,.html,.txt,.md,.markdown'}
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
                    {loading ? '处理中...' : sourceKind === 'package' ? '上传材料包并导入' : '上传并启动解析'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : uploadMode === 'batch' ? (
        <BatchUpload
          isEmbedded={true}
          model={model}
          onModelChange={setModel}
          modelOptions={modelOptions}
          modelConfigLoading={modelConfigLoading}
        />
      ) : (
        <UrlCollectionDemo toast={toast} model={model} taskDrawer={taskDrawer} />
      )}
    </div>
  );
}

export default UploadReport;
