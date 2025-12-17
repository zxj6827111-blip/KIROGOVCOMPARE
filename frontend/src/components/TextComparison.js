import React from 'react';
import './TextComparison.css';

function TextComparison({ viewModel }) {
  return (
    <div className="text-comparison">
      <p>文本对照视图尚未接入数据源。</p>
      {viewModel && <pre>{JSON.stringify(viewModel, null, 2)}</pre>}
    </div>
  );
}

export default TextComparison;
