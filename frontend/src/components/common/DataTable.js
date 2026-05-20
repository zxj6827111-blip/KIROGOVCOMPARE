import React from 'react';
import './common-ui.css';

function DataTable({
  children,
  className = '',
  compact = false,
  containerClassName = '',
  ...props
}) {
  const tableClassName = [
    'kc-data-table',
    compact ? 'kc-data-table--compact' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={`kc-data-table-wrap ${containerClassName}`.trim()}>
      <table className={tableClassName} {...props}>
        {children}
      </table>
    </div>
  );
}

export default DataTable;
