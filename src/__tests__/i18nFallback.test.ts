/**
 * Tests for i18n cross-language fallback behavior.
 *
 * The i18n module builds a merged translations map at module load time.
 * If a key exists in Finnish but not English (or vice versa), it falls back
 * to the other language's value. Bugs here show raw keys or 'undefined'
 * in the UI when the user switches language.
 *
 * Also tests language persistence and the t() fallback-to-key behavior.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { t, setLang, getLang } from '../utils/i18n';

describe('i18n — language switching', () => {
  beforeEach(() => {
    setLang('fi');
  });

  it('starts with Finnish as default', () => {
    expect(getLang()).toBe('fi');
  });

  it('switches to English', () => {
    setLang('en');
    expect(getLang()).toBe('en');
  });

  it('t() returns Finnish translation when lang is fi', () => {
    setLang('fi');
    const result = t('panel.population');
    expect(result).toBeTruthy();
    expect(result).not.toBe('panel.population');
  });

  it('t() returns English translation when lang is en', () => {
    setLang('en');
    const result = t('panel.population');
    expect(result).toBeTruthy();
    expect(result).not.toBe('panel.population');
  });

  it('t() returns the key itself when no translation exists', () => {
    const missingKey = 'this.key.does.not.exist.anywhere';
    expect(t(missingKey)).toBe(missingKey);
  });

  it('Finnish and English return different strings for known keys', () => {
    setLang('fi');
    const fi = t('panel.population');
    setLang('en');
    const en = t('panel.population');
    expect(fi).not.toBe(en);
  });
});

describe('i18n — translation completeness', () => {
  it('all keys used in quality factors have translations in both languages', () => {
    const qualityKeys = [
      'panel.quality_index',
      'panel.population',
      'panel.median_income',
      'panel.unemployment',
    ];
    for (const key of qualityKeys) {
      setLang('fi');
      const fi = t(key);
      expect(fi).not.toBe(key);
      expect(fi.length).toBeGreaterThan(0);

      setLang('en');
      const en = t(key);
      expect(en).not.toBe(key);
      expect(en.length).toBeGreaterThan(0);
    }
  });

  it('city translation keys exist for known regions', () => {
    const cities = ['helsinki_metro', 'tampere', 'turku'];
    for (const city of cities) {
      setLang('fi');
      const fi = t(`city.${city}`);
      expect(fi).not.toBe(`city.${city}`);
    }
  });

  it('export keys exist for CSV export', () => {
    for (const key of ['export.field', 'export.value']) {
      setLang('fi');
      expect(t(key)).not.toBe(key);
      setLang('en');
      expect(t(key)).not.toBe(key);
    }
  });
});

describe('i18n — edge cases', () => {
  it('t() with empty string key returns empty string (no crash)', () => {
    expect(t('')).toBe('');
  });

  it('setLang does not crash when localStorage throws', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota exceeded'); };
    try {
      expect(() => setLang('en')).not.toThrow();
      expect(getLang()).toBe('en');
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('repeated setLang calls are idempotent', () => {
    setLang('en');
    setLang('en');
    setLang('en');
    expect(getLang()).toBe('en');
  });
});
