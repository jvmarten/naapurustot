import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ThemeProvider } from './hooks/useTheme';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installChunkReloadHandler } from './utils/chunkReload';
import { detectBrowserLang, getLang, setLang, loadFiExtra } from './utils/i18n';
import './index.css';

// O2: first-visit language auto-detection. Runs only in the browser entry (tests
// render <App/> directly, so they keep the Finnish default) and only on the map
// route, when the visitor has neither a stored choice nor an explicit ?lang — so a
// non-Finnish first-timer isn't dropped into Finnish-only onboarding. A stored
// choice or ?lang always wins (both are applied before this point).
try {
  const hasUrlLang = new URLSearchParams(window.location.search).get('lang');
  if (window.location.pathname === '/' && !localStorage.getItem('lang') && !hasUrlLang) {
    const detected = detectBrowserLang();
    if (detected && detected !== getLang()) void setLang(detected);
  }
} catch { /* localStorage / URL unavailable */ }

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
const DataSourcesPage = lazy(() =>
  // IN-7: await the page-only fi strings (fi-extra.json) alongside the chunk so the
  // page never first-paints raw i18n keys. loadFiExtra never rejects (catch → no-op).
  Promise.all([import('./pages/DataSourcesPage'), loadFiExtra()]).then(([m]) => ({ default: m.DataSourcesPage })));
// PO-14: prerendered public privacy & data-handling notice (FI/EN/SV).
// eslint-disable-next-line react-refresh/only-export-components
const PrivacyPage = lazy(() =>
  Promise.all([import('./pages/PrivacyPage'), loadFiExtra()]).then(([m]) => ({ default: m.PrivacyPage })));

// Apply a freshly-deployed service worker WITHOUT yanking the page out from
// under an active user. The PWA is registered in `prompt` mode (vite.config.ts),
// so a new SW installs and then *waits* — it does not take control (and trigger
// vite-plugin-pwa's built-in force-reload) on its own. onNeedRefresh fires while
// it waits, and we choose when to activate it: only once the tab is hidden, so
// the unavoidable reload never discards draw polygons, notes, or mid-comparison
// work. (Under the previous `autoUpdate` config onNeedRefresh never ran and the
// page reloaded ~tens of seconds into a session, resetting whatever the user was
// doing.) Check for updates every 60 seconds so returning tabs pick up deploys.
let pendingRefresh = false;
const updateSW = registerSW({
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
    // New content available — defer activation until the user isn't actively
    // interacting with the page (tab hidden) to avoid losing unsaved state like
    // draw polygons, notes, or mid-comparison work. updateSW(true) tells the
    // waiting SW to skipWaiting and reloads the page once it takes control, so
    // the user comes back to the fresh version instead of being interrupted.
    if (document.hidden) {
      void updateSW(true);
    } else if (!pendingRefresh) {
      pendingRefresh = true;
      const onVisChange = () => {
        if (document.hidden) {
          document.removeEventListener('visibilitychange', onVisChange);
          void updateSW(true);
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
        {/* Top-level boundary: guards the lazy routes (DataSources, Privacy,
            NotFound) so a chunk-load failure that chunkReload can't recover
            degrades to the localized fallback instead of a blank white page.
            Per-profile-route boundaries below remain for tighter in-place
            recovery. */}
        <ErrorBoundary>
          {/* L3: minimal full-page centered spinner while a route chunk loads,
              so a lazy page navigation shows feedback instead of a blank screen. */}
          <Suspense fallback={
            <div className="fixed inset-0 flex items-center justify-center bg-white dark:bg-surface-950" aria-hidden="true">
              <svg className="w-8 h-8 animate-spin text-surface-500 dark:text-surface-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          }>
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
              <Route path="/tietosuoja" element={<PrivacyPage lang="fi" />} />
              <Route path="/en/privacy" element={<PrivacyPage lang="en" />} />
              <Route path="/sv/integritet" element={<PrivacyPage lang="sv" />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
