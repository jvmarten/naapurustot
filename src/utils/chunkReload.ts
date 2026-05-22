// Recover from stale chunk references after a deployment.
//
// Each production build hashes its JS chunk filenames. A tab still running an
// older build holds references to the old names; after a deploy those files no
// longer exist, so the next dynamic import (a lazy panel, a profile route, a
// Turf module) rejects with "Importing a module script failed" / "Failed to
// fetch dynamically imported module" and surfaces as an uncaught error — seen
// in Sentry from long-lived mobile tabs. Vite dispatches a cancelable
// `vite:preloadError` event for exactly this failure; reloading pulls a fresh
// index.html with up-to-date chunk references.

const RELOAD_MARK_KEY = 'naapurustot:chunk-reload-at';

// A reload that does not fix the import fails again within seconds; only
// reattempt recovery once the page has stayed up longer than this.
const RELOAD_COOLDOWN_MS = 10_000;

// Record a recovery reload and report whether one is allowed now. Returns false
// when the page already reloaded within the cooldown — a repeat failure that
// fast is not a stale deploy, so the error is left to surface instead of
// looping — or when sessionStorage is unavailable and a loop cannot be ruled out.
function claimReload(now: number): boolean {
  try {
    const lastReload = Number(sessionStorage.getItem(RELOAD_MARK_KEY)) || 0;
    if (now - lastReload < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_MARK_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

// Reload once when a dynamic import fails so the page picks up fresh chunk
// references after a deployment. Call once at startup; returns a disposer.
export function installChunkReloadHandler(): () => void {
  let reloading = false;
  const onPreloadError = (event: Event) => {
    if (reloading) {
      // A reload from an earlier failed import this page load is already in
      // flight — swallow the rest of the burst.
      event.preventDefault();
      return;
    }
    if (!claimReload(Date.now())) return;
    reloading = true;
    // Suppress the otherwise-uncaught error — the page is about to reload.
    event.preventDefault();
    window.location.reload();
  };
  window.addEventListener('vite:preloadError', onPreloadError);
  return () => window.removeEventListener('vite:preloadError', onPreloadError);
}
