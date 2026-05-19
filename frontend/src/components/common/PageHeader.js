import React from 'react';
import './common-ui.css';

function PageHeader({
  actions = null,
  badges = null,
  className = '',
  eyebrow = '',
  subtitle = '',
  title,
}) {
  return (
    <div className={`kc-page-header ${className}`.trim()}>
      <div className="kc-page-header__main">
        {eyebrow && <div className="kc-page-header__eyebrow">{eyebrow}</div>}
        <div className="kc-page-header__title-row">
          <h2>{title}</h2>
          {badges && <div className="kc-page-header__badges">{badges}</div>}
        </div>
        {subtitle && <p className="kc-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="kc-page-header__actions">{actions}</div>}
    </div>
  );
}

export default PageHeader;
