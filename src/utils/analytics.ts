/**
 * Lightweight wrapper around Umami's tracking API.
 * Calls are no-ops when Umami isn't loaded (dev, ad-blockers, etc.).
 */

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number>) => void };
  }
}

export function trackEvent(event: string, data?: Record<string, string | number>) {
  window.umami?.track(event, data);
}
