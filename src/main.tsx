import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import './index.css';

// Lazy-load route-specific pages — most users only interact with the main map.
// NeighborhoodProfilePage (~21KB source) imports dataLoader, similarity, qualityIndex,
// formatting, etc. Deferring it avoids downloading & parsing that code on initial load.
// eslint-disable-next-line react-refresh/only-export-components
const NeighborhoodProfilePage = lazy(() => import('./pages/NeighborhoodProfilePage').then(m => ({ default: m.NeighborhoodProfilePage })));
// eslint-disable-next-line react-refresh/only-export-components
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));

// Auto-reload when a new service worker is activated after deployment.
// This prevents users from being stuck on a stale cached version.
// Check for updates every 60 seconds so returning tabs pick up deploys fast.
let pendingRefresh = false;
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (registration) {
      setInterval(() => { registration.update(); }, 60_000);
    }
  },
  onNeedRefresh() {
    // New content available — defer the reload until the user isn't actively
    // interacting with the page (tab hidden/blurred) to avoid losing unsaved
    // state like draw polygons, notes, or mid-comparison work.
    if (document.hidden) {
      window.location.reload();
    } else if (!pendingRefresh) {
      // Guard against duplicate listeners from rapid successive SW activations.
      pendingRefresh = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) window.location.reload();
      }, { once: true });
    }
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
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/alue/:slug" element={<NeighborhoodProfilePage />} />
            <Route path="/en/area/:slug" element={<NeighborhoodProfilePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
