import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installChunkReloadHandler } from './utils/chunkReload';
import './index.css';

// Recover from failed dynamic imports caused by stale chunk references after a
// deployment — installed before any dynamic import fires so the first failure
// is caught.
installChunkReloadHandler();

// Lazy-load route-specific pages — most users only interact with the main map.
// NeighborhoodProfilePage (~21KB source) imports dataLoader, similarity, qualityIndex,
// formatting, etc. Deferring it avoids downloading & parsing that code on initial load.
// eslint-disable-next-line react-refresh/only-export-components
const NeighborhoodProfilePage = lazy(() => import('./pages/NeighborhoodProfilePage').then(m => ({ default: m.NeighborhoodProfilePage })));
// eslint-disable-next-line react-refresh/only-export-components
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
// CF-9: prerendered public data-sources & methodology page (FI/EN/SV).
// eslint-disable-next-line react-refresh/only-export-components
const DataSourcesPage = lazy(() => import('./pages/DataSourcesPage').then(m => ({ default: m.DataSourcesPage })));

// Auto-reload when a new service worker is activated after deployment.
// This prevents users from being stuck on a stale cached version.
// Check for updates every 60 seconds so returning tabs pick up deploys fast.
let pendingRefresh = false;
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    setInterval(() => {
      // registration.update() rejects with InvalidStateError ("newestWorker
      // is null") when the registration has no installing/waiting/active
      // worker, or TypeError when it has been unregistered. The returned
      // promise is otherwise unhandled, which surfaces as a noisy error
      // report — swallow it; a later tick recovers once a worker is available.
      void registration.update().catch(() => {});
    }, 60_000);
  },
  onNeedRefresh() {
    // New content available — defer the reload until the user isn't actively
    // interacting with the page (tab hidden/blurred) to avoid losing unsaved
    // state like draw polygons, notes, or mid-comparison work.
    if (document.hidden) {
      window.location.reload();
    } else if (!pendingRefresh) {
      pendingRefresh = true;
      const onVisChange = () => {
        if (document.hidden) {
          document.removeEventListener('visibilitychange', onVisChange);
          window.location.reload();
        }
      };
      document.addEventListener('visibilitychange', onVisChange);
    }
  },
  onOfflineReady() {
    // Silently ready for offline use, no action needed.
  },
  onRegisterError(error) {
    // Registering /sw.js can fail transiently (network error, blocked
    // request). The app works fine without the service worker, so log
    // quietly instead of letting it surface as an unhandled error.
    console.warn('Service worker registration failed:', error);
  },
});

// Sentry is dynamically imported so that builds without VITE_SENTRY_DSN
// (e.g. CI bundle-size check, local dev) tree-shake the package out entirely.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (SENTRY_DSN) {
  void import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn: SENTRY_DSN,
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
      // Filter out noise thrown by third-party browser extensions injected
      // into the page (most often on Mobile Safari). These are not our bugs —
      // they originate in the extension's own code and surface here only
      // because Sentry's global onunhandledrejection handler catches every
      // rejected promise on the page. Examples:
      //   "Invalid call to runtime.sendMessage(). Tab not found."
      //   "Extension context invalidated."
      //   "The message port closed before a response was received."
      ignoreErrors: [
        /runtime\.sendMessage/i,
        /runtime\.connect/i,
        /Extension context invalidated/i,
        /message port closed/i,
        /Receiving end does not exist/i,
      ],
      // Drop events whose stack frames all point at extension URLs. Different
      // browsers use different protocols for injected extension scripts.
      denyUrls: [
        /^chrome-extension:\/\//i,
        /^moz-extension:\/\//i,
        /^safari-(web-)?extension:\/\//i,
      ],
    });
  });
}

// IN-2: Core Web Vitals — LCP, INP, CLS, FCP, TTFB.
// In dev: console.debug for quick local feedback.
// In prod: route through trackEvent → Umami so we can correlate UX regressions
// to deploys. Lazy-loaded so the metrics library never appears on the critical
// path of the initial render.
void import('./utils/webVitals').then((m) => m.reportWebVitals());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<App />} />
            {/* Profile routes are wrapped in an ErrorBoundary so a render-phase
                crash (e.g. a "Maximum call stack size exceeded" RangeError seen
                on memory-constrained mobile engines) degrades to a recoverable
                fallback instead of an uncaught error + blank page. */}
            <Route path="/alue/:slug" element={<ErrorBoundary><NeighborhoodProfilePage /></ErrorBoundary>} />
            <Route path="/en/area/:slug" element={<ErrorBoundary><NeighborhoodProfilePage /></ErrorBoundary>} />
            <Route path="/sv/omrade/:slug" element={<ErrorBoundary><NeighborhoodProfilePage /></ErrorBoundary>} />
            <Route path="/tietolahteet" element={<DataSourcesPage lang="fi" />} />
            <Route path="/en/data-sources" element={<DataSourcesPage lang="en" />} />
            <Route path="/sv/datakallor" element={<DataSourcesPage lang="sv" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
