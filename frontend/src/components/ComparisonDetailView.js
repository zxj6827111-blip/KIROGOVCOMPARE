
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import './ComparisonDetailView.css';
import { apiClient } from '../apiClient';
import { ArrowLeft, Printer, Download, Loader2 } from 'lucide-react';
import { Table2View, Table3View, Table4View, SimpleDiffTable } from './TableViews';
import DiffText from './DiffText';
import CrossYearCheckView from './CrossYearCheckView';

// ---- Tokenization & Similarity Algorithm (Ported) ----
const tokenizeText = (text) => {
  if (!text) return [];
  const regex = /(\d+)|([a-zA-Z]+)|([\u4e00-\u9fff]+)|([\s\S])/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
};

const isPunctuation = (str) => {
  return /[-，。、；：？！“”‘’（）《》【】—….,;:?!'"()\[\]\s]/.test(str);
};

function calculateTextSimilarity(text1, text2) {
  if (!text1 && !text2) return 100;
  if (!text1 || !text2) return 0;

  const t1 = tokenizeText(text1).filter(t => !isPunctuation(t));
  const t2 = tokenizeText(text2).filter(t => !isPunctuation(t));

  if (t1.length === 0 && t2.length === 0) return 100;
  if (t1.length === 0 || t2.length === 0) return 0;

  // Simple intersection for speed in JS if Diff isn't fully available or too slow
  // But preferably use Diff.diffArrays if available
  // Fallback to simple set intersection if Diff lib heavy
  const set2 = new Set(t2);
  let intersection = 0;
  t1.forEach(t => { if (set2.has(t)) intersection++; });
  const union = t1.length + t2.length;
  return Math.round((2 * intersection / union) * 100);
}

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
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
  const { alignedSections, summary } = useMemo(() => {
    if (!data) return { alignedSections: [], summary: {} };

    const sections = [];

    // Process Left (Old)
    const leftSections = data.left_content?.sections || [];
    leftSections.forEach(s => sections.push({ title: s.title, oldSec: s }));

    // Process Right (New)
    const rightSections = data.right_content?.sections || [];
    rightSections.forEach(s => {
      const existing = sections.find(a => a.title === s.title);
      if (existing) existing.newSec = s;
      else sections.push({ title: s.title, newSec: s });
    });

    // Sort Logic
    const numerals = ['一', '二', '三', '四', '五', '六', '七', '八'];
    sections.sort((a, b) => {
      const isTitleA = a.title === '标题' || a.title?.includes('年度报告');
      const isTitleB = b.title === '标题' || b.title?.includes('年度报告');
      if (isTitleA && !isTitleB) return -1;
      if (!isTitleA && isTitleB) return 1;
      const idxA = numerals.findIndex(n => a.title?.includes(n));
      const idxB = numerals.findIndex(n => b.title?.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    // Calculate Summary Stats (Locally)
    let totalTextSim = 0;
    let textSectionsCount = 0;
    let totalTableSim = 0;
    let tableSectionsCount = 0;
    const summaryItems = [];

    sections.forEach(sec => {
      // Skip title section from statistics
      if (sec.title === '标题' || sec.title?.includes('年度报告')) return;

      // Text Comparison
      if (sec.oldSec?.type === 'text' && sec.newSec?.type === 'text') {
        const sim = calculateTextSimilarity(sec.oldSec.content || '', sec.newSec.content || '');
        totalTextSim += sim;
        textSectionsCount++;

        if (sim < 60) {
          summaryItems.push(`${sec.title.split('、')[1] || sec.title}章节的文字变化较大，重复率约 ${Math.round(sim)}% （低于 60% 阈值）`);
        }
      }
      // Table Comparison
      else if (['table_2', 'table_3', 'table_4'].includes(sec.newSec?.type || '')) {
        let identical = false;
        // Simple data presence check for diffs
        if (sec.newSec?.type === 'table_2') identical = JSON.stringify(sec.oldSec?.activeDisclosureData) === JSON.stringify(sec.newSec?.activeDisclosureData);
        else if (sec.newSec?.type === 'table_3') identical = JSON.stringify(sec.oldSec?.tableData) === JSON.stringify(sec.newSec?.tableData);
        else if (sec.newSec?.type === 'table_4') identical = JSON.stringify(sec.oldSec?.reviewLitigationData) === JSON.stringify(sec.newSec?.reviewLitigationData);

        if (identical) {
          totalTableSim += 100;
          tableSectionsCount++;
        } else {
          summaryItems.push(`${sec.title.split('、')[1] || sec.title}的表格重复率约 0%，存在明显数据差异`);
        }
      }
    });

    const avgTextRep = (data.similarity != null) ? data.similarity : (textSectionsCount > 0 ? Math.round(totalTextSim / textSectionsCount) : 0);
    const avgTableRep = tableSectionsCount > 0 ? Math.round(totalTableSim / tableSectionsCount) : 0;
    const overallRep = Math.round((avgTextRep + avgTableRep) / 2);

    return {
      alignedSections: sections,
      summary: (data.diff_json?.summary && data.diff_json.summary.items && data.diff_json.summary.items.length > 0)
        ? data.diff_json.summary
        : {
          textRepetition: avgTextRep,
          tableRepetition: avgTableRep,
          overallRepetition: overallRep,
          items: summaryItems
        }
    };
  }, [data]);

  const renderSectionDiff = (row) => {
    // 1. Active Disclosure Diff (Table 2)
    if (row.newSec?.type === 'table_2' && row.newSec.activeDisclosureData && row.oldSec?.activeDisclosureData) {
      const dA = row.oldSec.activeDisclosureData;
      const dB = row.newSec.activeDisclosureData;
      return (
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
      );
    }

    // 2. Review Litigation Diff (Table 4)
    if (row.newSec?.type === 'table_4' && row.newSec.reviewLitigationData && row.oldSec?.reviewLitigationData) {
      const dA = row.oldSec.reviewLitigationData;
      const dB = row.newSec.reviewLitigationData;
      return (
        <SimpleDiffTable
          title="复议诉讼数据差异"
          headers={["类型", `${data.year_a}总计`, `${data.year_b}总计`]}
          rows={[
            { label: '行政复议', valA: dA.review?.total, valB: dB.review?.total },
            { label: '行政诉讼(直接)', valA: dA.litigationDirect?.total, valB: dB.litigationDirect?.total },
            { label: '行政诉讼(复议后)', valA: dA.litigationPostReview?.total, valB: dB.litigationPostReview?.total },
          ]}
        />
      );
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
      return (
        <SimpleDiffTable
          title="依申请公开情况 - 详细指标差异分析"
          headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
          rows={diffRows}
        />
      );
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
        setDownloadStage('任务已创建!');

        // Brief delay to show success status
        await new Promise(resolve => setTimeout(resolve, 500));

        // Show success message with option to go to Job Center
        const goToJobCenter = window.confirm(
          `PDF 导出任务已创建！\n\n任务名称：${response.data.export_title}\n\n点击"确定"前往任务中心查看进度，或点击"取消"继续浏览。`
        );
        if (goToJobCenter) {
          window.location.href = '/jobs?tab=download';
        }
      }
    } catch (error) {
      console.error('Create PDF job failed:', error);
      const message = error.response?.data?.message || error.message || '创建任务失败';
      alert('创建 PDF 导出任务失败：' + message);
    } finally {
      setDownloading(false);
      setDownloadStage('');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!data) return <div className="p-8 text-center">无数据</div>;

  return (
    <div className="space-y-4 pb-20 comparison-container bg-gray-50 min-h-screen p-4">
      {/* Back Button */}
      <div className="back-nav mb-4 no-print block">
        <button onClick={onBack} className="flex items-center text-blue-600 hover:text-blue-800">
          <ArrowLeft size={18} className="mr-1" /> 返回列表
        </button>
      </div>

      <div id="comparison-content" className="max-w-[1600px] mx-auto">
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
              <span className="text-gray-500">文字重复率:</span>
              <span className="font-bold ml-1">{summary.textRepetition ?? '-'}%</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded p-4">
            <h3 className="font-bold text-gray-900 mb-2">发现问题</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 font-serif-sc">
              {summary.items && summary.items.length > 0 ? (
                summary.items.map((item, idx) => <li key={idx}>{item}</li>)
              ) : (
                <li>未检测到显著差异。</li>
              )}
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

          <div className="flex gap-3">
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex items-center px-4 py-2 text-white rounded-md shadow-sm transition-colors bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  {downloadStage}
                </>
              ) : (
                <>
                  <Download size={16} className="mr-2" /> 下载PDF
                </>
              )}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center px-4 py-2 text-white rounded-md shadow-sm transition-colors bg-gray-600 hover:bg-gray-700"
            >
              <Printer size={16} className="mr-2" /> 网页打印
            </button>
          </div>
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

        {alignedSections.map((row, idx) => (
          <div key={idx} className="bg-white rounded-lg shadow-sm p-1 mb-2">
            {/* Section Title */}
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 mb-2">
              <h3 className="text-lg font-bold font-serif-sc text-gray-800">{row.title}</h3>
            </div>

            {/* Side by Side Content */}
            <div className="comparison-grid grid grid-cols-2 gap-2 px-2">
              {/* Left Column */}
              <div className="border-r border-dashed border-gray-300 pr-2">
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
                    {row.oldSec.type === 'table_2' && row.oldSec.activeDisclosureData && <Table2View data={row.oldSec.activeDisclosureData} />}
                    {row.oldSec.type === 'table_3' && row.oldSec.tableData && <Table3View data={row.oldSec.tableData} compact={true} />}
                    {row.oldSec.type === 'table_4' && row.oldSec.reviewLitigationData && <Table4View data={row.oldSec.reviewLitigationData} />}
                  </>
                ) : <span className="text-gray-400 italic">无内容</span>}
              </div>

              {/* Right Column */}
              <div className="pl-2">
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

                    {/* Compact tables for view */}
                    {row.newSec.type === 'table_2' && row.newSec.activeDisclosureData && <Table2View data={row.newSec.activeDisclosureData} />}
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
        ))}
      </div>

      {/* 数据勾稽问题清单 */}
      <CrossYearCheckView
        leftReportId={data.left_report_id}
        rightReportId={data.right_report_id}
        leftContent={data.left_content}
        rightContent={data.right_content}
        yearA={data.year_a}
        yearB={data.year_b}
      />
    </div>
  );
}

export default ComparisonDetailView;
