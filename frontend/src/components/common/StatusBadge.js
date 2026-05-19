import React from 'react';
import './common-ui.css';

function StatusBadge({ children, className = '', tone = 'neutral' }) {
  return (
    <span className={`kc-status-badge kc-status-badge--${tone} ${className}`.trim()}>
      {children}
    </span>
  );
}

export default StatusBadge;
