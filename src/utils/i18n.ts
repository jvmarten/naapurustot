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

export type Lang = 'fi' | 'en' | 'sv';

type Dict = Record<string, string>;
const FI = fi as Dict;
const EN: Dict = {};
const SV: Dict = {};

let enPromise: Promise<void> | null = null;
let svPromise: Promise<void> | null = null;

const subscribers = new Set<() => void>();
let version = 0;
function notify(): void {
  version++;
  for (const fn of subscribers) fn();
}

function loadLocale(url: string, target: Dict, promise: Promise<void> | null, reset: () => void): Promise<void> {
  if (promise) return promise;
  const p = fetch(url).then((r) => r.json()).then((d: Dict) => {
    Object.assign(target, d);
    notify();
  }).catch(() => { reset(); });
  return p;
}

function loadEn(): Promise<void> {
  if (enPromise) return enPromise;
  enPromise = loadLocale(enUrl, EN, enPromise, () => { enPromise = null; });
  return enPromise;
}
function loadSv(): Promise<void> {
  if (svPromise) return svPromise;
  svPromise = loadLocale(svUrl, SV, svPromise, () => { svPromise = null; });
  return svPromise;
}

let currentLang: Lang = 'fi';
try {
  const s = localStorage.getItem('lang');
  if (s === 'fi' || s === 'en' || s === 'sv') currentLang = s;
  if (currentLang === 'en') void loadEn();
  else if (currentLang === 'sv') void loadSv();
} catch { /* localStorage unavailable in SSR/tests */ }

export function setLang(lang: Lang): Promise<void> {
  if (currentLang !== lang) {
    currentLang = lang;
    try { localStorage.setItem('lang', lang); } catch { /* unavailable */ }
    notify();
  }
  if (lang === 'en') return loadEn();
  if (lang === 'sv') return loadSv();
  return Promise.resolve();
}

export function getLang(): Lang { return currentLang; }

/** Look up a translation by key. Returns the key itself if no translation is found. */
export function t(key: string): string {
  if (currentLang === 'sv') return SV[key] ?? FI[key] ?? EN[key] ?? key;
  if (currentLang === 'en') return EN[key] ?? FI[key] ?? key;
  return FI[key] ?? EN[key] ?? key;
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
