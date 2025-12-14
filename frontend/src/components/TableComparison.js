import React from 'react';
import './TableComparison.css';

function TableComparison({ viewModel }) {
  if (!viewModel || !viewModel.sections) {
    return <div className="loading">加载中...</div>;
  }

  const renderTableBlock = (block) => {
    if (block.type !== 'table' || !block.tableData) {
      return null;
    }

    const { cellDiffs, metricsDiffs } = block.tableData;

    return (
      <div key={block.tableData.schemaTableId} className="table-block">
        <h4 className="table-title">{block.tableData.schemaTableId}</h4>

        {/* 单元格差异 */}
        <div className="cell-diffs">
          <h5>单元格变化</h5>
          {cellDiffs.length > 0 ? (
            <div className="cell-diff-list">
              {cellDiffs.map((diff, idx) => (
                <div key={idx} className={`cell-diff ${diff.status}`}>
                  <div className="cell-location">
                    <strong>{diff.rowLabel}</strong> / <strong>{diff.colName}</strong>
                  </div>
                  <div className="cell-values">
                    <span className="before-value">"{diff.beforeValue}"</span>
                    <span className="arrow">→</span>
                    <span className="after-value">"{diff.afterValue}"</span>
                  </div>
                  <span className={`status-tag ${diff.status}`}>
                    {getStatusText(diff.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-changes">无单元格变化</p>
          )}
        </div>

        {/* 指标分析 */}
        {metricsDiffs.length > 0 && (
          <div className="metrics-analysis">
            <h5>指标分析</h5>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>指标名称</th>
                  <th>年份 A</th>
                  <th>年份 B</th>
                  <th>增减值</th>
                  <th>增减率</th>
                </tr>
              </thead>
              <tbody>
                {metricsDiffs.map((metric, idx) => (
                  <tr key={idx}>
                    <td className="metric-name">{metric.rowLabel}</td>
                    <td className="metric-value">{metric.beforeValue}</td>
                    <td className="metric-value">{metric.afterValue}</td>
                    <td className={`metric-delta ${metric.delta >= 0 ? 'positive' : 'negative'}`}>
                      {metric.delta >= 0 ? '+' : ''}{metric.delta}
                    </td>
                    <td className={`metric-percent ${metric.deltaPercent >= 0 ? 'positive' : 'negative'}`}>
                      {metric.deltaPercent !== undefined
                        ? `${metric.deltaPercent >= 0 ? '+' : ''}${metric.deltaPercent}%`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
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
    <div className="table-comparison-container">
      <div className="sections-container">
        {viewModel.sections.map((section) => {
          // 处理两种数据格式：blocks 数组或 tables 数组
          const blocks = section.blocks || [];
          const tables = section.tables || [];
          
          const tableBlocks = blocks
            .filter((b) => b.type === 'table')
            .map((b) => renderTableBlock(b))
            .filter((b) => b !== null);

          // 如果没有 blocks，但有 tables，则显示 tables
          const hasTableBlocks = tableBlocks.length > 0;
          const hasTables = tables.length > 0;

          if (!hasTableBlocks && !hasTables) {
            return null;
          }

          return (
            <div key={section.sectionId || section.id} className="section">
              <h3 className="section-title">{section.sectionTitle || section.title}</h3>
              <div className="table-blocks">
                {tableBlocks}
                {hasTables && tables.map((table, idx) => (
                  <div key={idx} className="table-block">
                    <h4 className="table-title">{table.title || '表格'}</h4>
                    <table className="data-table">
                      <tbody>
                        {table.rows && table.rows.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {row.cells && row.cells.map((cell, cellIdx) => (
                              <td key={cellIdx}>{cell || '-'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TableComparison;
