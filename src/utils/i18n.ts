/**
 * Minimal i18n. Finnish is bundled (the default locale and an always-available
 * fallback). English and Swedish are loaded lazily via `?url` + fetch so their
 * JSON payloads ship as static assets (dist/assets/*.json) rather than the
 * gzipped JS bundle — required to stay under the CI byte budget.
 *
 * Tests preload `en` and `sv` synchronously via `__testInjectLocale` in
 * src/__tests__/setup.ts, so test assertions that rely on translated strings
 * (e.g. `t('layer.median_income')` in English) work without network I/O.
 */

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

function loadLocale(url: string, target: Dict, promise: Promise<void> | null, reset: () => void): Promise<void> {
  if (promise) return promise;
  const p = fetch(url).then((r) => r.json()).then((d: Dict) => {
    Object.assign(target, d);
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
  currentLang = lang;
  try { localStorage.setItem('lang', lang); } catch { /* unavailable */ }
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

/** TEST ONLY: synchronously inject a locale dict (used by setup.ts). */
export function __testInjectLocale(lang: 'en' | 'sv', data: Dict): void {
  if (lang === 'en') { Object.assign(EN, data); enPromise = Promise.resolve(); }
  else { Object.assign(SV, data); svPromise = Promise.resolve(); }
}
