/**
 * Minimal i18n system. Translations are flat key-value JSON files loaded at build time.
 * Language preference is persisted to localStorage. Use `t('key')` to get a localized string.
 */

import fi from '../locales/fi.json';
import en from '../locales/en.json';

export type Lang = 'fi' | 'en';

const translations: Record<string, Record<Lang, string>> = {};

for (const key of Object.keys(fi) as (keyof typeof fi)[]) {
  translations[key] = {
    fi: fi[key],
    en: en[key as keyof typeof en],
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
