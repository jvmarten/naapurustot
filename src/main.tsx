import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import './index.css';

// Auto-reload when a new service worker is activated after deployment.
// This prevents users from being stuck on a stale cached version.
registerSW({
  onNeedRefresh() {
    // New content available — reload immediately so the user always
    // gets the latest version without manual intervention.
    window.location.reload();
  },
  onOfflineReady() {
    // Silently ready for offline use, no action needed.
  },
});

// IN-4: Error tracking (activate by setting VITE_SENTRY_DSN in .env)
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  // @ts-expect-error — @sentry/browser is an optional dependency, only loaded when DSN is set
  import('@sentry/browser').then(({ init, browserTracingIntegration }: { init: (opts: Record<string, unknown>) => void; browserTracingIntegration: () => unknown }) => {
    init({
      dsn: SENTRY_DSN,
      integrations: [browserTracingIntegration()],
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
    });
  }).catch(() => {
    // Sentry not available, skip
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
