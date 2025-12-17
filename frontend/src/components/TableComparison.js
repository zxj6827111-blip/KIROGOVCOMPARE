import React from 'react';
import './TableComparison.css';

function TableComparison({ viewModel }) {
  return (
    <div className="table-comparison">
      <p>表格对照视图尚未接入数据源。</p>
      {viewModel && <pre>{JSON.stringify(viewModel, null, 2)}</pre>}
    </div>
  );
}

export default TableComparison;
