import React from 'react';
import { X } from 'lucide-react';
import './common-ui.css';

function Modal({
  ariaLabel = '',
  bodyClassName = '',
  children,
  className = '',
  closeLabel = '关闭',
  footer = null,
  isOpen,
  onClose,
  overlayClassName = '',
  size = 'md',
  title = '',
}) {
  if (!isOpen) return null;

  const label = ariaLabel || (typeof title === 'string' ? title : '对话框');

  const handleBackdropMouseDown = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div
      className={`kc-modal-backdrop ${overlayClassName}`.trim()}
      onMouseDown={handleBackdropMouseDown}
      role="presentation"
    >
      <section
        aria-label={label}
        aria-modal="true"
        className={`kc-modal kc-modal--${size} ${className}`.trim()}
        role="dialog"
      >
        <div className="kc-modal__header">
          {title && <h2 className="kc-modal__title">{title}</h2>}
          <button
            aria-label={closeLabel}
            className="kc-modal__close"
            onClick={onClose}
            title={closeLabel}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className={`kc-modal__body ${bodyClassName}`.trim()}>{children}</div>
        {footer && <div className="kc-modal__footer">{footer}</div>}
      </section>
    </div>
  );
}

export default Modal;
