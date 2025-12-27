import React, { useEffect, useState } from 'react';
import './ReportDetail.css';
import { apiClient } from '../apiClient';
import { Table2View, Table3View, Table4View } from './TableViews';
import ParsedDataEditor from './ParsedDataEditor';
import ConsistencyCheckView from './ConsistencyCheckView';

function ReportDetail({ reportId: propReportId, onBack }) {
  const reportId = propReportId || window.location.pathname.split('/').pop();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showParsed, setShowParsed] = useState(true); // 默认展开
  const [showMetadata, setShowMetadata] = useState(false); // 元数据默认隐藏
  const [editingData, setEditingData] = useState(null); // 编辑模式
  const [activeTab, setActiveTab] = useState('content'); // 'content' | 'checks'
  const [highlightCells, setHighlightCells] = useState([]); // 勾稽问题单元格路径
  const [highlightTexts, setHighlightTexts] = useState([]); // 勾稽问题文本

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

  // 获取勾稽校验问题数据用于高亮
  const fetchHighlights = async () => {
    if (!reportId) return;
    try {
      const response = await apiClient.get(`/reports/${reportId}/checks`);
      const data = response.data?.data || response.data;
      const groups = data?.groups || [];

      console.log('[DEBUG ReportDetail] Fetched checks data:', data);

      // 提取未确认的问题路径
      const cellPaths = [];
      const textInfos = [];

      groups.forEach(group => {
        (group.items || []).forEach(item => {
          // 只高亮未确认、未忽略的问题
          if (item.human_status !== 'confirmed' && item.human_status !== 'dismissed' &&
            (item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN')) {
            const paths = item.evidence?.paths || [];
            console.log('[DEBUG ReportDetail] Item:', item.title, 'paths:', paths);
            paths.forEach(p => {
              if (p.includes('tableData') || p.includes('reviewLitigationData')) {
                cellPaths.push(p);
              } else if (p.includes('text') || p.includes('content')) {
                // 提取文本问题信息
                const textValue = item.evidence?.values?.textValue;
                if (textValue) {
                  textInfos.push({ value: textValue, context: item.evidence?.values?.context });
                }
              }
            });
          }
        });
      });

      console.log('[DEBUG ReportDetail] Final cellPaths:', cellPaths);
      console.log('[DEBUG ReportDetail] Final textInfos:', textInfos);
      setHighlightCells(cellPaths);
      setHighlightTexts(textInfos);
    } catch (err) {
      console.error('Failed to fetch highlights:', err);
    }
  };

  // 加载报告时同时获取高亮数据
  useEffect(() => {
    if (reportId) {
      fetchHighlights();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, activeTab]); // activeTab 变化时也刷新

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

  const handleSaveEdit = (newData) => {
    setReport({
      ...report,
      active_version: {
        ...report.active_version,
        parsed_json: newData
      }
    });
    setEditingData(null);
    alert('数据已更新到本地，请刷新页面确认');
  };

  const handleCancelEdit = () => {
    setEditingData(null);
  };

  // 对文本中的问题数字进行高亮
  const highlightTextIssues = (text, highlights) => {
    if (!highlights || highlights.length === 0 || !text) return text;

    let result = text;
    highlights.forEach(({ value }) => {
      if (value !== null && value !== undefined) {
        const numStr = String(value);
        const regex = new RegExp(`(${numStr})`, 'g');
        result = result.replace(regex, '<mark class="text-warning">$1</mark>');
      }
    });

    return <span dangerouslySetInnerHTML={{ __html: result }} />;
  };

  const renderParsedContent = (parsed) => {
    if (!parsed) return <p className="meta">暂无解析内容</p>;

    // 如果是对象且包含sections，则渲染结构化内容
    if (parsed && typeof parsed === 'object' && parsed.sections && Array.isArray(parsed.sections)) {
      return renderStructuredContent(parsed);
    }

    // 否则显示原始JSON
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

  const renderStructuredContent = (parsed) => {
    if (!parsed || !parsed.sections) return null;

    // 对sections进行排序，将标题放在最前面
    const sections = [...parsed.sections];
    sections.sort((a, b) => {
      const isATi = a.title === '标题' || a.title?.includes('年度报告');
      const isBTi = b.title === '标题' || b.title?.includes('年度报告');
      if (isATi && !isBTi) return -1;
      if (!isATi && isBTi) return 1;

      // 按照 一、二、三 等中文数字排序
      const numerals = ['一', '二', '三', '四', '五', '六', '七', '八'];
      const idxA = numerals.findIndex(n => a.title?.includes(n));
      const idxB = numerals.findIndex(n => b.title?.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    const handleEditClick = () => {
      setEditingData({ data: parsed, highlightPaths: [] });
    };

    return (
      <div className="structured-content">
        <div className="content-header">
          <h3>年报内容</h3>
          <div>
            <button className="btn-edit" onClick={handleEditClick} style={{ marginRight: '10px' }}>
              ✏️ 编辑全部
            </button>
            <button className="secondary-btn" onClick={() => setShowParsed((prev) => !prev)}>
              {showParsed ? '折叠内容' : '展开内容'}
            </button>
          </div>
        </div>

        {showParsed && (
          <div className="sections-container">
            {sections.map((section, idx) => (
              <div key={idx} className="section-item">
                <h4 className="section-title">{section.title}</h4>
                <div className="section-content">
                  {section.type === 'text' && (
                    <div className="text-content">{highlightTextIssues(section.content, highlightTexts)}</div>
                  )}
                  {section.type === 'table_2' && section.activeDisclosureData && (
                    <Table2View data={section.activeDisclosureData} />
                  )}
                  {section.type === 'table_3' && section.tableData && (
                    <Table3View data={section.tableData} compact={true} highlightCells={highlightCells} />
                  )}
                  {section.type === 'table_4' && section.reviewLitigationData && (
                    <Table4View data={section.reviewLitigationData} highlightCells={highlightCells} />
                  )}
                  {!['text', 'table_2', 'table_3', 'table_4'].includes(section.type) && (
                    <div className="unknown-type">
                      <p className="meta">未知类型: {section.type}</p>
                      <pre>{JSON.stringify(section, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
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
              ← 返回上一层
            </button>
          </div>
        </div>

        {loading && <p>加载中...</p>}
        {error && <div className="alert error">{error}</div>}

        {!loading && !error && report && (
          <>
            {/* 元数据折叠按钮 */}
            <div className="metadata-toggle">
              <button className="secondary-btn" onClick={() => setShowMetadata(!showMetadata)}>
                {showMetadata ? '隐藏技术信息' : '显示技术信息（报告信息、任务、版本等）'}
              </button>
            </div>

            {/* 可折叠的元数据部分 */}
            {showMetadata && (
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
              </>
            )}

            {/* Tab 切换 */}
            <div className="tabs-container">
              <div className="tabs">
                <button
                  className={`tab ${activeTab === 'content' ? 'active' : ''}`}
                  onClick={() => setActiveTab('content')}
                >
                  📄 年报内容
                </button>
                <button
                  className={`tab ${activeTab === 'checks' ? 'active' : ''}`}
                  onClick={() => setActiveTab('checks')}
                >
                  ✅ 勾稽关系校验
                </button>
              </div>
            </div>

            {/* Tab 内容 */}
            {activeTab === 'content' && (
              <section className="section">
                <div className="report-title-banner">
                  <h2>{report?.year || ''}年{report?.region_name || report?.region?.name || ''}政务公开年报</h2>
                </div>
                {renderParsedContent(report.active_version?.parsed_json)}
              </section>
            )}

            {activeTab === 'checks' && (
              <section className="section">
                <h3>一致性校验</h3>
                <ConsistencyCheckView
                  reportId={reportId}
                  onEdit={(paths) => {
                    console.log('ReportDetail onEdit called, parsed_json:', report.active_version?.parsed_json);
                    const editData = {
                      data: report.active_version?.parsed_json,
                      highlightPaths: paths || []
                    };
                    console.log('Setting editingData:', editData);
                    setEditingData(editData);
                  }}
                />
              </section>
            )}
          </>
        )}
      </div>

      {/* 编辑器覆盖层 - 放在最外层以确保任何标签页下都能显示 */}
      {editingData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1000,
          overflow: 'auto',
          padding: '20px'
        }}>
          <div style={{
            maxWidth: '1400px',
            margin: '0 auto',
            background: 'white',
            borderRadius: '8px',
            padding: '0'
          }}>
            <ParsedDataEditor
              reportId={reportId}
              versionId={report.active_version?.version_id}
              parsedJson={editingData.data || editingData}
              highlightPaths={editingData.highlightPaths}
              onSave={handleSaveEdit}
              onCancel={handleCancelEdit}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ReportDetail;
