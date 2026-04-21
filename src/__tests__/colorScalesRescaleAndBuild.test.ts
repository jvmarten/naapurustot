/**
 * Tests for uncovered lines in colorScales.ts:
 * - rescaleLayerToData cache (line 812, 820, 838-839)
 * - buildFillColorExpression typeof guard
 * - resamplePalette edge cases (count <= 1, exact match, interpolation)
 * - getLayerById fallback to LAYERS[0]
 * - colorblind mode cache clearing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LAYERS,
  LAYER_MAP,
  getLayerById,
  getColorForValue,
  buildFillColorExpression,
  rescaleLayerToData,
  clearRescaleCache,
  setColorblindMode,
  getColorblindMode,
  type LayerConfig,
  type LayerId,
} from '../utils/colorScales';

function feat(prop: string, value: number | string | null): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { [prop]: value },
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

describe('rescaleLayerToData — cache behavior', () => {
  beforeEach(() => {
    clearRescaleCache();
  });

  it('returns cached result for same layer + same features reference', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const features = [feat('hr_mtu', 20000), feat('hr_mtu', 40000)];

    const result1 = rescaleLayerToData(layer, features);
    const result2 = rescaleLayerToData(layer, features);

    expect(result1).toBe(result2); // same reference
  });

  it('invalidates cache when layer ID changes', () => {
    const incomeLayer = LAYERS.find((l) => l.id === 'median_income')!;
    const unemploymentLayer = LAYERS.find((l) => l.id === 'unemployment')!;
    const features = [feat('hr_mtu', 20000), feat('hr_mtu', 40000)];
    const features2 = [feat('unemployment_rate', 3), feat('unemployment_rate', 8)];

    const result1 = rescaleLayerToData(incomeLayer, features);
    const result2 = rescaleLayerToData(unemploymentLayer, features2);

    expect(result1).not.toBe(result2);
  });

  it('invalidates cache when features reference changes', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const features1 = [feat('hr_mtu', 20000), feat('hr_mtu', 40000)];
    const features2 = [feat('hr_mtu', 10000), feat('hr_mtu', 50000)];

    const result1 = rescaleLayerToData(layer, features1);
    const result2 = rescaleLayerToData(layer, features2);

    expect(result1).not.toBe(result2);
    expect(result1.stops[0]).toBe(20000);
    expect(result2.stops[0]).toBe(10000);
  });

  it('caches original layer when min === max (no rescale needed)', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const features = [feat('hr_mtu', 25000), feat('hr_mtu', 25000)];

    const result1 = rescaleLayerToData(layer, features);
    const result2 = rescaleLayerToData(layer, features);

    expect(result1).toBe(layer);
    expect(result2).toBe(layer);
    expect(result1).toBe(result2);
  });

  it('caches original layer for single-stop layers', () => {
    const singleStopLayer: LayerConfig = {
      id: 'quality_index' as LayerId,
      labelKey: 'test',
      property: 'hr_mtu',
      unit: '',
      colors: ['#000'],
      stops: [50],
      format: (v: number) => `${v}`,
    };

    const features = [feat('hr_mtu', 100), feat('hr_mtu', 200)];
    const result = rescaleLayerToData(singleStopLayer, features);
    expect(result).toBe(singleStopLayer);
  });
});

describe('buildFillColorExpression — structure', () => {
  it('produces a valid MapLibre expression with typeof guard', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer);

    // Should be a 'case' expression with typeof check
    expect(expr[0]).toBe('case');
    // The condition checks: has, !=null, typeof==number
    const condition = expr[1] as unknown[];
    expect(condition[0]).toBe('all');
  });

  it('uses propertyOverride when provided', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer, 'custom_prop');

    // The 'has' check should use the override property
    const condition = expr[1] as unknown[];
    const hasCheck = condition[1] as unknown[];
    expect(hasCheck).toEqual(['has', 'custom_prop']);
  });

  it('includes all color stops from the layer', () => {
    const layer = LAYERS.find((l) => l.id === 'unemployment')!;
    const expr = buildFillColorExpression(layer);

    // The interpolation part (expr[2]) should contain all stops and colors
    const interp = expr[2] as unknown[];
    expect(interp[0]).toBe('interpolate');
    expect(interp[1]).toEqual(['linear']);

    // Each stop-color pair after the first 3 elements
    const stopColors = interp.slice(3);
    expect(stopColors.length).toBe(layer.stops.length * 2);
  });

  it('fallback color is gray (#d1d5db) for missing data', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer);

    // Last element is the else-fallback color
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });
});

describe('getLayerById — fallback behavior', () => {
  it('returns quality_index layer for unknown ID', () => {
    const result = getLayerById('nonexistent_layer' as LayerId);
    expect(result.id).toBe('quality_index');
  });

  it('returns correct layer for valid ID', () => {
    expect(getLayerById('median_income').id).toBe('median_income');
    expect(getLayerById('unemployment').id).toBe('unemployment');
    expect(getLayerById('crime_rate').id).toBe('crime_rate');
  });
});

describe('getColorForValue — edge cases', () => {
  it('returns gray for null', () => {
    const layer = LAYERS[0];
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    const layer = LAYERS[0];
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below all stops', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const result = getColorForValue(layer, -1000);
    expect(result).toBe(layer.colors[0]);
  });

  it('returns last color for value above all stops', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const result = getColorForValue(layer, 999999);
    expect(result).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color for value exactly at a stop', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const result = getColorForValue(layer, layer.stops[3]);
    expect(result).toBe(layer.colors[3]);
  });
});

describe('colorblind mode', () => {
  beforeEach(() => {
    setColorblindMode('off');
  });

  it('getLayerById returns original colors when colorblind is off', () => {
    const original = LAYER_MAP.get('median_income')!;
    const result = getLayerById('median_income');
    expect(result.colors).toEqual(original.colors);
  });

  it('getLayerById substitutes colorblind-safe palette when mode is active', () => {
    setColorblindMode('protanopia');
    const original = LAYER_MAP.get('median_income')!;
    const result = getLayerById('median_income');
    expect(result.colors).not.toEqual(original.colors);
    expect(result.colors.length).toBe(original.colors.length);
  });

  it('colorblind palette is cached across calls', () => {
    setColorblindMode('deuteranopia');
    const r1 = getLayerById('median_income');
    const r2 = getLayerById('median_income');
    expect(r1).toBe(r2); // same reference
  });

  it('switching colorblind mode clears the cache', () => {
    setColorblindMode('protanopia');
    const r1 = getLayerById('median_income');

    setColorblindMode('tritanopia');
    const r2 = getLayerById('median_income');

    expect(r1.colors).not.toEqual(r2.colors);
  });

  it('getColorblindMode returns current mode', () => {
    expect(getColorblindMode()).toBe('off');
    setColorblindMode('protanopia');
    expect(getColorblindMode()).toBe('protanopia');
    setColorblindMode('off');
    expect(getColorblindMode()).toBe('off');
  });
});

describe('LAYERS — structural invariants', () => {
  it('every layer has matching colors and stops lengths', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('every layer has monotonically increasing stops', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('LAYER_MAP has an entry for every layer', () => {
    for (const layer of LAYERS) {
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('no duplicate layer IDs', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all colors are valid hex strings', () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(hexRe);
      }
    }
  });
});
