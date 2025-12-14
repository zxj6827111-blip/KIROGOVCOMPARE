import React, { useState } from 'react';
import './TextComparison.css';

function TextComparison({ viewModel }) {
  const [showOnlyDiff, setShowOnlyDiff] = useState(true);
  const [highlightDiff, setHighlightDiff] = useState(true);
  const [highlightSame, setHighlightSame] = useState(false);

  if (!viewModel || !viewModel.sections) {
    return <div className="loading">加载中...</div>;
  }

  const renderInlineDiff = (spans) => {
    if (!spans || spans.length === 0) {
      return null;
    }

    return spans.map((span, idx) => {
      if (span.type === 'equal') {
        return (
          <span key={idx} className="diff-equal">
            {span.text}
          </span>
        );
      } else if (span.type === 'insert') {
        return (
          <span key={idx} className="diff-insert">
            {span.text}
          </span>
        );
      } else if (span.type === 'delete') {
        return (
          <span key={idx} className="diff-delete">
            {span.text}
          </span>
        );
      }
      return null;
    });
  };

  const renderBlock = (block) => {
    // 过滤逻辑
    if (showOnlyDiff && block.status === 'same') {
      return null;
    }

    if (block.type === 'paragraph') {
      return (
        <div key={`${block.status}-${Math.random()}`} className={`text-block ${block.status}`}>
          <div className="block-header">
            <span className="status-badge">{getStatusText(block.status)}</span>
          </div>
          <div className="text-comparison">
            <div className="text-column">
              <div className="column-label">年份 A</div>
              <div className="text-content">
                {highlightDiff && block.inlineDiff
                  ? renderInlineDiff(block.inlineDiff)
                  : block.beforeText}
              </div>
            </div>
            <div className="text-column">
              <div className="column-label">年份 B</div>
              <div className="text-content">
                {highlightDiff && block.inlineDiff
                  ? renderInlineDiff(block.inlineDiff)
                  : block.afterText}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const getStatusText = (status) => {
    const texts = {
      same: '相同',
      modified: '修改',
      added: '新增',
      deleted: '删除',
    };
    return texts[status] || status;
  };

  return (
    <div className="text-comparison-container">
      <div className="comparison-controls">
        <label className="control-checkbox">
          <input
            type="checkbox"
            checked={showOnlyDiff}
            onChange={(e) => setShowOnlyDiff(e.target.checked)}
          />
          <span>仅看差异</span>
        </label>
        <label className="control-checkbox">
          <input
            type="checkbox"
            checked={highlightDiff}
            onChange={(e) => setHighlightDiff(e.target.checked)}
          />
          <span>高亮差异</span>
        </label>
        <label className="control-checkbox">
          <input
            type="checkbox"
            checked={highlightSame}
            onChange={(e) => setHighlightSame(e.target.checked)}
          />
          <span>高亮相同</span>
        </label>
      </div>

      <div className="sections-container">
        {viewModel.sections.map((section) => {
          // 处理两种数据格式：blocks 数组或 content 字符串
          const blocks = section.blocks || [];
          const content = section.content;
          
          // 如果有 blocks，显示 blocks
          if (blocks.length > 0) {
            return (
              <div key={section.sectionId} className="section">
                <h3 className="section-title">{section.sectionTitle}</h3>
                <div className="blocks">
                  {blocks
                    .map((block) => renderBlock(block))
                    .filter((b) => b !== null)}
                </div>
              </div>
            );
          }
          
          // 否则显示 content 文本
          if (content) {
            return (
              <div key={section.id} className="section">
                <h3 className="section-title">{section.title}</h3>
                <div className="text-block same">
                  <div className="text-content">
                    {typeof content === 'string' ? content : JSON.stringify(content)}
                  </div>
                </div>
              </div>
            );
          }
          
          return null;
        })}
      </div>
    </div>
  );
}

export default TextComparison;
