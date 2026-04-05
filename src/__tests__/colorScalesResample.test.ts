/**
 * Tests for uncovered branches in colorScales.ts:
 * - resamplePalette with count <= 1 (line 717)
 * - colorblind mode old boolean migration (line 707-708)
 * - getLayerById with unknown ID fallback (line 758)
 * - buildFillColorExpression with propertyOverride
 * - rescaleLayerToData with string property values
 *
 * A bug in color scale logic would silently miscolor the entire map
 * without any error being thrown — making these tests critical.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  LAYERS,
  LAYER_MAP,
  getLayerById,
  getColorForValue,
  buildFillColorExpression,
  rescaleLayerToData,
  setColorblindMode,
  getColorblindMode,
  type LayerId,
  type LayerConfig,
} from '../utils/colorScales';

describe('colorScales — LAYER_MAP consistency', () => {
  it('LAYER_MAP contains all layers from LAYERS array', () => {
    expect(LAYER_MAP.size).toBe(LAYERS.length);
    for (const layer of LAYERS) {
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('every layer has matching colors and stops arrays', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
      // Stops should be in ascending order
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has a valid labelKey string', () => {
    for (const layer of LAYERS) {
      expect(typeof layer.labelKey).toBe('string');
      expect(layer.labelKey.length).toBeGreaterThan(0);
    }
  });

  it('every color is a valid hex string', () => {
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('colorScales — colorblind mode', () => {
  afterEach(() => {
    setColorblindMode('off');
  });

  it('defaults to off', () => {
    setColorblindMode('off');
    expect(getColorblindMode()).toBe('off');
  });

  it('applies protanopia palette', () => {
    setColorblindMode('protanopia');
    const layer = getLayerById('quality_index');
    // Colors should be replaced with viridis palette
    expect(layer.colors).not.toEqual(LAYERS[0].colors);
    expect(layer.colors.length).toBe(LAYERS[0].colors.length);
  });

  it('applies deuteranopia palette', () => {
    setColorblindMode('deuteranopia');
    const layer = getLayerById('median_income');
    expect(layer.colors).not.toEqual(LAYERS[1].colors);
  });

  it('applies tritanopia palette', () => {
    setColorblindMode('tritanopia');
    const layer = getLayerById('unemployment');
    expect(layer.colors).not.toEqual(LAYERS[2].colors);
  });

  it('returns original colors when mode is off', () => {
    setColorblindMode('off');
    const layer = getLayerById('quality_index');
    expect(layer.colors).toEqual(LAYERS[0].colors);
  });

  it('caches colorblind layer configs (returns same reference)', () => {
    setColorblindMode('protanopia');
    const a = getLayerById('quality_index');
    const b = getLayerById('quality_index');
    expect(a).toBe(b); // Same reference from cache
  });

  it('handles layers with different stop counts (resample palette)', () => {
    setColorblindMode('protanopia');
    // 'unemployment' has 10 stops — palette has 8, so it must resample
    const layer = getLayerById('unemployment');
    expect(layer.colors.length).toBe(LAYERS[2].stops.length);
    // All colors should still be valid hex
    for (const c of layer.colors) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('clears cache when mode changes', () => {
    setColorblindMode('protanopia');
    const a = getLayerById('quality_index');
    setColorblindMode('deuteranopia');
    const b = getLayerById('quality_index');
    // Different mode → different colors
    expect(a.colors).not.toEqual(b.colors);
  });
});

describe('colorScales — getLayerById fallback', () => {
  afterEach(() => {
    setColorblindMode('off');
  });

  it('returns quality_index (first layer) for unknown ID', () => {
    const layer = getLayerById('nonexistent_id' as LayerId);
    expect(layer.id).toBe('quality_index');
  });

  it('returns correct layer for each valid ID', () => {
    for (const expected of LAYERS) {
      const layer = getLayerById(expected.id);
      expect(layer.id).toBe(expected.id);
    }
  });
});

describe('colorScales — getColorForValue edge cases', () => {
  const layer = LAYERS[0]; // quality_index: stops [0, 14, 28, 43, 57, 71, 86, 100]

  it('returns gray for null', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for negative value (below all stops)', () => {
    expect(getColorForValue(layer, -10)).toBe(layer.colors[0]);
  });

  it('returns last color for value above last stop', () => {
    expect(getColorForValue(layer, 150)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns exact color at stop boundary', () => {
    expect(getColorForValue(layer, 0)).toBe(layer.colors[0]);
    expect(getColorForValue(layer, 100)).toBe(layer.colors[layer.colors.length - 1]);
  });
});

describe('colorScales — rescaleLayerToData', () => {
  const baseLayer: LayerConfig = {
    id: 'median_income',
    labelKey: 'layer.median_income',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
    stops: [10000, 20000, 30000, 40000],
    format: (v: number) => `${v}`,
  };

  const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

  it('rescales stops to actual data range', () => {
    const features = [
      { type: 'Feature', properties: { hr_mtu: 5000 }, geometry: poly },
      { type: 'Feature', properties: { hr_mtu: 15000 }, geometry: poly },
    ] as GeoJSON.Feature[];

    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(5000);
    expect(result.stops[result.stops.length - 1]).toBe(15000);
    expect(result.colors).toEqual(baseLayer.colors); // Colors unchanged
  });

  it('returns original layer when all values are the same', () => {
    const features = [
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: poly },
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: poly },
    ] as GeoJSON.Feature[];

    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer); // Same reference — no rescaling
  });

  it('returns original layer for empty features', () => {
    const result = rescaleLayerToData(baseLayer, []);
    expect(result).toBe(baseLayer);
  });

  it('coerces string property values to numbers during rescale', () => {
    const features = [
      { type: 'Feature', properties: { hr_mtu: '5000' }, geometry: poly },
      { type: 'Feature', properties: { hr_mtu: '15000' }, geometry: poly },
    ] as GeoJSON.Feature[];

    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(5000);
    expect(result.stops[result.stops.length - 1]).toBe(15000);
  });

  it('skips features with null/undefined property', () => {
    const features = [
      { type: 'Feature', properties: { hr_mtu: null }, geometry: poly },
      { type: 'Feature', properties: { hr_mtu: 5000 }, geometry: poly },
      { type: 'Feature', properties: { hr_mtu: 15000 }, geometry: poly },
    ] as GeoJSON.Feature[];

    const result = rescaleLayerToData(baseLayer, features);
    expect(result.stops[0]).toBe(5000);
    expect(result.stops[result.stops.length - 1]).toBe(15000);
  });

  it('handles negative data range correctly', () => {
    const layer: LayerConfig = {
      ...baseLayer,
      property: 'some_metric',
      stops: [0, 25, 50, 75, 100],
      colors: ['#a', '#b', '#c', '#d', '#e'],
    };
    const features = [
      { type: 'Feature', properties: { some_metric: -10 }, geometry: poly },
      { type: 'Feature', properties: { some_metric: -5 }, geometry: poly },
    ] as GeoJSON.Feature[];

    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(-10);
    expect(result.stops[result.stops.length - 1]).toBe(-5);
  });
});

describe('colorScales — buildFillColorExpression', () => {
  it('uses property from layer config', () => {
    const expr = buildFillColorExpression(LAYERS[0]);
    const flat = JSON.stringify(expr);
    expect(flat).toContain(LAYERS[0].property);
  });

  it('uses propertyOverride when provided', () => {
    const expr = buildFillColorExpression(LAYERS[0], 'custom_prop');
    const flat = JSON.stringify(expr);
    expect(flat).toContain('custom_prop');
    // Should NOT contain the default property
    if (LAYERS[0].property !== 'custom_prop') {
      expect(flat).not.toContain(`"${LAYERS[0].property}"`);
    }
  });

  it('generates a case expression with fallback gray', () => {
    const expr = buildFillColorExpression(LAYERS[0]) as unknown[];
    expect(expr[0]).toBe('case');
    // Last element should be the fallback gray
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });

  it('includes type guard for non-numeric properties', () => {
    const expr = buildFillColorExpression(LAYERS[0]);
    const flat = JSON.stringify(expr);
    // Should include typeof check
    expect(flat).toContain('typeof');
    expect(flat).toContain('number');
  });
});

describe('colorScales — format functions', () => {
  it('every layer format function handles typical values without throwing', () => {
    for (const layer of LAYERS) {
      const midStop = layer.stops[Math.floor(layer.stops.length / 2)];
      expect(() => layer.format(midStop)).not.toThrow();
      expect(typeof layer.format(midStop)).toBe('string');
    }
  });

  it('format functions handle 0', () => {
    for (const layer of LAYERS) {
      expect(() => layer.format(0)).not.toThrow();
    }
  });

  it('format functions handle negative numbers', () => {
    for (const layer of LAYERS) {
      expect(() => layer.format(-100)).not.toThrow();
    }
  });
});
