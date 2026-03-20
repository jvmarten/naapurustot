import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setColorblindMode,
  getColorblindMode,
  getLayerById,
  LAYERS,
  type ColorblindType,
} from '../utils/colorScales';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('colorblind mode', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  describe('setColorblindMode / getColorblindMode', () => {
    it('defaults to off after reset', () => {
      expect(getColorblindMode()).toBe('off');
    });

    it('sets protanopia mode', () => {
      setColorblindMode('protanopia');
      expect(getColorblindMode()).toBe('protanopia');
    });

    it('sets deuteranopia mode', () => {
      setColorblindMode('deuteranopia');
      expect(getColorblindMode()).toBe('deuteranopia');
    });

    it('sets tritanopia mode', () => {
      setColorblindMode('tritanopia');
      expect(getColorblindMode()).toBe('tritanopia');
    });

    it('switches back to off', () => {
      setColorblindMode('protanopia');
      setColorblindMode('off');
      expect(getColorblindMode()).toBe('off');
    });
  });

  describe('getLayerById with colorblind mode', () => {
    it('returns original colors when mode is off', () => {
      const layer = getLayerById('quality_index');
      const original = LAYERS.find((l) => l.id === 'quality_index')!;
      expect(layer.colors).toEqual(original.colors);
    });

    it('returns substituted colors when protanopia is active', () => {
      setColorblindMode('protanopia');
      const layer = getLayerById('quality_index');
      const original = LAYERS.find((l) => l.id === 'quality_index')!;
      expect(layer.colors).not.toEqual(original.colors);
      expect(layer.colors.length).toBe(original.colors.length);
    });

    it('returns substituted colors when deuteranopia is active', () => {
      setColorblindMode('deuteranopia');
      const layer = getLayerById('median_income');
      const original = LAYERS.find((l) => l.id === 'median_income')!;
      expect(layer.colors).not.toEqual(original.colors);
      expect(layer.colors.length).toBe(original.colors.length);
    });

    it('returns substituted colors when tritanopia is active', () => {
      setColorblindMode('tritanopia');
      const layer = getLayerById('unemployment');
      const original = LAYERS.find((l) => l.id === 'unemployment')!;
      expect(layer.colors).not.toEqual(original.colors);
      expect(layer.colors.length).toBe(original.colors.length);
    });

    it('preserves non-color properties when mode is active', () => {
      setColorblindMode('protanopia');
      const layer = getLayerById('quality_index');
      const original = LAYERS.find((l) => l.id === 'quality_index')!;
      expect(layer.id).toBe(original.id);
      expect(layer.property).toBe(original.property);
      expect(layer.stops).toEqual(original.stops);
      expect(layer.labelKey).toBe(original.labelKey);
    });

    it('produces valid hex colors in colorblind mode', () => {
      const hexRegex = /^#[0-9a-f]{6}$/;
      for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as ColorblindType[]) {
        setColorblindMode(mode);
        const layer = getLayerById('quality_index');
        for (const color of layer.colors) {
          expect(color).toMatch(hexRegex);
        }
      }
    });

    it('handles layers with different stop counts (resampling)', () => {
      // unemployment has 10 stops, palettes have 8 — forces resampling
      setColorblindMode('protanopia');
      const layer = getLayerById('unemployment');
      const original = LAYERS.find((l) => l.id === 'unemployment')!;
      expect(layer.colors.length).toBe(original.colors.length); // 10
      expect(original.colors.length).toBe(10); // confirm > 8
    });
  });
});
