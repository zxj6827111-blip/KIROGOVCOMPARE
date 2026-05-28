import React, { Component, ErrorInfo, ReactNode } from 'react';
import '../../styles/components.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="kc-error-state" style={{ minHeight: '100vh', borderRadius: 0, border: 'none' }}>
          <div className="kc-error-state__icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="kc-error-state__title">页面出现异常</div>
          <p className="kc-error-state__message">应用遇到了意外错误，请刷新页面重试</p>
          <div className="kc-error-state__actions">
            <button
              className="kc-button kc-button--primary kc-button--md"
              onClick={this.handleReload}
            >
              刷新页面
            </button>
          </div>
          {this.state.error && (
            <details style={{ marginTop: 16, maxWidth: 560, textAlign: 'left', fontSize: 12, color: '#64748b' }}>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>错误详情</summary>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: 12, background: '#f8fafc', borderRadius: 4, border: '1px solid #e2e8f0', margin: 0 }}>
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
