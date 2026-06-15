/**
 * Minimal i18n. Finnish is bundled (the default locale and an always-available
 * fallback). English and Swedish are loaded lazily via `?url` + fetch so their
 * JSON payloads ship as static assets (dist/assets/*.json) rather than the
 * gzipped JS bundle — required to stay under the CI byte budget.
 *
 * Tests preload `en` and `sv` synchronously via `__testInjectLocale` in
 * src/__tests__/setup.ts, so test assertions that rely on translated strings
 * (e.g. `t('layer.median_income')` in English) work without network I/O.
 *
 * Re-render contract: components that call `t()` in their render and are
 * wrapped in `React.memo` must also call `useI18nVersion()` so they re-render
 * both when the user switches language AND when the lazy-loaded dictionary
 * finishes arriving — otherwise they keep showing the Finnish fallback that
 * was returned before the fetch resolved.
 */

import { useSyncExternalStore } from 'react';
import fi from '../locales/fi.json';
import enUrl from '../locales/en.json?url';
import svUrl from '../locales/sv.json?url';
// IN-7: page-only Finnish strings (data-sources + privacy bodies) split off the
// always-bundled fi.json into a lazy ?url asset, loaded on demand by the two
// lazy pages that render them — reclaims ~2 KB gz off the always-loaded chunk.
import fiExtraUrl from '../locales/fi-extra.json?url';

export type Lang = 'fi' | 'en' | 'sv';

type Dict = Record<string, string>;
const FI = fi as Dict;
const EN: Dict = {};
const SV: Dict = {};
const FI_EXTRA: Dict = {};

let enPromise: Promise<void> | null = null;
let svPromise: Promise<void> | null = null;
let fiExtraPromise: Promise<void> | null = null;

/** Lang whose dictionary fetch failed (so a banner can offer a retry), else null. */
let loadError: Lang | null = null;

const subscribers = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  for (const fn of subscribers) fn();
}

function loadLocale(lang: Lang, url: string, target: Dict, reset: () => void): Promise<void> {
  const p = fetch(url).then((r) => r.json()).then((d: Dict) => {
    Object.assign(target, d);
    loadError = null;
    notify();
  }).catch(() => {
    reset();
    loadError = lang;
    notify();
  });
  return p;
}

function loadEn(): Promise<void> {
  if (enPromise) return enPromise;
  enPromise = loadLocale('en', enUrl, EN, () => { enPromise = null; });
  return enPromise;
}
function loadSv(): Promise<void> {
  if (svPromise) return svPromise;
  svPromise = loadLocale('sv', svUrl, SV, () => { svPromise = null; });
  return svPromise;
}

/**
 * IN-7: lazily fetch the page-only Finnish strings (data-sources + privacy
 * bodies). Called by the two lazy pages that render them. Core-map keys stay in
 * the synchronous FI dict, so the map never shows a raw key while this resolves.
 * A failed fetch is a silent no-op (these strings live on two secondary pages
 * only) and deliberately does NOT touch the global loadError/retry path, which
 * exists for the en/sv UI dictionaries.
 */
export function loadFiExtra(): Promise<void> {
  if (fiExtraPromise) return fiExtraPromise;
  fiExtraPromise = fetch(fiExtraUrl)
    .then((r) => r.json())
    .then((d: Dict) => { Object.assign(FI_EXTRA, d); notify(); })
    .catch(() => { fiExtraPromise = null; });
  return fiExtraPromise;
}

let currentLang: Lang = 'fi';
try {
  const s = localStorage.getItem('lang');
  if (s === 'fi' || s === 'en' || s === 'sv') currentLang = s;
  if (currentLang === 'en') void loadEn();
  else if (currentLang === 'sv') void loadSv();
} catch { /* localStorage unavailable in SSR/tests */ }

/**
 * Switch the UI language. Persists the choice to localStorage ('lang'), notifies
 * subscribers, and kicks off the lazy dictionary fetch for en/sv. The returned
 * promise settles when that load finishes and resolves even if the fetch fails
 * (it never rejects — check getLocaleLoadError instead).
 */
export function setLang(lang: Lang): Promise<void> {
  if (currentLang !== lang) {
    currentLang = lang;
    try { localStorage.setItem('lang', lang); } catch { /* unavailable */ }
    notify();
  }
  if (lang === 'en') return loadEn();
  if (lang === 'sv') return loadSv();
  // Finnish is always bundled, so switching to it clears any pending load error.
  if (loadError !== null) { loadError = null; notify(); }
  return Promise.resolve();
}

export function getLang(): Lang { return currentLang; }

/**
 * O2: pick a supported UI language from the browser's preferred languages, or null
 * if none match (caller falls back to the Finnish default). Returns the first of
 * `navigator.languages` whose two-letter code is one we support. Pure read — it does
 * not mutate currentLang; the browser entry (main.tsx) decides whether to apply it,
 * so tests that render <App/> directly are unaffected.
 */
export function detectBrowserLang(): Lang | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const prefs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const pref of prefs) {
      const code = (pref || '').toLowerCase().slice(0, 2);
      if (code === 'fi' || code === 'en' || code === 'sv') return code;
    }
  } catch { /* navigator unavailable */ }
  return null;
}

/** Lang whose dictionary fetch failed (so a banner can offer a retry), else null. */
export function getLocaleLoadError(): Lang | null { return loadError; }

/**
 * Retry a failed lazy dictionary load: clears the failed lang's cached promise
 * and the error flag, then re-invokes the loader for the current lang.
 */
export function retryLocaleLoad(): void {
  if (currentLang === 'en') enPromise = null;
  else if (currentLang === 'sv') svPromise = null;
  loadError = null;
  if (currentLang === 'en') void loadEn();
  else if (currentLang === 'sv') void loadSv();
  notify();
}

/** Look up a translation by key. Returns the key itself if no translation is found. */
export function t(key: string): string {
  if (currentLang === 'sv') return SV[key] ?? EN[key] ?? FI[key] ?? FI_EXTRA[key] ?? key;
  if (currentLang === 'en') return EN[key] ?? FI[key] ?? FI_EXTRA[key] ?? key;
  return FI[key] ?? FI_EXTRA[key] ?? EN[key] ?? key;
}

function subscribeI18n(fn: () => void): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
function getI18nVersion(): number { return version; }
function getServerI18nVersion(): number { return 0; }

/**
 * Subscribe a component to i18n changes. Returns the current version (which
 * bumps on language switches and on lazy-loaded dictionary arrivals). The
 * value itself is rarely useful — calling the hook is enough to register
 * the component for re-render. `React.memo` components that call `t()` in
 * their render must call this hook to avoid showing stale Finnish fallback
 * after an async dictionary load.
 */
export function useI18nVersion(): number {
  return useSyncExternalStore(subscribeI18n, getI18nVersion, getServerI18nVersion);
}

/** TEST ONLY: synchronously inject a locale dict (used by setup.ts). */
export function __testInjectLocale(lang: 'en' | 'sv', data: Dict): void {
  if (lang === 'en') { Object.assign(EN, data); enPromise = Promise.resolve(); }
  else { Object.assign(SV, data); svPromise = Promise.resolve(); }
}

/** TEST ONLY: synchronously inject the fi-extra page dict (used by setup.ts). */
export function __testInjectFiExtra(data: Dict): void {
  Object.assign(FI_EXTRA, data); fiExtraPromise = Promise.resolve();
}
