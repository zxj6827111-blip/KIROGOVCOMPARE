import React from 'react';
import './common-ui.css';

function EmptyState({
  actions = null,
  children = null,
  className = '',
  description = '',
  icon = null,
  title = '暂无数据',
}) {
  return (
    <div className={`kc-empty-state ${className}`.trim()}>
      {icon && <div className="kc-empty-state__icon">{icon}</div>}
      {title && <div className="kc-empty-state__title">{title}</div>}
      {description && <p className="kc-empty-state__description">{description}</p>}
      {children}
      {actions && <div className="kc-empty-state__actions">{actions}</div>}
    </div>
  );
}

export default EmptyState;
