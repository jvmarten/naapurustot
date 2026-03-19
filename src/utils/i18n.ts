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
  localStorage.setItem('lang', lang);
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string): string {
  return translations[key]?.[currentLang] ?? key;
}
