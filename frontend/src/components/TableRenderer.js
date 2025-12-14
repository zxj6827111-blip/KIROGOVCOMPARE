import React from 'react';
import './TableRenderer.css';

/**
 * 表格渲染组件
 * 用于渲染 PDF 解析后的表格数据
 */
function TableRenderer({ table, title }) {
  if (!table || !table.rows || table.rows.length === 0) {
    return (
      <div className="table-renderer empty">
        <p>暂无表格数据</p>
      </div>
    );
  }

  return (
    <div className="table-renderer">
      {title && <h4 className="table-title">{title}</h4>}
      
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr className="table-header">
              {table.rows[0]?.cells?.map((cell, idx) => (
                <th
                  key={`header-${idx}`}
                  className="table-header-cell"
                  style={{
                    width: `${100 / table.columns}%`,
                  }}
                >
                  {cell.colName || cell.colKey || `列 ${idx + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          
          <tbody>
            {table.rows.map((row, rowIdx) => (
              <tr
                key={`row-${rowIdx}`}
                className={`table-row ${rowIdx % 2 === 0 ? 'even' : 'odd'}`}
              >
                {row.cells?.map((cell, colIdx) => (
                  <td
                    key={`cell-${rowIdx}-${colIdx}`}
                    className="table-cell"
                    style={{
                      width: `${100 / table.columns}%`,
                    }}
                  >
                    {formatCellValue(cell.value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {table.degraded && (
        <div className="table-warning">
          ⚠️ 此表格数据可能不完整，请参考原始 PDF 文件
        </div>
      )}
    </div>
  );
}

/**
 * 格式化单元格值
 */
function formatCellValue(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  
  if (typeof value === 'number') {
    return value.toString();
  }
  
  if (typeof value === 'string') {
    return value.trim() || '-';
  }
  
  return String(value);
}

export default TableRenderer;
