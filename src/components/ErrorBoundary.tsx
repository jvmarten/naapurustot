import React from 'react';
import { t } from '../utils/i18n';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  remountKey: number;
  recoveryAttempts: number;
}

/** Cap on silent auto-remounts before showing the fallback, so a persistently
 *  DOM-mutating extension can't spin an unbounded remount loop. */
const MAX_AUTO_RECOVERIES = 3;

// React's commit-phase `removeChild` can throw a DOMException when the live
// DOM has been mutated out from under it (typically by browser translation
// extensions like Google Translate wrapping text nodes in <font> tags).
// The error is fully recoverable: bumping a key on the children subtree
// forces React to rebuild from a clean fiber tree.
function isRecoverableReconciliationError(error: Error): boolean {
  if (error.name !== 'NotFoundError') return false;
  const msg = error.message || '';
  return msg.includes('removeChild') || msg.includes('insertBefore');
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, remountKey: 0, recoveryAttempts: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    if (isRecoverableReconciliationError(error) && this.state.recoveryAttempts < MAX_AUTO_RECOVERIES) {
      // Auto-recover: clear the error and bump the remount key so the
      // children get a fresh fiber tree. Deferred to the next microtask
      // to avoid setState-during-error-handling warnings. Bounded by
      // recoveryAttempts so a continuously-mutating DOM can't loop forever —
      // after the cap, the fallback UI (Retry/Reload) renders instead.
      queueMicrotask(() => {
        this.setState((s) => ({
          hasError: false,
          error: null,
          remountKey: s.remountKey + 1,
          recoveryAttempts: s.recoveryAttempts + 1,
        }));
      });
    }
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
              onClick={() => this.setState((s) => ({ hasError: false, error: null, remountKey: s.remountKey + 1, recoveryAttempts: 0 }))}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors"
            >
              {t('error.retry')}
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              {t('error.reload')}
            </button>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>;
  }
}
