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

let currentLang: Lang = 'en';

export function setLang(lang: Lang) {
  currentLang = lang;
}

export function getLang(): Lang {
  return currentLang;
}

export function t(key: string): string {
  return translations[key]?.[currentLang] ?? key;
}
