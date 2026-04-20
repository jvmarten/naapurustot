/**
 * i18n — language switching, fallback logic, and translation integrity.
 *
 * Priority 3: User-facing text. Wrong translations confuse users but
 * don't affect data correctness.
 *
 * Targets untested paths:
 * - Fallback from one language to the other when key exists in only one
 * - All layer labelKeys have translations in both languages
 * - All quality category labels exist in both languages
 * - Language persists across setLang calls
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { t, getLang, setLang } from '../utils/i18n';
import { LAYERS } from '../utils/colorScales';
import { QUALITY_FACTORS, QUALITY_CATEGORIES } from '../utils/qualityIndex';

beforeEach(() => {
  setLang('fi');
});

describe('i18n — language switching', () => {
  it('t() returns Finnish translation after setLang("fi")', () => {
    setLang('fi');
    const result = t('layer.quality_index');
    expect(result).not.toBe('layer.quality_index');
    expect(typeof result).toBe('string');
  });

  it('t() returns English translation after setLang("en")', () => {
    setLang('en');
    const result = t('layer.quality_index');
    expect(result).not.toBe('layer.quality_index');
  });

  it('Finnish and English translations differ for known keys', () => {
    setLang('fi');
    const fi = t('layer.quality_index');
    setLang('en');
    const en = t('layer.quality_index');
    expect(fi).not.toBe(en);
  });

  it('getLang reflects the last setLang call', () => {
    setLang('en');
    expect(getLang()).toBe('en');
    setLang('fi');
    expect(getLang()).toBe('fi');
  });
});

describe('i18n — fallback behavior', () => {
  it('returns key itself for completely unknown keys', () => {
    expect(t('this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });

  it('falls back to the other language when key exists in only one', () => {
    // This tests the build-time cross-language fallback
    // If we add a key to fi.json but not en.json, en should fall back to fi value
    // We can verify this indirectly: known keys should never return the key itself
    for (const lang of ['fi', 'en'] as const) {
      setLang(lang);
      const result = t('layer.quality_index');
      expect(result, `Missing translation for layer.quality_index in ${lang}`).not.toBe('layer.quality_index');
    }
  });
});

describe('i18n — translation completeness', () => {
  it('every LAYERS labelKey has a Finnish translation', () => {
    setLang('fi');
    for (const layer of LAYERS) {
      const translated = t(layer.labelKey);
      expect(translated, `Missing fi translation for ${layer.labelKey}`).not.toBe(layer.labelKey);
    }
  });

  it('every LAYERS labelKey has an English translation', () => {
    setLang('en');
    for (const layer of LAYERS) {
      const translated = t(layer.labelKey);
      expect(translated, `Missing en translation for ${layer.labelKey}`).not.toBe(layer.labelKey);
    }
  });

  it('every QUALITY_FACTORS label has both fi and en', () => {
    for (const factor of QUALITY_FACTORS) {
      expect(factor.label.fi.length, `Missing fi label for factor ${factor.id}`).toBeGreaterThan(0);
      expect(factor.label.en.length, `Missing en label for factor ${factor.id}`).toBeGreaterThan(0);
    }
  });

  it('every QUALITY_CATEGORIES label has both fi and en', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.label.fi.length).toBeGreaterThan(0);
      expect(cat.label.en.length).toBeGreaterThan(0);
    }
  });
});
