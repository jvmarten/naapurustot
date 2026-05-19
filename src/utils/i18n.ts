/**
 * Minimal i18n system. Translations are flat key-value JSON files loaded at build time.
 * Language preference is persisted to localStorage. Use `t('key')` to get a localized string.
 */

import fi from '../locales/fi.json';
import en from '../locales/en.json';
import sv from '../locales/sv.json';

export type Lang = 'fi' | 'en' | 'sv';

const translations: Record<string, Record<Lang, string>> = {};

// Build translations from all locale files. If a key is missing in one
// language, fall back through fi → en → sv (whichever is first defined)
// instead of returning undefined.
const allKeys = new Set([
  ...Object.keys(fi),
  ...Object.keys(en),
  ...Object.keys(sv),
]);
for (const key of allKeys) {
  const fiVal = (fi as Record<string, string>)[key];
  const enVal = (en as Record<string, string>)[key];
  const svVal = (sv as Record<string, string>)[key];
  const fallback = fiVal ?? enVal ?? svVal;
  translations[key] = {
    fi: fiVal ?? fallback,
    en: enVal ?? fallback,
    sv: svVal ?? fallback,
  };
}

let currentLang: Lang = 'fi';
try {
  const stored = localStorage.getItem('lang');
  if (stored === 'fi' || stored === 'en' || stored === 'sv') currentLang = stored;
} catch { /* localStorage unavailable in SSR/tests */ }

export function setLang(lang: Lang) {
  currentLang = lang;
  try { localStorage.setItem('lang', lang); } catch { /* localStorage unavailable */ }
}

export function getLang(): Lang {
  return currentLang;
}

/** Look up a translation by key. Returns the key itself if no translation is found. */
export function t(key: string): string {
  return translations[key]?.[currentLang] ?? key;
}
