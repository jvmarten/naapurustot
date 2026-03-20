import { describe, it, expect, beforeEach } from 'vitest';
import { t, getLang, setLang, type Lang } from '../utils/i18n';

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
});
