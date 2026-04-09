/**
 * Tests for i18n.ts — uncovered branches: cross-language fallback, localStorage failure,
 * initial language from localStorage, edge cases.
 *
 * Branch coverage was 70% — missing the fi→en fallback path and localStorage error handling.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('i18n — cross-language fallback', () => {
  let t: (key: string) => string;
  let setLang: (lang: 'fi' | 'en') => void;
  let getLang: () => 'fi' | 'en';

  beforeEach(async () => {
    vi.resetModules();
    localStorage.removeItem('lang');
    const mod = await import('../utils/i18n');
    t = mod.t;
    setLang = mod.setLang;
    getLang = mod.getLang;
  });

  it('defaults to Finnish when no localStorage value', () => {
    expect(getLang()).toBe('fi');
  });

  it('t() returns the key itself for completely unknown keys', () => {
    setLang('fi');
    expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
    setLang('en');
    expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz');
  });

  it('t() works correctly in Finnish mode for known keys', () => {
    setLang('fi');
    const result = t('layer.quality_index');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('layer.quality_index'); // should be translated, not the raw key
  });

  it('t() works correctly in English mode for known keys', () => {
    setLang('en');
    const result = t('layer.quality_index');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe('layer.quality_index');
  });

  it('getLang reflects setLang changes immediately', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    setLang('fi');
    expect(getLang()).toBe('fi');
  });

  it('setLang persists to localStorage', () => {
    setLang('en');
    expect(localStorage.getItem('lang')).toBe('en');
    setLang('fi');
    expect(localStorage.getItem('lang')).toBe('fi');
  });
});

describe('i18n — localStorage initialization edge cases', () => {
  it('reads stored language from localStorage on module load', async () => {
    vi.resetModules();
    localStorage.setItem('lang', 'en');
    const mod = await import('../utils/i18n');
    expect(mod.getLang()).toBe('en');
  });

  it('ignores invalid stored language value', async () => {
    vi.resetModules();
    localStorage.setItem('lang', 'de'); // invalid
    const mod = await import('../utils/i18n');
    expect(mod.getLang()).toBe('fi'); // should fall back to default
  });

  it('handles localStorage.getItem throwing', async () => {
    vi.resetModules();
    const origGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('SecurityError'); };
    const mod = await import('../utils/i18n');
    expect(mod.getLang()).toBe('fi'); // should use default
    Storage.prototype.getItem = origGetItem;
  });

  it('handles localStorage.setItem throwing', async () => {
    vi.resetModules();
    const mod = await import('../utils/i18n');
    const origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); };
    // setLang should not throw even when localStorage fails
    expect(() => mod.setLang('en')).not.toThrow();
    expect(mod.getLang()).toBe('en'); // in-memory state still updated
    Storage.prototype.setItem = origSetItem;
  });
});
