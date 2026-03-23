/**
 * Layer configuration consistency tests.
 *
 * Every layer on the map depends on having valid config. A mismatch between
 * colors[] and stops[] lengths would cause rendering artifacts or crashes.
 * Missing translations would show raw keys to users.
 */
import { describe, it, expect } from 'vitest';
import { LAYERS, getLayerById, getColorForValue, buildFillColorExpression } from '../utils/colorScales';
import type { LayerId } from '../utils/colorScales';
import { setLang as _setLang } from '../utils/i18n';
import fi from '../locales/fi.json';
import en from '../locales/en.json';

describe('Layer configuration consistency', () => {
  it('every layer has colors and stops arrays of the same length', () => {
    for (const layer of LAYERS) {
      expect(
        layer.colors.length,
        `Layer "${layer.id}" has ${layer.colors.length} colors but ${layer.stops.length} stops`,
      ).toBe(layer.stops.length);
    }
  });

  it('every layer has at least 2 color stops', () => {
    for (const layer of LAYERS) {
      expect(
        layer.stops.length,
        `Layer "${layer.id}" needs at least 2 stops for interpolation`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it('stops are in ascending order for every layer', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(
          layer.stops[i],
          `Layer "${layer.id}" stop[${i}]=${layer.stops[i]} should be > stop[${i - 1}]=${layer.stops[i - 1]}`,
        ).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });

  it('every color is a valid hex color string', () => {
    const hexRegex = /^#[0-9a-fA-F]{3,8}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(
          hexRegex.test(color),
          `Layer "${layer.id}" has invalid color "${color}"`,
        ).toBe(true);
      }
    }
  });

  it('every layer has a Finnish translation for its labelKey', () => {
    const fiTranslations = fi as Record<string, string>;
    for (const layer of LAYERS) {
      expect(
        fiTranslations[layer.labelKey],
        `Layer "${layer.id}" labelKey "${layer.labelKey}" missing in fi.json`,
      ).toBeDefined();
    }
  });

  it('every layer has an English translation for its labelKey', () => {
    const enTranslations = en as Record<string, string>;
    for (const layer of LAYERS) {
      expect(
        enTranslations[layer.labelKey],
        `Layer "${layer.id}" labelKey "${layer.labelKey}" missing in en.json`,
      ).toBeDefined();
    }
  });

  it('every layer ID is unique', () => {
    const ids = LAYERS.map((l) => l.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  it('every layer has a non-empty property name', () => {
    for (const layer of LAYERS) {
      expect(layer.property.length, `Layer "${layer.id}" has empty property`).toBeGreaterThan(0);
    }
  });

  it('format function does not throw for typical values in each layer', () => {
    for (const layer of LAYERS) {
      // Test with mid-range value
      const mid = (layer.stops[0] + layer.stops[layer.stops.length - 1]) / 2;
      expect(() => layer.format(mid)).not.toThrow();
      // Test with zero
      expect(() => layer.format(0)).not.toThrow();
      // Test with negative
      expect(() => layer.format(-10)).not.toThrow();
    }
  });

  it('getLayerById returns correct layer for every valid ID', () => {
    for (const layer of LAYERS) {
      const retrieved = getLayerById(layer.id);
      expect(retrieved.id).toBe(layer.id);
      expect(retrieved.property).toBe(layer.property);
    }
  });

  it('getLayerById returns fallback layer for invalid ID', () => {
    const result = getLayerById('nonexistent_layer' as LayerId);
    // Should fall back to LAYERS[0] instead of crashing
    expect(result.id).toBe(LAYERS[0].id);
  });

  it('getColorForValue returns a valid color for every layer at each stop value', () => {
    for (const layer of LAYERS) {
      for (const stop of layer.stops) {
        const color = getColorForValue(layer, stop);
        expect(color, `Layer "${layer.id}" at stop ${stop}`).toMatch(/^#[0-9a-fA-F]+$/);
      }
    }
  });

  it('buildFillColorExpression produces valid expression structure for every layer', () => {
    for (const layer of LAYERS) {
      const expr = buildFillColorExpression(layer) as unknown[];
      // Should be ['case', condition, interpolation, fallbackColor]
      expect(expr[0]).toBe('case');
      expect(expr[expr.length - 1]).toBe('#d1d5db'); // fallback gray
    }
  });
});

describe('Layer translation completeness', () => {
  it('Finnish and English translations have the same keys', () => {
    const fiKeys = new Set(Object.keys(fi));
    const enKeys = new Set(Object.keys(en));

    const onlyInFi = [...fiKeys].filter((k) => !enKeys.has(k));
    const onlyInEn = [...enKeys].filter((k) => !fiKeys.has(k));

    expect(onlyInFi, `Keys only in fi.json: ${onlyInFi.join(', ')}`).toHaveLength(0);
    expect(onlyInEn, `Keys only in en.json: ${onlyInEn.join(', ')}`).toHaveLength(0);
  });
});
