import React from 'react';
import { t } from '../utils/i18n';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  componentDidUpdate(_prevProps: Props) {
    // Error state is only cleared by the user clicking Reload.
    // Previously this auto-reset when children references changed,
    // but JSX elements create new references on every render,
    // which caused the error UI to flash and immediately disappear.
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="text-4xl mb-4">⚠</div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">
            {t('error.boundary_title')}
          </h2>
          <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 max-w-sm">
            {t('error.boundary_description')}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors"
            >
              {t('error.retry')}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition-colors"
            >
              {t('error.reload')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
