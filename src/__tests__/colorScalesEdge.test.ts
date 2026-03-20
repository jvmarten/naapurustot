import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LAYERS,
  getLayerById,
  getColorForValue,
  buildFillColorExpression,
  setColorblindMode,
  getColorblindMode,
  type LayerId,
} from '../utils/colorScales';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('colorScales edge cases', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  describe('getColorForValue boundary behavior', () => {
    it('returns first color for values below lowest stop', () => {
      const layer = LAYERS.find((l) => l.id === 'median_income')!;
      // Below first stop (15000)
      const color = getColorForValue(layer, 10000);
      expect(color).toBe(layer.colors[0]);
    });

    it('returns last color for values at or above highest stop', () => {
      const layer = LAYERS.find((l) => l.id === 'median_income')!;
      const color = getColorForValue(layer, 60000);
      expect(color).toBe(layer.colors[layer.colors.length - 1]);
    });

    it('returns gray (#333) for null value', () => {
      const layer = LAYERS[0];
      expect(getColorForValue(layer, null)).toBe('#333');
      expect(getColorForValue(layer, undefined)).toBe('#333');
    });

    it('returns correct color at exact stop boundary', () => {
      const layer = LAYERS.find((l) => l.id === 'median_income')!;
      // At exactly a stop value
      const color = getColorForValue(layer, layer.stops[3]);
      expect(color).toBe(layer.colors[3]);
    });

    it('handles negative values (e.g., change layers)', () => {
      const layer = LAYERS.find((l) => l.id === 'income_change')!;
      const color = getColorForValue(layer, -20);
      expect(typeof color).toBe('string');
      expect(color.startsWith('#')).toBe(true);
    });

    it('handles zero value', () => {
      const layer = LAYERS.find((l) => l.id === 'quality_index')!;
      const color = getColorForValue(layer, 0);
      expect(color).toBe(layer.colors[0]);
    });
  });

  describe('getLayerById', () => {
    it('returns first layer for unknown ID', () => {
      const layer = getLayerById('nonexistent_layer_id' as LayerId);
      expect(layer.id).toBe(LAYERS[0].id);
    });

    it('returns correct layer for valid ID', () => {
      const layer = getLayerById('unemployment');
      expect(layer.id).toBe('unemployment');
      expect(layer.property).toBe('unemployment_rate');
    });

    it('applies colorblind palette when mode is set', () => {
      const originalLayer = LAYERS.find((l) => l.id === 'median_income')!;
      const originalColors = [...originalLayer.colors];

      setColorblindMode('protanopia');
      const cbLayer = getLayerById('median_income');

      // Colors should be different (colorblind-safe palette)
      expect(cbLayer.colors).not.toEqual(originalColors);
      // But stops and property should be the same
      expect(cbLayer.stops).toEqual(originalLayer.stops);
      expect(cbLayer.property).toBe(originalLayer.property);
    });

    it('returns original colors when colorblind mode is off', () => {
      setColorblindMode('off');
      const layer = getLayerById('median_income');
      const originalLayer = LAYERS.find((l) => l.id === 'median_income')!;
      expect(layer.colors).toEqual(originalLayer.colors);
    });
  });

  describe('buildFillColorExpression', () => {
    it('produces valid MapLibre expression structure', () => {
      const layer = LAYERS[0];
      const expr = buildFillColorExpression(layer) as unknown[];

      // Should be a 'case' expression
      expect(expr[0]).toBe('case');
      // Should have a condition, interpolation, and fallback color
      expect(expr.length).toBe(4);
      // Fallback color should be gray
      expect(expr[3]).toBe('#d1d5db');
    });

    it('includes all stops in the interpolation', () => {
      const layer = LAYERS.find((l) => l.id === 'median_income')!;
      const expr = buildFillColorExpression(layer) as unknown[];
      // The interpolation is expr[2], which starts with ['interpolate', ...]
      const interpolation = expr[2] as unknown[];
      // Should contain: 'interpolate', ['linear'], ['get', property], ...stop-color pairs
      expect(interpolation[0]).toBe('interpolate');
      // Each stop has a value + color pair = 2 * stops.length entries after the header
      const pairsCount = (interpolation.length - 3) / 2;
      expect(pairsCount).toBe(layer.stops.length);
    });
  });

  describe('LAYERS consistency', () => {
    it('all layers have matching colors and stops array lengths', () => {
      for (const layer of LAYERS) {
        expect(layer.colors.length).toBe(layer.stops.length);
      }
    });

    it('all layers have monotonically increasing stops', () => {
      for (const layer of LAYERS) {
        for (let i = 1; i < layer.stops.length; i++) {
          expect(layer.stops[i]).toBeGreaterThan(layer.stops[i - 1]);
        }
      }
    });

    it('all layers have valid hex color values', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const layer of LAYERS) {
        for (const color of layer.colors) {
          expect(color).toMatch(hexRegex);
        }
      }
    });

    it('all layer format functions produce strings', () => {
      for (const layer of LAYERS) {
        const result = layer.format(42);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    it('all layers have unique IDs', () => {
      const ids = LAYERS.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('colorblind mode persistence', () => {
    it('cycles through all colorblind modes', () => {
      const modes = ['off', 'protanopia', 'deuteranopia', 'tritanopia'] as const;
      for (const mode of modes) {
        setColorblindMode(mode);
        expect(getColorblindMode()).toBe(mode);
      }
    });

    it('produces different palettes for each colorblind type', () => {
      const palettes: Record<string, string[]> = {};
      for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
        setColorblindMode(mode);
        const layer = getLayerById('median_income');
        palettes[mode] = layer.colors;
      }
      // All three should be different
      expect(palettes.protanopia).not.toEqual(palettes.deuteranopia);
      expect(palettes.protanopia).not.toEqual(palettes.tritanopia);
      expect(palettes.deuteranopia).not.toEqual(palettes.tritanopia);
    });
  });
});
