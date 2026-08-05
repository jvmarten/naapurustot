import React from 'react';
import { t } from '../utils/i18n';
import { reportCaughtError } from '../utils/errorReporter';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /**
   * Changing this clears a showing fallback. Pass the router location so a crash on
   * one page does not follow the user to the next one: without it the boundary latches
   * `hasError` forever and every later navigation — including the fallback's own
   * "Go back" — renders the error screen again instead of the page.
   */
  resetKey?: string;
}

interface State {
  hasError: boolean;
  remountKey: number;
  /** Silent remounts spent on DOM-mutation (reconciliation) errors. */
  recoveryAttempts: number;
  /** Silent remounts spent on any other error. */
  genericAttempts: number;
  /** The user asked to retry and it crashed again — escalate the primary action. */
  retryFailed: boolean;
  /** A manual retry is in flight, so the next error means that retry failed. */
  manualRetryPending: boolean;
  lastResetKey: string | undefined;
}

/** Cap on silent auto-remounts before showing the fallback, so a persistently
 *  DOM-mutating extension can't spin an unbounded remount loop. */
const MAX_AUTO_RECOVERIES = 3;

/**
 * Errors outside the reconciliation class get exactly ONE silent remount.
 *
 * The failure this exists for is a route swap: leaving the map for a profile page
 * tears down the whole App subtree (MapLibre's WebGL context, ~30 hooks' cleanups)
 * in the same commit that mounts the new page. A throw anywhere in that teardown is
 * a *one-shot* condition — by the time the boundary re-renders, the work that threw
 * is already done — which is why "Try again" reliably fixed it while the page itself
 * was never broken. One silent retry turns that into a frame the user never sees; a
 * genuinely broken page still crashes the second time and gets the fallback.
 */
const MAX_GENERIC_RECOVERIES = 1;

/**
 * How long the children must render without error before the burst counters reset.
 *
 * Without this the caps are permanent for the lifetime of the tab: three recovered
 * hiccups an hour apart used up the whole budget, and every crash after that dead-
 * ended on the fallback even though each one was individually recoverable.
 */
const HEALTHY_RESET_MS = 10_000;

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
  // ER-4: focus the fallback when it appears so keyboard/SR users aren't stranded
  // on a detached node and `role="alert"` is announced.
  private fallbackRef = React.createRef<HTMLDivElement>();
  private healthyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      remountKey: 0,
      recoveryAttempts: 0,
      genericAttempts: 0,
      retryFailed: false,
      manualRetryPending: false,
      lastResetKey: props.resetKey,
    };
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.lastResetKey) return null;
    // Navigated somewhere else — give the new location a clean slate.
    return state.hasError
      ? {
          hasError: false,
          remountKey: state.remountKey + 1,
          retryFailed: false,
          manualRetryPending: false,
          lastResetKey: props.resetKey,
        }
      : { lastResetKey: props.resetKey };
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    // ER-4: move focus to the alert region the moment the (default) fallback mounts.
    if (!prevState.hasError && this.state.hasError && !this.props.fallback) {
      this.fallbackRef.current?.focus();
    }
    if (prevState.hasError === this.state.hasError) return;
    this.clearHealthyTimer();
    // Recovered (or reset): once the tree has stayed up for a while, forget the
    // burst so a later, unrelated hiccup gets its own recovery budget.
    if (!this.state.hasError && (this.state.recoveryAttempts > 0 || this.state.genericAttempts > 0)) {
      this.healthyTimer = setTimeout(() => {
        this.healthyTimer = undefined;
        this.setState({
          recoveryAttempts: 0,
          genericAttempts: 0,
          retryFailed: false,
          manualRetryPending: false,
        });
      }, HEALTHY_RESET_MS);
    }
  }

  componentWillUnmount() {
    this.clearHealthyTimer();
  }

  private clearHealthyTimer() {
    if (this.healthyTimer) {
      clearTimeout(this.healthyTimer);
      this.healthyTimer = undefined;
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    // Nothing re-throws past a boundary, so this is the only chance to record the
    // stack anywhere the maintainers can read it.
    reportCaughtError(error, { componentStack: errorInfo.componentStack });

    const recoverable = isRecoverableReconciliationError(error);
    const canAutoRecover = recoverable
      ? this.state.recoveryAttempts < MAX_AUTO_RECOVERIES
      : this.state.genericAttempts < MAX_GENERIC_RECOVERIES;

    if (canAutoRecover) {
      // Auto-recover: clear the error and bump the remount key so the children
      // get a fresh fiber tree. Deferred to the next microtask to avoid
      // setState-during-error-handling warnings. Bounded by the counters above
      // so a continuously-failing subtree can't loop forever — past the cap the
      // fallback UI renders instead.
      queueMicrotask(() => {
        this.setState((s) => ({
          hasError: false,
          remountKey: s.remountKey + 1,
          recoveryAttempts: recoverable ? s.recoveryAttempts + 1 : s.recoveryAttempts,
          genericAttempts: recoverable ? s.genericAttempts : s.genericAttempts + 1,
        }));
      });
      return;
    }

    // Out of silent retries, so the fallback is about to show. If this crash came
    // from the user's own "Try again", a soft remount has now demonstrably failed —
    // offer the harder hammer (a full reload) instead of the same button again.
    if (this.state.manualRetryPending) {
      this.setState({ retryFailed: true, manualRetryPending: false });
    }
  }

  /** Soft recovery: rebuild the children from a clean fiber tree, keeping app state. */
  private handleRetry = () => {
    this.setState((s) => ({
      hasError: false,
      remountKey: s.remountKey + 1,
      recoveryAttempts: 0,
      genericAttempts: 0,
      manualRetryPending: true,
    }));
  };

  private handleReload = () => {
    window.location.reload();
  };

  /**
   * Leave the broken view instead of re-attempting it. Clears the error first so the
   * destination renders even when the same boundary instance is reused for it, and
   * falls back to the map when this page is the first entry in the session's history
   * (a direct landing has nowhere to go back to).
   */
  private handleGoBack = () => {
    this.setState((s) => ({
      hasError: false,
      remountKey: s.remountKey + 1,
      recoveryAttempts: 0,
      genericAttempts: 0,
      retryFailed: false,
      manualRetryPending: false,
    }));
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // Two buttons, two different outcomes: retry this view, or leave it. "Try
      // again" and "Reload" used to sit side by side, which read as the same action
      // twice — so the reload is now an escalation, offered only once a soft retry
      // has actually failed.
      const primaryLabel = this.state.retryFailed ? t('error.reload') : t('error.retry');
      const onPrimary = this.state.retryFailed ? this.handleReload : this.handleRetry;
      return (
        <div
          ref={this.fallbackRef}
          role="alert"
          tabIndex={-1}
          className="flex flex-col items-center justify-center p-8 text-center outline-none"
        >
          <div className="text-4xl mb-4">⚠</div>
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">
            {t('error.boundary_title')}
          </h2>
          <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 max-w-sm">
            {t('error.boundary_description')}
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleGoBack}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-200 dark:bg-surface-700 text-surface-900 dark:text-white hover:bg-surface-300 dark:hover:bg-surface-600 transition-colors"
            >
              {t('error.go_back')}
            </button>
            <button
              onClick={onPrimary}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 transition-colors"
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.remountKey}>{this.props.children}</React.Fragment>;
  }
}
