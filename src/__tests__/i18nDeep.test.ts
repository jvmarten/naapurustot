import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need a fresh module for each test to reset state
describe('i18n deep tests', () => {
  let t: (key: string) => string;
  let setLang: (lang: string) => void;

  beforeEach(async () => {
    vi.resetModules();
    // Clear localStorage
    localStorage.removeItem('lang');
    const mod = await import('../utils/i18n');
    t = mod.t;
    setLang = mod.setLang;
  });

  it('returns the key for missing translation in Finnish', () => {
    setLang('fi');
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('returns the key for missing translation in English', () => {
    setLang('en');
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('persists language to localStorage', () => {
    setLang('en');
    expect(localStorage.getItem('lang')).toBe('en');
    setLang('fi');
    expect(localStorage.getItem('lang')).toBe('fi');
  });

  it('translation for same key differs between languages', () => {
    setLang('fi');
    const fi = t('layer.median_income');
    setLang('en');
    const en = t('layer.median_income');
    // Finnish and English should be different
    expect(fi).not.toBe(en);
  });

  it('switching languages updates all subsequent t() calls', () => {
    setLang('fi');
    const fi1 = t('layer.quality_index');
    setLang('en');
    const en1 = t('layer.quality_index');
    setLang('fi');
    const fi2 = t('layer.quality_index');
    expect(fi1).toBe(fi2);
    expect(fi1).not.toBe(en1);
  });

  it('handles empty string key', () => {
    expect(t('')).toBe('');
  });
});
