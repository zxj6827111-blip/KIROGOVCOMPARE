
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import './ComparisonDetailView.css';
import { apiClient } from '../apiClient';
import { ArrowLeft, Wand2 } from 'lucide-react';
import { Table2View, Table3View, Table4View, SimpleDiffTable } from './TableViews';
import DiffText from './DiffText';
import CrossYearCheckView from './CrossYearCheckView';
import { normalizeTablePath } from '../utils/tableRowColMapping';
import { useToast } from './common/ToastProvider';
import { useTaskDrawer } from './tasks/TaskDrawerProvider';
import ExportPanel from './ExportPanel';
import PageHeader from './common/PageHeader';
import StatusBadge from './common/StatusBadge';
import { getAxiosFriendlyError } from '../utils/errorTranslator';
import { buildComparisonEvidenceSummary } from '../utils/evidenceViewModel';
import { resolveSafeReturnTo } from '../app/returnTo';
import { buildComparisonFindingItems } from '../utils/comparisonFindings';
import { alignComparisonSections } from '../utils/comparisonSectionAlignment';

const isTableHighlightPath = (path) =>
  path &&
  (path.startsWith('tableData.') ||
    path.startsWith('activeDisclosureData.') ||
    path.startsWith('reviewLitigationData.'));

const buildIssueHighlightCells = (issues = []) => {
  const cells = [];
  const seen = new Set();

  const addPath = (rawPath, type) => {
    const path = normalizeTablePath(rawPath);
    if (!isTableHighlightPath(path)) return;
    const key = `${type}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ path, type, scope: 'focus' });
  };

  issues
    .filter((item) =>
      ['FAIL', 'UNCERTAIN'].includes(item?.auto_status || item?.autoStatus) &&
      item?.human_status !== 'dismissed'
    )
    .forEach((item) => {
      const evidence = item.evidence || {};
      const leftPaths = evidence.leftPaths || [];
      const rightPaths = evidence.rightPaths || [];
      const fallbackPaths = evidence.paths || [];

      leftPaths.forEach((path) => addPath(path, 'left'));
      rightPaths.forEach((path) => addPath(path, 'right'));

      if (leftPaths.length === 0 && rightPaths.length === 0) {
        fallbackPaths.forEach((path) => addPath(path, 'diff'));
      }
    });

  return cells;
};

const getTextSectionMetrics = (data) => {
  const metrics = data?.section_metrics?.text;
  return Array.isArray(metrics) ? metrics : [];
};

// Helper for Table 3 Rows (Ported)
const getTable3Rows = (data) => {
  if (!data || !data.total || !data.total.results) return [];
  const t = data.total;
  const r = t.results;
  return [
    { label: '本年新收政府信息公开申请数量', val: t.newReceived },
    { label: '上年结转政府信息公开申请数量', val: t.carriedOver },
    { label: '予以公开', val: r.granted },
    { label: '部分公开', val: r.partialGrant },
    { label: '不予公开-属于国家秘密', val: r.denied.stateSecret },
    { label: '不予公开-其他法律行政法规禁止公开', val: r.denied.lawForbidden },
    { label: '不予公开-危及“三安全一稳定”', val: r.denied.safetyStability },
    { label: '不予公开-保护第三方合法权益', val: r.denied.thirdPartyRights },
    { label: '不予公开-属于三类内部事务信息', val: r.denied.internalAffairs },
    { label: '不予公开-属于四类过程性信息', val: r.denied.processInfo },
    { label: '不予公开-属于行政执法案卷', val: r.denied.enforcementCase },
    { label: '不予公开-属于行政查询事项', val: r.denied.adminQuery },
    { label: '无法提供-本机关不掌握相关政府信息', val: r.unableToProvide.noInfo },
    { label: '无法提供-没有现成信息需要另行制作', val: r.unableToProvide.needCreation },
    { label: '无法提供-补正后申请内容仍不明确', val: r.unableToProvide.unclear },
    { label: '不予处理-信访举报投诉类申请', val: r.notProcessed.complaint },
    { label: '不予处理-重复申请', val: r.notProcessed.repeat },
    { label: '不予处理-要求提供公开出版物', val: r.notProcessed.publication },
    { label: '不予处理-无正当理由大量反复申请', val: r.notProcessed.massiveRequests },
    { label: '不予处理-要求行政机关确认或重新出具', val: r.notProcessed.confirmInfo },
    { label: '其他处理-申请人无正当理由逾期不补正...', val: r.other.overdueCorrection },
    { label: '其他处理-申请人逾期未按收费通知...', val: r.other.overdueFee },
    { label: '其他处理-其他', val: r.other.otherReasons },
    { label: '总计', val: r.totalProcessed },
    { label: '结转下年度继续办理', val: r.carriedForward },
  ];
};

const ComparisonDetailView = ({ comparisonId, onBack, autoPrint = false }) => {
  const toast = useToast();
  const taskDrawer = useTaskDrawer();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [leftIssueHighlightCells, setLeftIssueHighlightCells] = useState([]);
  const [alignmentPanelOpen, setAlignmentPanelOpen] = useState(false);
  const [alignmentSuggestions, setAlignmentSuggestions] = useState([]);
  const [selectedAlignmentIds, setSelectedAlignmentIds] = useState([]);
  const [alignmentLoading, setAlignmentLoading] = useState(false);
  const [alignmentSaving, setAlignmentSaving] = useState(false);
  const handleBack = useCallback(() => {
    if (onBack) return onBack();
    window.location.href = resolveSafeReturnTo(window.location.search, '/history');
  }, [onBack]);
  // Auto-print effect
  useEffect(() => {
    if (autoPrint && data && !loading && !error) {
      // Wait a brief moment for DOM info (DiffText) to paint
      const timer = setTimeout(() => {
        window.print();
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [autoPrint, data, loading, error]);

  // Highlight States
  const [highlightIdentical, setHighlightIdentical] = useState(true);
  const [highlightDiff, setHighlightDiff] = useState(false);

  const handleLeftIssuesChange = useCallback((issues) => {
    setLeftIssueHighlightCells(buildIssueHighlightCells(issues));
  }, []);

  // Fetch Data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get(`/comparisons/${comparisonId}/result`);
      const comparisonData = resp.data;
      setData(comparisonData);

    } catch (err) {
      setError(err.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [comparisonId]);



  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Document Title
  useEffect(() => {
    if (data) {
      const originalTitle = document.title;
      document.title = `比对报告_${data.region_name}_${data.year_a}-${data.year_b}`;
      return () => { document.title = originalTitle; };
    }
  }, [data]);

  // Aligned Sections Calculation (Ported Logic)
  const { alignedSections, summary, textSectionMetrics, findingItems } = useMemo(() => {
    if (!data) return { alignedSections: [], summary: {}, textSectionMetrics: [], findingItems: [] };

    const leftSections = data.left_content?.sections || [];
    const rightSections = data.right_content?.sections || [];
    const sections = alignComparisonSections(leftSections, rightSections, data.alignment_rules || []);
    const summaryItems = data.diff_json?.summary?.items || [];
    const textRepetition = data.similarity ?? data.diff_json?.summary?.textRepetition ?? null;

    const textSectionMetrics = getTextSectionMetrics(data);
    const findingItems = buildComparisonFindingItems({
      summaryItems,
      textSectionMetrics,
    });

    return {
      alignedSections: sections,
      summary: {
        ...(data.diff_json?.summary || {}),
        textRepetition,
        items: summaryItems,
      },
      textSectionMetrics,
      findingItems,
    };
  }, [data]);

  const renderSectionDiff = (row) => {
    const renderWithEvidenceNote = (node, sectionType) => {
      const evidence = buildComparisonEvidenceSummary({
        sectionType,
        yearA: data.year_a,
        yearB: data.year_b,
      });

      return (
        <>
          {node}
          <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            <strong className="mr-1 text-slate-700">差异来源说明：</strong>
            {evidence.summary}
            <span className="ml-2 text-slate-500">{evidence.fieldPath}</span>
          </div>
        </>
      );
    };

    // 1. Active Disclosure Diff (Table 2)
    if (row.newSec?.type === 'table_2' && row.newSec.activeDisclosureData && row.oldSec?.activeDisclosureData) {
      const dA = row.oldSec.activeDisclosureData;
      const dB = row.newSec.activeDisclosureData;
      return renderWithEvidenceNote((
        <SimpleDiffTable
          title="主动公开数据差异"
          headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
          rows={[
            { label: '规章-制发', valA: dA.regulations?.made, valB: dB.regulations?.made },
            { label: '规范性文件-制发', valA: dA.normativeDocuments?.made, valB: dB.normativeDocuments?.made },
            { label: '行政许可-处理', valA: dA.licensing?.processed, valB: dB.licensing?.processed },
            { label: '行政处罚-处理', valA: dA.punishment?.processed, valB: dB.punishment?.processed },
            { label: '行政事业性收费(万元)', valA: dA.fees?.amount, valB: dB.fees?.amount },
          ]}
        />
      ), 'table_2');
    }

    // 2. Review Litigation Diff (Table 4)
    if (row.newSec?.type === 'table_4' && row.newSec.reviewLitigationData && row.oldSec?.reviewLitigationData) {
      const dA = row.oldSec.reviewLitigationData;
      const dB = row.newSec.reviewLitigationData;
      return renderWithEvidenceNote((
        <SimpleDiffTable
          title="复议诉讼数据差异"
          headers={["类型", `${data.year_a}总计`, `${data.year_b}总计`]}
          rows={[
            { label: '行政复议', valA: dA.review?.total, valB: dB.review?.total },
            { label: '行政诉讼(直接)', valA: dA.litigationDirect?.total, valB: dB.litigationDirect?.total },
            { label: '行政诉讼(复议后)', valA: dA.litigationPostReview?.total, valB: dB.litigationPostReview?.total },
          ]}
        />
      ), 'table_4');
    }

    // 3. Table 3 Diff
    if (row.newSec?.type === 'table_3' && row.newSec.tableData && row.oldSec?.tableData) {
      const rowsA = getTable3Rows(row.oldSec.tableData);
      const rowsB = getTable3Rows(row.newSec.tableData);
      const diffRows = rowsA.map((r, i) => ({
        label: r.label,
        valA: r.val,
        valB: rowsB[i] ? rowsB[i].val : 0
      }));
      return renderWithEvidenceNote((
        <SimpleDiffTable
          title="依申请公开情况 - 详细指标差异分析"
          headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
          rows={diffRows}
        />
      ), 'table_3');
    }

    return null;
  };

  // PDF Download States
  const [downloading, setDownloading] = useState(false);
  const [downloadStage, setDownloadStage] = useState('');

  const handleDownloadPDF = async () => {
    setDownloading(true);
    setDownloadStage('创建任务...');

    try {
      // Create async PDF export job instead of synchronous download
      const title = `${data.region_name} ${data.year_a}-${data.year_b} 年报对比`;
      const response = await apiClient.post('/pdf-jobs', {
        comparison_id: comparisonId,
        title: title
      });

      if (response.data?.success) {
        taskDrawer.trackPdfJob({
          job_id: response.data.job_id,
          comparison_id: comparisonId,
          status: 'queued',
          progress: 0,
          export_title: response.data.export_title || title,
          file_name: response.data.file_name,
          file_exists: false,
        });
        taskDrawer.openDrawer();
        setDownloadStage('任务已创建!');

        // Brief delay to show success status
        await new Promise(resolve => setTimeout(resolve, 500));

        toast.success('PDF 导出任务已创建', `${response.data.export_title || title} 已加入任务中心。`, {
          actionLabel: '查看导出任务',
          onAction: () => { window.location.href = '/jobs?tab=download'; },
          duration: 8000,
        });
      }
    } catch (error) {
      console.error('Create PDF job failed:', error);
      const friendly = getAxiosFriendlyError(error, '创建任务失败，请稍后重试。');
      toast.error('创建 PDF 导出任务失败', friendly.message, { detail: friendly.detail });
    } finally {
      setDownloading(false);
      setDownloadStage('');
    }
  };

  const handlePrint = () => {
    const params = new URLSearchParams({
      autoPrint: 'true',
      highlightIdentical: String(highlightIdentical),
      highlightDiff: String(highlightDiff),
    });
    window.open(`/print/comparison/${comparisonId}?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const handleLoadAlignmentSuggestions = async () => {
    setAlignmentLoading(true);
    try {
      const resp = await apiClient.get(`/comparisons/${comparisonId}/alignment-suggestions`);
      const suggestions = resp.data?.suggestions || [];
      setAlignmentSuggestions(suggestions);
      setSelectedAlignmentIds(suggestions.map((item) => item.id));
      setAlignmentPanelOpen(true);
      if (suggestions.length === 0) {
        toast.info('暂无可智能对齐的章节', '当前未发现高置信度的左右空缺章节候选。');
      } else {
        toast.success('已生成智能对齐建议', `发现 ${suggestions.length} 条候选，请确认后保存。`);
      }
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '生成智能对齐建议失败，请稍后重试。');
      toast.error('智能对齐失败', friendly.message, { detail: friendly.detail });
    } finally {
      setAlignmentLoading(false);
    }
  };

  const toggleAlignmentSuggestion = (id) => {
    setSelectedAlignmentIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  };

  const handleSaveAlignmentRules = async () => {
    const selected = alignmentSuggestions.filter((item) => selectedAlignmentIds.includes(item.id));
    if (selected.length === 0) {
      toast.warning('未选择对齐规则', '请至少选择一条建议后再保存。');
      return;
    }

    setAlignmentSaving(true);
    try {
      const resp = await apiClient.post(`/comparisons/${comparisonId}/alignment-rules`, { suggestions: selected });
      await fetchData();
      setAlignmentPanelOpen(false);
      toast.success('智能对齐规则已保存', `已保存 ${resp.data?.saved_count ?? selected.length} 条规则，详情页已重新加载。`);
    } catch (error) {
      const friendly = getAxiosFriendlyError(error, '保存智能对齐规则失败，请稍后重试。');
      toast.error('保存失败', friendly.message, { detail: friendly.detail });
    } finally {
      setAlignmentSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!data) return <div className="p-8 text-center">无数据</div>;

  return (
    <div className="space-y-4 pb-20 comparison-container bg-gray-50 min-h-screen p-4">
      {/* Back Button */}
      <div className="back-nav mb-4 no-print block">
        <button onClick={handleBack} className="flex items-center text-blue-600 hover:text-blue-800">
          <ArrowLeft size={18} className="mr-1" /> 返回列表
        </button>
      </div>

      <div id="comparison-content" className="max-w-[1600px] mx-auto">
        <PageHeader
          title={`${data.region_name || '未知地区'} 年报比对`}
          subtitle={`${data.year_a} vs ${data.year_b}`}
          badges={(
            <>
              <StatusBadge tone={data.check_status && data.check_status !== '正常' ? 'warning' : 'success'}>
                {data.check_status || '已比对'}
              </StatusBadge>
              {data.similarity != null && <StatusBadge tone="info">正文文字重复率 {data.similarity}%</StatusBadge>}
            </>
          )}
          actions={(
            <ExportPanel
              compact
              disabled={downloading}
              exportLabel="生成 PDF"
              isCreating={downloading}
              onCreatePdfJob={handleDownloadPDF}
              onOpenJobs={() => { window.location.href = '/jobs?tab=download'; }}
              onPrintPreview={handlePrint}
            />
          )}
        />

        {/* Summary Card */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8 shadow-sm break-inside-avoid">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 font-serif-sc">
            {data.region_name} 政务公开年报比对
          </h2>
          <div className="flex space-x-8 text-sm text-gray-700 mb-4 font-mono">
            <div>
              <span className="text-gray-500">年份:</span> <span className="font-bold">{data.year_a} vs {data.year_b}</span>
            </div>
            <div>
              <span className="text-gray-500">正文文字重复率:</span>
              <span className="font-bold ml-1">{summary.textRepetition ?? '-'}%</span>
            </div>
          </div>
          <p className="comparison-repetition-note">
            该指标来自后端比对结果，仅统计正文 text 章节；黄底只标记两版中的相同文本片段，不等同于总重复率。
          </p>

          {textSectionMetrics.length > 0 && (
            <div className="comparison-section-metrics" aria-label="正文章节重复率明细">
              <div className="comparison-section-metrics__header">
                <h3>正文章节重复率明细</h3>
                <span>顶部数值为下列正文 text 章节的简单平均</span>
              </div>
              <div className="comparison-section-metrics__grid">
                {textSectionMetrics.map((metric, idx) => (
                  <div className="comparison-section-metric" key={`${metric.title || 'section'}-${idx}`}>
                    <span className="comparison-section-metric__title">{metric.title || `正文 ${idx + 1}`}</span>
                    <strong>{metric.similarity ?? '-'}%</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-bold text-gray-900 mb-2">发现问题</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 font-serif-sc">
              {findingItems.map((item, idx) => <li key={idx}>{item}</li>)}
            </ul>
          </div>
        </div>

        {/* View Settings Controls */}
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 flex flex-wrap justify-between items-center mb-6 no-print">
          <div className="flex flex-wrap gap-6 items-center">
            <div className="font-bold text-gray-700 flex items-center">
              高亮设置
            </div>
            <label className="flex items-center space-x-2 cursor-pointer select-none hover:bg-gray-50 px-2 py-1 rounded">
              <input
                type="checkbox"
                checked={highlightIdentical}
                onChange={e => setHighlightIdentical(e.target.checked)}
                className="w-4 h-4 text-yellow-500 border-gray-300 rounded focus:ring-yellow-500"
              />
              <span className="text-sm text-gray-700">相同部分 (黄色)</span>
              <span className="inline-block w-4 h-4 bg-yellow-200 border border-yellow-300 ml-1 rounded-sm"></span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer select-none hover:bg-gray-50 px-2 py-1 rounded">
              <input
                type="checkbox"
                checked={highlightDiff}
                onChange={e => setHighlightDiff(e.target.checked)}
                className="w-4 h-4 text-red-500 border-gray-300 rounded focus:ring-red-500"
              />
              <span className="text-sm text-gray-700">差异部分 (红色)</span>
              <span className="inline-block w-4 h-4 bg-red-200 border border-red-300 ml-1 rounded-sm"></span>
            </label>
          </div>
          <div className="comparison-highlight-note">
            黄底表示相同文本片段；正文文字重复率以顶部指标为准。
          </div>

        </div>

        <div className="bg-white p-4 rounded-lg shadow-sm border border-blue-100 mb-6 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-bold text-gray-800">章节智能对齐</div>
              <div className="text-sm text-gray-500 mt-1">
                用于处理标题写法不同导致的左右空缺；保存后会自动用于详情页、打印页和重复率明细。
              </div>
            </div>
            <button
              type="button"
              onClick={handleLoadAlignmentSuggestions}
              disabled={alignmentLoading || alignmentSaving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Wand2 size={16} />
              {alignmentLoading ? '扫描中...' : '智能对齐'}
            </button>
          </div>

          {alignmentPanelOpen && (
            <div className="mt-4 border border-blue-100 rounded-lg bg-blue-50/40 p-3">
              {alignmentSuggestions.length === 0 ? (
                <div className="text-sm text-gray-600">没有发现高置信度候选。若页面仍有错位，通常需要检查解析结果或手动补充规则。</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="text-sm text-gray-700">
                      发现 {alignmentSuggestions.length} 条候选，默认全选。请确认左右标题确实属于同一章节后保存。
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setSelectedAlignmentIds(alignmentSuggestions.map((item) => item.id))}
                      >
                        全选
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setSelectedAlignmentIds([])}
                      >
                        清空
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {alignmentSuggestions.map((item) => (
                      <label
                        key={item.id}
                        className="block cursor-pointer rounded-md border border-gray-200 bg-white p-3 hover:border-blue-300"
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedAlignmentIds.includes(item.id)}
                            onChange={() => toggleAlignmentSuggestion(item.id)}
                            className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap gap-2 text-xs text-gray-500 mb-2">
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-700">{item.sectionType}</span>
                              <span>置信度 {item.confidence}%</span>
                              <span>{item.reason}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-800">
                              <div className="rounded border border-gray-100 bg-gray-50 p-2">
                                <span className="text-gray-500 mr-1">{data.year_a}：</span>{item.leftTitle}
                                <span className="ml-2 text-xs text-gray-400">{item.leftContentLength} 字</span>
                              </div>
                              <div className="rounded border border-gray-100 bg-gray-50 p-2">
                                <span className="text-gray-500 mr-1">{data.year_b}：</span>{item.rightTitle}
                                <span className="ml-2 text-xs text-gray-400">{item.rightContentLength} 字</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex justify-end gap-2 mt-4">
                    <button
                      type="button"
                      className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm text-gray-700 hover:bg-gray-50"
                      onClick={() => setAlignmentPanelOpen(false)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAlignmentRules}
                      disabled={alignmentSaving || selectedAlignmentIds.length === 0}
                      className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {alignmentSaving ? '保存中...' : `保存 ${selectedAlignmentIds.length} 条规则`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Header Row */}
        <div className="comparison-grid sticky-header grid grid-cols-2 gap-4 sticky top-0 z-30 bg-gray-100 pt-4 pb-2 border-b border-gray-300 break-inside-avoid shadow-sm">
          <div className="text-center font-bold text-lg text-gray-700 bg-white p-2 shadow-sm border-l-4 border-gray-400">
            {data.year_a} 年度 (旧)
          </div>
          <div className="text-center font-bold text-lg text-blue-900 bg-white p-2 shadow-sm border-l-4 border-blue-500">
            {data.year_b} 年度 (新)
          </div>
        </div>

        {alignedSections.map((row, idx) => {
          const isWideTable = row.oldSec?.type === 'table_4';
          const isTable3 = row.oldSec?.type === 'table_3' || row.newSec?.type === 'table_3';

          return (
            <div key={idx} className="bg-white rounded-lg shadow-sm p-1 mb-2">
              {/* Section Title */}
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 mb-2">
                <h3 className="text-lg font-bold font-serif-sc text-gray-800">{row.title}</h3>
              </div>

              {/* Content Container: Switch between Grid and Stack */}
              <div className={`comparison-grid comparison-grid--balanced ${isTable3 ? 'comparison-grid--table3' : ''} grid ${isWideTable ? 'grid-cols-1' : 'grid-cols-2'} gap-3 px-2`}>
                {/* Left Column (Old Year) */}
                <div className={`comparison-pane comparison-pane--old ${isWideTable ? 'comparison-pane--stacked' : ''}`}>
                  {isWideTable && <div className="text-center font-bold text-gray-700 mb-2 bg-gray-50 p-1 rounded">{data.year_a} 年度 (旧)</div>}

                  {row.oldSec ? (
                    <>
                      {row.oldSec.type === 'text' && (
                        <DiffText
                          oldText={row.newSec?.content || ''}
                          newText={row.oldSec.content || ''}
                          highlightIdentical={highlightIdentical}
                          highlightDiff={highlightDiff}
                        />
                      )}
                      {/* Compact tables for view */}
                      {row.oldSec.type === 'table_2' && row.oldSec.activeDisclosureData && <Table2View data={row.oldSec.activeDisclosureData} compact={true} highlightCells={leftIssueHighlightCells} />}
                      {row.oldSec.type === 'table_3' && row.oldSec.tableData && <Table3View data={row.oldSec.tableData} compact={true} highlightCells={leftIssueHighlightCells} />}
                      {row.oldSec.type === 'table_4' && row.oldSec.reviewLitigationData && <Table4View data={row.oldSec.reviewLitigationData} highlightCells={leftIssueHighlightCells} />}
                    </>
                  ) : <span className="text-gray-400 italic">无内容</span>}
                </div>

                {/* Right Column (New Year) */}
                <div className={`comparison-pane comparison-pane--new ${isWideTable ? 'comparison-pane--stacked' : ''}`}>
                  {isWideTable && <div className="text-center font-bold text-blue-900 mb-2 bg-blue-50 p-1 rounded">{data.year_b} 年度 (新)</div>}

                  {row.newSec ? (
                    <>
                      {row.newSec.type === 'text' && (
                        <DiffText
                          oldText={row.oldSec?.content || ''}
                          newText={row.newSec.content || ''}
                          highlightIdentical={highlightIdentical}
                          highlightDiff={highlightDiff}
                        />
                      )}
                      {row.newSec.type === 'table_2' && row.newSec.activeDisclosureData && <Table2View data={row.newSec.activeDisclosureData} compact={true} />}
                      {row.newSec.type === 'table_3' && row.newSec.tableData && <Table3View data={row.newSec.tableData} compact={true} />}
                      {row.newSec.type === 'table_4' && row.newSec.reviewLitigationData && <Table4View data={row.newSec.reviewLitigationData} />}
                    </>
                  ) : <span className="text-gray-400 italic">无内容</span>}
                </div>
              </div>

              {/* Bottom Diff Table */}
              <div className="px-2 pb-2">
                {renderSectionDiff(row) || <div className="text-xs text-gray-300 px-4 py-2 opacity-50">无数据差异 ({row.newSec?.type})</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* 数据勾稽问题清单 */}
      <CrossYearCheckView
        leftReportId={data.left_report_id}
        rightReportId={data.right_report_id}
        leftContent={data.left_content}
        rightContent={data.right_content}
        yearA={data.year_a}
        yearB={data.year_b}
        onLeftIssuesChange={handleLeftIssuesChange}
      />
    </div>
  );
}

export default ComparisonDetailView;
