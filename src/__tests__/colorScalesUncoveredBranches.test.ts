/**
 * Tests for colorScales.ts — uncovered branches:
 * - rescaleLayerToData edge cases (n<=1 stops, string property values)
 * - getColorForValue when value < all stops
 * - colorblind mode localStorage initialization (migration from '1')
 * - buildFillColorExpression with propertyOverride
 * - getLayerById with invalid ID (fallback to LAYERS[0])
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Feature } from 'geojson';

describe('colorScales — rescaleLayerToData', () => {
  let rescaleLayerToData: typeof import('../utils/colorScales').rescaleLayerToData;
  let LAYERS: typeof import('../utils/colorScales').LAYERS;
  let getLayerById: typeof import('../utils/colorScales').getLayerById;
  let getColorForValue: typeof import('../utils/colorScales').getColorForValue;
  let buildFillColorExpression: typeof import('../utils/colorScales').buildFillColorExpression;
  let setColorblindMode: typeof import('../utils/colorScales').setColorblindMode;
  let getColorblindMode: typeof import('../utils/colorScales').getColorblindMode;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    rescaleLayerToData = mod.rescaleLayerToData;
    LAYERS = mod.LAYERS;
    getLayerById = mod.getLayerById;
    getColorForValue = mod.getColorForValue;
    buildFillColorExpression = mod.buildFillColorExpression;
    setColorblindMode = mod.setColorblindMode;
    getColorblindMode = mod.getColorblindMode;
    // Reset colorblind mode
    setColorblindMode('off');
  });

  function makeFeatures(values: (number | string | null)[], property = 'hr_mtu'): Feature[] {
    return values.map((v, i) => ({
      type: 'Feature' as const,
      properties: { pno: `0010${i}`, [property]: v },
      geometry: { type: 'Point' as const, coordinates: [25 + i * 0.01, 60.1] },
    }));
  }

  it('returns original layer when no valid values exist', () => {
    const layer = LAYERS[1]; // median_income
    const result = rescaleLayerToData(layer, makeFeatures([null, null], layer.property));
    expect(result).toBe(layer); // same reference
  });

  it('returns original layer when all values are identical (min === max)', () => {
    const layer = LAYERS[1];
    const result = rescaleLayerToData(layer, makeFeatures([5000, 5000], layer.property));
    expect(result).toBe(layer);
  });

  it('rescales stops to match actual data range', () => {
    const layer = LAYERS[1]; // median_income
    const features = makeFeatures([10000, 50000], layer.property);
    const result = rescaleLayerToData(layer, features);
    expect(result).not.toBe(layer); // new object
    expect(result.stops[0]).toBe(10000);
    expect(result.stops[result.stops.length - 1]).toBe(50000);
    // Stops should be evenly distributed
    expect(result.stops.length).toBe(layer.stops.length);
  });

  it('handles string property values in features (coerces to number)', () => {
    const layer = LAYERS[1];
    const features = makeFeatures(['15000', '45000'], layer.property);
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(15000);
    expect(result.stops[result.stops.length - 1]).toBe(45000);
  });

  it('ignores NaN and Infinity values', () => {
    const layer = LAYERS[1];
    const features = makeFeatures([NaN, 10000, Infinity, 40000], layer.property);
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(10000);
    expect(result.stops[result.stops.length - 1]).toBe(40000);
  });

  it('preserves colors array', () => {
    const layer = LAYERS[1];
    const features = makeFeatures([10000, 50000], layer.property);
    const result = rescaleLayerToData(layer, features);
    expect(result.colors).toEqual(layer.colors);
  });
});

describe('colorScales — getColorForValue edge cases', () => {
  let getColorForValue: typeof import('../utils/colorScales').getColorForValue;
  let LAYERS: typeof import('../utils/colorScales').LAYERS;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    getColorForValue = mod.getColorForValue;
    LAYERS = mod.LAYERS;
  });

  it('returns gray for null', () => {
    expect(getColorForValue(LAYERS[0], null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(LAYERS[0], undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below all stops', () => {
    const layer = LAYERS[0]; // quality_index, stops start at 0
    // Value below the minimum stop
    const result = getColorForValue(layer, -10);
    expect(result).toBe(layer.colors[0]);
  });

  it('returns last color for value at or above max stop', () => {
    const layer = LAYERS[0]; // quality_index, stops end at 100
    expect(getColorForValue(layer, 100)).toBe(layer.colors[layer.colors.length - 1]);
    expect(getColorForValue(layer, 150)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct intermediate color', () => {
    const layer = LAYERS[0]; // quality_index
    // Value at exactly a stop boundary
    const result = getColorForValue(layer, layer.stops[3]);
    expect(result).toBe(layer.colors[3]);
  });
});

describe('colorScales — getLayerById', () => {
  let getLayerById: typeof import('../utils/colorScales').getLayerById;
  let LAYERS: typeof import('../utils/colorScales').LAYERS;
  let setColorblindMode: typeof import('../utils/colorScales').setColorblindMode;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    getLayerById = mod.getLayerById;
    LAYERS = mod.LAYERS;
    setColorblindMode = mod.setColorblindMode;
    setColorblindMode('off');
  });

  it('returns correct layer for valid ID', () => {
    const layer = getLayerById('median_income');
    expect(layer.id).toBe('median_income');
  });

  it('falls back to LAYERS[0] for unknown ID', () => {
    const layer = getLayerById('nonexistent_layer' as import('../utils/colorScales').LayerId);
    expect(layer.id).toBe(LAYERS[0].id);
  });

  it('returns colorblind-adjusted layer when mode is active', () => {
    setColorblindMode('protanopia');
    const normal = LAYERS.find(l => l.id === 'median_income')!;
    const cb = getLayerById('median_income');
    expect(cb.id).toBe('median_income');
    // Colors should be different from normal
    expect(cb.colors).not.toEqual(normal.colors);
    // But stops should be the same
    expect(cb.stops).toEqual(normal.stops);
  });

  it('caches colorblind layer config for same mode+id', () => {
    setColorblindMode('deuteranopia');
    const layer1 = getLayerById('median_income');
    const layer2 = getLayerById('median_income');
    expect(layer1).toBe(layer2); // same reference
  });

  it('handles all colorblind modes', () => {
    for (const mode of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      setColorblindMode(mode);
      const layer = getLayerById('quality_index');
      expect(layer.colors.length).toBe(LAYERS[0].colors.length);
      // All colors should be valid hex
      for (const c of layer.colors) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('colorScales — buildFillColorExpression', () => {
  let buildFillColorExpression: typeof import('../utils/colorScales').buildFillColorExpression;
  let LAYERS: typeof import('../utils/colorScales').LAYERS;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    buildFillColorExpression = mod.buildFillColorExpression;
    LAYERS = mod.LAYERS;
  });

  it('builds expression for layer without property override', () => {
    const expr = buildFillColorExpression(LAYERS[0]);
    expect(expr).toBeDefined();
    expect(Array.isArray(expr)).toBe(true);
    // Should be a 'case' expression
    expect(expr[0]).toBe('case');
  });

  it('builds expression with property override', () => {
    const expr = buildFillColorExpression(LAYERS[0], 'custom_property');
    // The expression should reference 'custom_property' instead of the layer's default
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_property');
  });

  it('expression includes gray fallback for null/missing', () => {
    const expr = buildFillColorExpression(LAYERS[0]);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('#d1d5db');
  });
});

describe('colorScales — LAYERS configuration integrity', () => {
  let LAYERS: typeof import('../utils/colorScales').LAYERS;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/colorScales');
    LAYERS = mod.LAYERS;
  });

  it('every layer has matching colors and stops length', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('every layer has stops in ascending order', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has a valid format function', () => {
    for (const layer of LAYERS) {
      expect(typeof layer.format).toBe('function');
      // format(0) should return a string without throwing
      expect(typeof layer.format(0)).toBe('string');
    }
  });

  it('every layer has valid hex colors', () => {
    for (const layer of LAYERS) {
      for (const c of layer.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('every layer has a non-empty labelKey', () => {
    for (const layer of LAYERS) {
      expect(layer.labelKey.length).toBeGreaterThan(0);
    }
  });
});
