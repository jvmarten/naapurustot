/**
 * Minimal i18n system. Translations are flat key-value JSON files loaded at build time.
 * Language preference is persisted to localStorage. Use `t('key')` to get a localized string.
 */

import fi from '../locales/fi.json';
import en from '../locales/en.json';

export type Lang = 'fi' | 'en';

const translations: Record<string, Record<Lang, string>> = {};

// Build translations from both locale files. If a key is missing in one
// language, fall back to the other language's value instead of undefined.
const allKeys = new Set([...Object.keys(fi), ...Object.keys(en)]);
for (const key of allKeys) {
  const fiVal = (fi as Record<string, string>)[key];
  const enVal = (en as Record<string, string>)[key];
  translations[key] = {
    fi: fiVal ?? enVal,
    en: enVal ?? fiVal,
  };
}

let currentLang: Lang = 'fi';
try {
  const stored = localStorage.getItem('lang');
  if (stored === 'fi' || stored === 'en') currentLang = stored;
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
