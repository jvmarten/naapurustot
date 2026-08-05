// A one-slot sink for errors caught by <ErrorBoundary>.
//
// React never re-throws what a boundary catches, so a crash there is invisible to
// Sentry's global handlers — the only trace was a console.error nobody sees. That
// left the boundary's own failure mode (fallback shows, "Try again" fixes it) with
// no stack to diagnose from.
//
// The reporter is *installed* by main.tsx inside its `if (SENTRY_DSN)` block rather
// than imported here, so builds without a DSN still tree-shake @sentry/react out
// entirely (it is a dynamic import there for exactly that reason).

export interface ReportedErrorInfo {
  componentStack?: string | null;
}

type Reporter = (error: Error, info?: ReportedErrorInfo) => void;

let reporter: Reporter | null = null;

export function setErrorReporter(fn: Reporter | null): void {
  reporter = fn;
}

/** Forward a boundary-caught error to the installed reporter. Never throws. */
export function reportCaughtError(error: Error, info?: ReportedErrorInfo): void {
  try {
    reporter?.(error, info);
  } catch {
    // Reporting must never take down the fallback UI that is trying to render.
  }
}
