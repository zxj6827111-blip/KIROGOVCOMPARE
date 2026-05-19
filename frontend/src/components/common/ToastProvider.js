import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import './ToastProvider.css';

const ToastContext = createContext(null);

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const removeToast = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const showToast = useCallback((input) => {
    const id = ++idRef.current;
    const toast = {
      id,
      type: input.type || 'info',
      title: input.title || '',
      message: input.message || '',
      detail: input.detail || '',
      actionLabel: input.actionLabel,
      onAction: input.onAction,
      duration: input.duration ?? DEFAULT_DURATION,
    };

    setToasts((items) => [...items, toast]);

    if (toast.duration > 0) {
      window.setTimeout(() => removeToast(id), toast.duration);
    }

    return id;
  }, [removeToast]);

  const value = useMemo(() => ({
    showToast,
    success: (title, message, options = {}) => showToast({ ...options, type: 'success', title, message }),
    error: (title, message, options = {}) => showToast({ ...options, type: 'error', title, message }),
    warning: (title, message, options = {}) => showToast({ ...options, type: 'warning', title, message }),
    info: (title, message, options = {}) => showToast({ ...options, type: 'info', title, message }),
  }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="ui-toast-viewport" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`ui-toast ui-toast-${toast.type}`} role="status">
            <button
              type="button"
              className="ui-toast-close"
              onClick={() => removeToast(toast.id)}
              aria-label="关闭提示"
            >
              ×
            </button>
            {toast.title && <div className="ui-toast-title">{toast.title}</div>}
            {toast.message && <div className="ui-toast-message">{toast.message}</div>}
            {toast.detail && toast.detail !== toast.message && (
              <div className="ui-toast-detail" title={toast.detail}>原始错误：{toast.detail}</div>
            )}
            {toast.actionLabel && toast.onAction && (
              <button
                type="button"
                className="ui-toast-action"
                onClick={() => {
                  removeToast(toast.id);
                  toast.onAction();
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      showToast: () => null,
      success: () => null,
      error: () => null,
      warning: () => null,
      info: () => null,
    };
  }
  return context;
}
