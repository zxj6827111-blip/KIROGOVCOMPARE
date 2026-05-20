import React from 'react';
import { AlertCircle } from 'lucide-react';
import './common-ui.css';

function ErrorState({
  actions = null,
  className = '',
  icon = <AlertCircle size={22} />,
  message = '',
  title = '加载失败',
}) {
  return (
    <div className={`kc-error-state ${className}`.trim()}>
      {icon && <div className="kc-error-state__icon">{icon}</div>}
      {title && <div className="kc-error-state__title">{title}</div>}
      {message && <p className="kc-error-state__message">{message}</p>}
      {actions && <div className="kc-error-state__actions">{actions}</div>}
    </div>
  );
}

export default ErrorState;
