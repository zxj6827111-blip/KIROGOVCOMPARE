import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import './ConfirmDialogProvider.css';

const ConfirmDialogContext = createContext(null);

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const close = useCallback((result) => {
    setDialog((current) => {
      if (current?.resolve) {
        current.resolve(result);
      }
      return null;
    });
  }, []);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setDialog({
        title: options.title || '确认操作',
        message: options.message || '',
        confirmText: options.confirmText || '确认',
        cancelText: options.cancelText || '取消',
        tone: options.tone || 'default',
        resolve,
      });
    });
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmDialogContext.Provider value={value}>
      {children}
      {dialog && (
        <div className="ui-confirm-backdrop" role="presentation">
          <div className={`ui-confirm-dialog ui-confirm-${dialog.tone}`} role="dialog" aria-modal="true" aria-labelledby="ui-confirm-title">
            <div id="ui-confirm-title" className="ui-confirm-title">{dialog.title}</div>
            {dialog.message && <div className="ui-confirm-message">{dialog.message}</div>}
            <div className="ui-confirm-actions">
              <button type="button" className="ui-confirm-cancel" onClick={() => close(false)}>
                {dialog.cancelText}
              </button>
              <button type="button" className="ui-confirm-submit" onClick={() => close(true)}>
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    return async () => false;
  }
  return context.confirm;
}
