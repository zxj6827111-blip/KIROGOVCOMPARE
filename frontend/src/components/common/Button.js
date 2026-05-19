import React from 'react';
import './common-ui.css';

function Button({
  children,
  className = '',
  icon = null,
  variant = 'secondary',
  size = 'md',
  type = 'button',
  ...props
}) {
  const classes = [
    'kc-button',
    `kc-button--${variant}`,
    `kc-button--${size}`,
    className,
  ].filter(Boolean).join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {icon && <span className="kc-button__icon">{icon}</span>}
      {children && <span className="kc-button__label">{children}</span>}
    </button>
  );
}

export default Button;
