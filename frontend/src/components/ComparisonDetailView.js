import React, { useEffect, useState, useCallback } from 'react';
import './ComparisonDetailView.css';
import { apiClient } from '../apiClient';
import { Table2View, Table3View, Table4View, SimpleDiffTable } from './TableViews';
import DiffText from './DiffText';

/**
 * ComparisonDetailView - Shows comparison results like the frontend
 * Includes summary, repetition rates, and side-by-side content
 */
function ComparisonDetailView({ comparisonId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [highlightIdentical, setHighlightIdentical] = useState(false);
  const [highlightDiff, setHighlightDiff] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await apiClient.get(`/comparisons/${comparisonId}/result`);
      setData(resp.data);
    } catch (err) {
      setError(err.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [comparisonId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Calculate simple similarity for display
  const calculateSimilarity = (text1, text2) => {
    if (!text1 || !text2) return 0;
    const str1 = typeof text1 === 'string' ? text1 : JSON.stringify(text1);
    const str2 = typeof text2 === 'string' ? text2 : JSON.stringify(text2);

    const words1 = str1.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('');
    const words2 = str2.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('');

    if (words1.length === 0 || words2.length === 0) return 0;

    const set1 = new Set(words1);
    const set2 = new Set(words2);
    const intersection = [...set1].filter(x => set2.has(x));
    const union = new Set([...words1, ...words2]);

    return Math.round((intersection.length / union.size) * 100);
  };

  // Generate summary items based on content differences
  const generateSummaryItems = (leftContent, rightContent) => {
    const items = [];

    if (!leftContent || !rightContent) {
      items.push('无法生成差异摘要：缺少报告内容');
      return items;
    }

    // Compare sections if available
    const leftSections = leftContent.sections || [];
    const rightSections = rightContent.sections || [];

    if (leftSections.length !== rightSections.length) {
      items.push(`章节数量变化：从 ${leftSections.length} 个变为 ${rightSections.length} 个`);
    }

    // Check for summary differences
    if (leftContent.summary !== rightContent.summary) {
      items.push('总体情况章节的文字变化较大');
    }

    // Generic difference note
    const similarity = calculateSimilarity(leftContent, rightContent);
    if (similarity < 50) {
      items.push(`整体相似度较低 (${similarity}%)，存在明显数据差异`);
    } else if (similarity < 80) {
      items.push(`整体相似度中等 (${similarity}%)，存在部分内容调整`);
    } else {
      items.push(`整体相似度较高 (${similarity}%)，内容变化不大`);
    }

    return items;
  };

  // Render content section
  // Note: renderContent isn't used in main Comparison View logic anymore, 
  // but kept if needed for fallback or single view
  const renderContent = (content, year) => {
    if (!content) {
      return <div className="no-data">暂无解析数据</div>;
    }

    if (typeof content === 'string') {
      return <pre className="text-content">{content}</pre>;
    }

    const sections = [];

    // Handle parsed content structure
    if (content.sections && Array.isArray(content.sections)) {
      content.sections.forEach((section, idx) => {
        sections.push(
          <div key={idx} className="content-section">
            {section.title && <h4 className="section-title">{section.title}</h4>}

            {section.type === 'text' && (
              <div className="section-content">
                {section.content || section.text || ''}
              </div>
            )}

            {section.type === 'table_2' && section.activeDisclosureData && (
              <Table2View data={section.activeDisclosureData} />
            )}

            {section.type === 'table_3' && section.tableData && (
              <Table3View data={section.tableData} compact={true} />
            )}

            {section.type === 'table_4' && section.reviewLitigationData && (
              <Table4View data={section.reviewLitigationData} />
            )}

            {/* Fallback for mixed or unknown types */}
            {(!['text', 'table_2', 'table_3', 'table_4'].includes(section.type)) && (
              <div className="section-content">
                {section.content || JSON.stringify(section)}
              </div>
            )}
          </div>
        );
      });
    } else if (content.summary) {
      sections.push(
        <div key="summary" className="content-section">
          <h4 className="section-title">摘要</h4>
          <div className="section-content">
            {typeof content.summary === 'string' ? content.summary : JSON.stringify(content.summary, null, 2)}
          </div>
        </div>
      );
    }

    // If no sections, show raw JSON
    if (sections.length === 0) {
      return (
        <pre className="text-content json-content">
          {JSON.stringify(content, null, 2)}
        </pre>
      );
    }

    return <div className="parsed-content">{sections}</div>;
  };

  // Handle print/export to PDF (Browser Print)
  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="comparison-detail-view">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="comparison-detail-view">
        <div className="error-container">
          <p className="error-text">{error}</p>
          <button onClick={fetchData} className="retry-btn">重新加载</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="comparison-detail-view">
        <div className="error-container">
          <p>无数据</p>
        </div>
      </div>
    );
  }

  const similarity = calculateSimilarity(data.left_content, data.right_content);
  const summaryItems = generateSummaryItems(data.left_content, data.right_content);

  // Align sections for comparison
  const getPairedSections = (leftContent, rightContent) => {
    const pairs = [];
    const leftSections = leftContent?.sections || [];
    const rightSections = rightContent?.sections || [];

    // Create a map of right sections by title for easy lookup
    const rightMap = new Map();
    rightSections.forEach(s => {
      if (s.title) rightMap.set(s.title, s);
    });

    // Match left sections with right
    leftSections.forEach(leftSec => {
      const rightSec = rightMap.get(leftSec.title);
      // Remove matched from map to find unmatched later
      if (rightSec) rightMap.delete(leftSec.title);

      pairs.push({
        title: leftSec.title,
        left: leftSec,
        right: rightSec,
        type: leftSec.type
      });
    });

    // Add remaining unmatched right sections
    rightMap.forEach((rightSec) => {
      pairs.push({
        title: rightSec.title,
        left: null,
        right: rightSec,
        type: rightSec.type
      });
    });

    // Sort by standard order if possible, or keep as is
    return pairs;
  };

  const renderComparisonProp = (pair, idx) => {
    const { title, left, right, type } = pair;

    return (
      <div key={idx} className="comparison-section-row mb-8 border-b border-gray-200 pb-8">
        <h3 className="text-xl font-bold mb-4 text-gray-800">{title || '未知章节'}</h3>

        <div className="comparison-grid grid grid-cols-2 gap-8">
          {/* Left Side */}
          <div className="comparison-cell left-cell">
            {left ? (
              <>
                {type === 'text' && (
                  <DiffText
                    oldText={left.content || left.text || ''}
                    newText={left.content || left.text || ''}
                    highlightIdentical={false}
                    highlightDiff={false}
                  />
                )}
                {type === 'table_2' && <Table2View data={left.activeDisclosureData} />}
                {type === 'table_3' && <Table3View data={left.tableData} compact={true} />}
                {type === 'table_4' && <Table4View data={left.reviewLitigationData} />}
                {/* Fallback */}
                {(!['text', 'table_2', 'table_3', 'table_4'].includes(type)) && (
                  <div className="text-content white-space-pre-wrap break-words">
                    {left.content || JSON.stringify(left)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-400 italic">本报告无此章节</div>
            )}
          </div>

          {/* Right Side */}
          <div className="comparison-cell right-cell">
            {right ? (
              <>
                {/* For text, we show DIFF relative to left */}
                {type === 'text' && (
                  <DiffText
                    oldText={left?.content || left?.text || ''}
                    newText={right.content || right.text || ''}
                    highlightIdentical={highlightIdentical}
                    highlightDiff={highlightDiff}
                  />
                )}
                {type === 'table_2' && <Table2View data={right.activeDisclosureData} />}
                {type === 'table_3' && <Table3View data={right.tableData} compact={true} />}
                {type === 'table_4' && <Table4View data={right.reviewLitigationData} />}
                {/* Fallback */}
                {(!['text', 'table_2', 'table_3', 'table_4'].includes(type)) && (
                  <div className="text-content white-space-pre-wrap break-words">
                    {right.content || JSON.stringify(right)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-gray-400 italic">本报告无此章节</div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const pairs = data ? getPairedSections(data.left_content, data.right_content) : [];

  return (
    <div className="comparison-detail-view font-sans">
      {/* Back Button */}
      <div className="back-nav mb-4">
        <button onClick={onBack} className="flex items-center text-blue-600 hover:text-blue-800">
          <span className="mr-1">←</span> 返回列表
        </button>
      </div>

      {/* Summary Header */}
      <div className="summary-card">
        <h2 className="summary-title">
          {data?.region_name || '未知地区'} 年报比对
        </h2>

        <div className="flex space-x-8 text-sm text-gray-700 mb-4 font-mono">
          <div>
            <span className="text-gray-500">年份:</span> <span className="font-bold">{data?.year_a} vs {data?.year_b}</span>
          </div>
          <div>
            <span className="text-gray-500">文字重复率:</span>
            <span className="font-bold mx-1">
              {data?.diff_json?.summary?.textRepetition !== undefined ? data.diff_json.summary.textRepetition : similarity}%
            </span>
            <span className="text-xs text-gray-400">(忽略标点)</span>
          </div>
          <div>
            <span className="text-gray-500">表格重复率:</span>
            <span className="font-bold mx-1">
              {data?.diff_json?.summary?.tableRepetition !== undefined ? data.diff_json.summary.tableRepetition : '-'}%
            </span>
          </div>
          <div>
            <span className="text-gray-500">总体重复率:</span>
            <span className="font-bold mx-1">
              {data?.diff_json?.summary?.overallRepetition !== undefined ? data.diff_json.summary.overallRepetition : similarity}%
            </span>
          </div>
        </div>

        {(summaryItems.length > 0 || (data?.diff_json?.summary?.items && data.diff_json.summary.items.length > 0)) && (
          <div className="bg-gray-50 rounded p-4 border border-gray-100">
            <h3 className="font-bold text-gray-900 mb-2 text-sm">差异摘要</h3>
            <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
              {/* Prefer backend summary items if available */}
              {data?.diff_json?.summary?.items && data.diff_json.summary.items.length > 0
                ? data.diff_json.summary.items.map((item, idx) => <li key={idx}>{item}</li>)
                : summaryItems.map((item, idx) => <li key={idx}>{item}</li>)
              }
            </ul>
          </div>
        )}
      </div>

      {/* Highlight Settings */}
      <div className="flex justify-between items-center mb-6 bg-white p-3 rounded-lg border border-gray-200 shadow-sm sticky top-0 z-10 w-full setting-bar-container">
        <div className="flex items-center space-x-6">
          <span className="text-sm font-bold text-gray-700">👁 视图设置</span>
          <label className="flex items-center space-x-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded text-blue-600 focus:ring-blue-500"
              checked={highlightIdentical}
              onChange={e => setHighlightIdentical(e.target.checked)}
            />
            <span className="bg-yellow-200 px-1 rounded text-gray-900">相同部分 (黄色)</span>
          </label>
          <label className="flex items-center space-x-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded text-blue-600 focus:ring-blue-500"
              checked={highlightDiff}
              onChange={e => setHighlightDiff(e.target.checked)}
            />
            <span className="bg-red-200 px-1 rounded text-red-900">差异部分 (红色)</span>
          </label>
        </div>
        <button onClick={handlePrint} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium flex items-center shadow-sm">
          🖨 打印/另存为PDF
        </button>
      </div>

      {/* Comparison Content */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-8 min-h-screen">
        {/* Header Row */}
        <div className="grid grid-cols-2 gap-8 mb-8 border-b border-gray-200 pb-4">
          <div className="bg-yellow-50 p-3 rounded border border-yellow-100 text-center font-bold text-gray-800">
            {data?.year_a} 年报告 (基准)
          </div>
          <div className="bg-green-50 p-3 rounded border border-green-100 text-center font-bold text-gray-800">
            {data?.year_b} 年报告 (对比)
          </div>
        </div>

        {/* Sections */}
        {pairs.map((pair, idx) => renderComparisonProp(pair, idx))}

        {pairs.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            暂无内容可比对
          </div>
        )}
      </div>
    </div>
  );
}

export default ComparisonDetailView;
