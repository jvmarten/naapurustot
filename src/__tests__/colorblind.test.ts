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

  describe('diverging vs sequential colorblind palettes (A4)', () => {
    // Chroma (max-min channel) ~0 means a near-neutral grey; hue measured as red-blue warmth.
    const rgb = (hex: string) => {
      const c = parseInt(hex.slice(1), 16);
      return { r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff };
    };
    const chroma = (hex: string) => {
      const { r, g, b } = rgb(hex);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    const warmth = (hex: string) => {
      const { r, b } = rgb(hex);
      return r - b;
    };

    const modes: ColorblindType[] = ['protanopia', 'deuteranopia', 'tritanopia'];

    it('diverging layer keeps a near-neutral grey center with hue-distinct ends in every CB mode', () => {
      for (const mode of modes) {
        setColorblindMode(mode);
        const layer = getLayerById('income_change');
        const original = LAYERS.find((l) => l.id === 'income_change')!;
        expect(layer.colors.length).toBe(original.colors.length);
        // The greyest (lowest-chroma) stop must sit at the center, not an end.
        const chromas = layer.colors.map(chroma);
        const greyest = chromas.indexOf(Math.min(...chromas));
        const lastIdx = layer.colors.length - 1;
        expect(greyest).toBeGreaterThan(0);
        expect(greyest).toBeLessThan(lastIdx);
        const mid = Math.floor(lastIdx / 2);
        expect(Math.abs(greyest - mid)).toBeLessThanOrEqual(1);
        // The two ends are genuinely different hues (one warm, one cool).
        expect(chroma(layer.colors[0])).toBeGreaterThan(chroma(layer.colors[greyest]));
        expect(chroma(layer.colors[lastIdx])).toBeGreaterThan(chroma(layer.colors[greyest]));
        expect(Math.sign(warmth(layer.colors[0]))).not.toBe(Math.sign(warmth(layer.colors[lastIdx])));
      }
    });

    it('preserves each diverging layer\'s polarity (warm/cool direction) under CB substitution', () => {
      setColorblindMode('deuteranopia');
      for (const id of ['income_change', 'unemployment_change'] as const) {
        const layer = getLayerById(id);
        const original = LAYERS.find((l) => l.id === id)!;
        // Same warm→cool vs cool→warm direction as the original ramp.
        const origDir = Math.sign(warmth(original.colors[0]) - warmth(original.colors[original.colors.length - 1]));
        const cbDir = Math.sign(warmth(layer.colors[0]) - warmth(layer.colors[layer.colors.length - 1]));
        expect(cbDir).toBe(origDir);
      }
    });

    it('sequential layer still uses the sequential CB palette (no grey center)', () => {
      for (const mode of modes) {
        setColorblindMode(mode);
        const layer = getLayerById('quality_index');
        const original = LAYERS.find((l) => l.id === 'quality_index')!;
        expect(layer.colors).not.toEqual(original.colors);
        expect(layer.colors.length).toBe(original.colors.length);
        // Sequential CB palettes ramp monotonically; the center is not the greyest stop.
        const chromas = layer.colors.map(chroma);
        const greyest = chromas.indexOf(Math.min(...chromas));
        const mid = Math.floor((layer.colors.length - 1) / 2);
        expect(greyest).not.toBe(mid);
      }
    });
  });
});
