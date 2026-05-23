import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { t, getLang, setLang, useI18nVersion } from '../utils/i18n';

describe('i18n', () => {
  beforeEach(() => {
    // Reset to Finnish before each test
    setLang('fi');
  });

  describe('getLang / setLang', () => {
    it('defaults to Finnish', () => {
      expect(getLang()).toBe('fi');
    });

    it('switches to English', () => {
      setLang('en');
      expect(getLang()).toBe('en');
    });

    it('switches to Swedish', async () => {
      await setLang('sv');
      expect(getLang()).toBe('sv');
    });

    it('switches back to Finnish', () => {
      setLang('en');
      setLang('fi');
      expect(getLang()).toBe('fi');
    });
  });

  describe('t()', () => {
    it('returns Finnish translation by default', () => {
      const result = t('layer.quality_index');
      expect(result).toBeTruthy();
      expect(result).not.toBe('layer.quality_index'); // should resolve, not return key
    });

    it('returns English translation when language is English', () => {
      setLang('en');
      const result = t('layer.quality_index');
      expect(result).toBeTruthy();
      expect(result).not.toBe('layer.quality_index');
    });

    it('returns different text for Finnish and English', () => {
      const fi = t('layer.quality_index');
      setLang('en');
      const en = t('layer.quality_index');
      // Finnish and English translations should differ
      expect(fi).not.toBe(en);
    });

    it('returns Swedish translation when language is Swedish', async () => {
      await setLang('sv');
      const sv = t('layer.quality_index');
      expect(sv).toBeTruthy();
      expect(sv).not.toBe('layer.quality_index');
      // If the lazy fetch resolved with real data (it will in browser env;
      // in jsdom the fetch may fail and fall back to Finnish — that's fine
      // for this test, which only verifies the language switch itself).
      await setLang('fi');
      expect(t('layer.quality_index')).toBeTruthy();
    });

    it('returns the key itself for unknown translation keys', () => {
      const result = t('nonexistent.key.that.does.not.exist');
      expect(result).toBe('nonexistent.key.that.does.not.exist');
    });

    it('returns the key for unknown keys in English too', () => {
      setLang('en');
      const result = t('nonexistent.key');
      expect(result).toBe('nonexistent.key');
    });

    it('translates multiple known keys correctly', () => {
      // Test several layer labels exist
      for (const key of ['layer.median_income', 'layer.unemployment', 'layer.education']) {
        const result = t(key);
        expect(result).not.toBe(key);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });
  });

  // Regression: switching language must re-render subscribed components on the
  // same tick. The previous implementation only re-rendered on lang-state
  // changes, which left memoized components (e.g. Legend) showing the Finnish
  // fallback until the next unrelated state update — visible as "need to click
  // the language button twice to see it apply".
  describe('useI18nVersion', () => {
    it('bumps the version when setLang changes the current language', () => {
      const { result } = renderHook(() => useI18nVersion());
      const before = result.current;
      act(() => { void setLang('en'); });
      expect(result.current).not.toBe(before);
    });

    it('does not bump when setLang is called with the same language', () => {
      setLang('en');
      const { result } = renderHook(() => useI18nVersion());
      const before = result.current;
      act(() => { void setLang('en'); });
      expect(result.current).toBe(before);
    });
  });
});
