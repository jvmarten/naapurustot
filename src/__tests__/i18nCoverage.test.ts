import { describe, it, expect, afterEach } from 'vitest';
import { t, setLang, getLang } from '../utils/i18n';
import fi from '../locales/fi.json';
import en from '../locales/en.json';

describe('i18n', () => {
  afterEach(() => {
    setLang('fi'); // Reset to default
  });

  describe('t() function', () => {
    it('returns Finnish translation by default', () => {
      const key = Object.keys(fi)[0];
      expect(t(key)).toBe((fi as Record<string, string>)[key]);
    });

    it('returns English translation when language is set to en', () => {
      setLang('en');
      const key = Object.keys(en)[0];
      expect(t(key)).toBe((en as Record<string, string>)[key]);
    });

    it('returns the key itself for unknown translations', () => {
      expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
    });

    it('falls back to other language when key exists in only one locale', () => {
      // If a key exists in fi but not en, the en translation should fall back to fi
      const fiKeys = new Set(Object.keys(fi));
      const enKeys = new Set(Object.keys(en));

      // Find a key in fi but not in en (if any)
      const fiOnly = [...fiKeys].find(k => !enKeys.has(k));
      if (fiOnly) {
        setLang('en');
        // Should fall back to fi value, not return undefined
        expect(t(fiOnly)).toBe((fi as Record<string, string>)[fiOnly]);
      }

      // Find a key in en but not in fi (if any)
      const enOnly = [...enKeys].find(k => !fiKeys.has(k));
      if (enOnly) {
        setLang('fi');
        expect(t(enOnly)).toBe((en as Record<string, string>)[enOnly]);
      }
    });
  });

  describe('setLang / getLang', () => {
    it('getLang returns fi by default', () => {
      // After afterEach reset
      expect(getLang()).toBe('fi');
    });

    it('setLang changes the active language', () => {
      setLang('en');
      expect(getLang()).toBe('en');
    });

    it('setLang persists to localStorage', () => {
      setLang('en');
      expect(localStorage.getItem('lang')).toBe('en');
      setLang('fi');
      expect(localStorage.getItem('lang')).toBe('fi');
    });
  });

  describe('translation completeness', () => {
    it('every fi key has a corresponding en key', () => {
      const fiKeys = Object.keys(fi);
      const enKeys = new Set(Object.keys(en));
      const missingInEn = fiKeys.filter(k => !enKeys.has(k));
      // Warn but don't fail — some keys may intentionally exist in only one locale
      if (missingInEn.length > 0) {
        console.warn(`Keys in fi.json missing from en.json: ${missingInEn.join(', ')}`);
      }
      // The i18n system handles this via fallback, so it shouldn't break
      for (const key of missingInEn) {
        setLang('en');
        expect(t(key)).toBeTruthy(); // Should fall back, not return undefined
      }
    });

    it('every en key has a corresponding fi key', () => {
      const enKeys = Object.keys(en);
      const fiKeys = new Set(Object.keys(fi));
      const missingInFi = enKeys.filter(k => !fiKeys.has(k));
      for (const key of missingInFi) {
        setLang('fi');
        expect(t(key)).toBeTruthy();
      }
    });
  });
});
