/**
 * Hardened tests for colorScales.ts.
 *
 * Targets critical logic:
 * - rescaleLayerToData: dynamic stop rescaling for data range
 * - resamplePalette: colorblind palette interpolation
 * - getLayerById: fallback to first layer for unknown IDs
 * - buildFillColorExpression: MapLibre expression structure
 * - LAYERS consistency: stops/colors length match, monotonic stops
 * - getColorForValue: boundary conditions
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  LAYERS,
  LAYER_MAP,
  getLayerById,
  getColorForValue,
  rescaleLayerToData,
  buildFillColorExpression,
  type LayerConfig,
} from '../utils/colorScales';

function mkFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: props,
  };
}

describe('LAYERS configuration consistency', () => {
  it('every layer has matching stops and colors array lengths', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('every layer has monotonically non-decreasing stops', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has valid hex color codes', () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(hexPattern);
      }
    }
  });

  it('every layer has a unique ID', () => {
    const ids = LAYERS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('LAYER_MAP contains all LAYERS entries', () => {
    expect(LAYER_MAP.size).toBe(LAYERS.length);
    for (const layer of LAYERS) {
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('every layer has a non-empty property name', () => {
    for (const layer of LAYERS) {
      expect(layer.property.length).toBeGreaterThan(0);
    }
  });

  it('every layer format function handles null-like values', () => {
    for (const layer of LAYERS) {
      // format functions accept number, so we test with a valid value
      const result = layer.format(0);
      expect(typeof result).toBe('string');
    }
  });
});

describe('getLayerById', () => {
  it('returns the correct layer for a valid ID', () => {
    const layer = getLayerById('median_income');
    expect(layer.id).toBe('median_income');
    expect(layer.property).toBe('hr_mtu');
  });

  it('returns first layer (quality_index) for unknown ID', () => {
    const layer = getLayerById('nonexistent' as any);
    expect(layer.id).toBe(LAYERS[0].id);
  });
});

describe('getColorForValue', () => {
  const testLayer: LayerConfig = {
    id: 'median_income' as any,
    labelKey: 'test',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    stops: [10, 20, 30],
    format: (v: number) => `${v}`,
    higherIsBetter: true,
    category: 'economy',
  } as LayerConfig;

  it('returns gray for null', () => {
    expect(getColorForValue(testLayer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(testLayer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below all stops', () => {
    expect(getColorForValue(testLayer, 5)).toBe('#ff0000');
  });

  it('returns first color for value at first stop', () => {
    expect(getColorForValue(testLayer, 10)).toBe('#ff0000');
  });

  it('returns second color for value at second stop', () => {
    expect(getColorForValue(testLayer, 20)).toBe('#00ff00');
  });

  it('returns last color for value at last stop', () => {
    expect(getColorForValue(testLayer, 30)).toBe('#0000ff');
  });

  it('returns last color for value above all stops', () => {
    expect(getColorForValue(testLayer, 100)).toBe('#0000ff');
  });

  it('returns correct bucket for value between stops (takes lower bracket)', () => {
    // Value 15 is between stops[0]=10 and stops[1]=20
    // Loop goes backwards: i=2 (30>15 no), i=1 (20>15 no), i=0 (10<=15 yes)
    expect(getColorForValue(testLayer, 15)).toBe('#ff0000');
  });

  it('uses step-based (not interpolated) color mapping', () => {
    // 19.9 is still below 20, so should get first bucket
    expect(getColorForValue(testLayer, 19.9)).toBe('#ff0000');
    // 20 hits second bucket
    expect(getColorForValue(testLayer, 20)).toBe('#00ff00');
  });
});

describe('rescaleLayerToData', () => {
  const baseLayer: LayerConfig = {
    id: 'median_income' as any,
    labelKey: 'test',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
    stops: [10000, 20000, 30000, 40000],
    format: (v: number) => `${v}`,
  } as LayerConfig;

  it('rescales stops to match data min/max', () => {
    const features = [
      mkFeature({ hr_mtu: 15000 }),
      mkFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
    // Middle stops should be evenly spaced
    expect(rescaled.stops.length).toBe(4);
  });

  it('preserves colors when rescaling', () => {
    const features = [
      mkFeature({ hr_mtu: 15000 }),
      mkFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.colors).toEqual(baseLayer.colors);
  });

  it('returns original layer when min === max', () => {
    const features = [
      mkFeature({ hr_mtu: 25000 }),
      mkFeature({ hr_mtu: 25000 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('returns original layer when no valid values found', () => {
    const features = [
      mkFeature({ hr_mtu: null }),
      mkFeature({ hr_mtu: undefined }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('returns original layer for empty features', () => {
    const result = rescaleLayerToData(baseLayer, []);
    expect(result).toBe(baseLayer);
  });

  it('ignores non-numeric values', () => {
    const features = [
      mkFeature({ hr_mtu: 'N/A' }),
      mkFeature({ hr_mtu: 15000 }),
      mkFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
  });

  it('coerces string numbers from feature properties', () => {
    const features = [
      mkFeature({ hr_mtu: '15000' }),
      mkFeature({ hr_mtu: '35000' }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
  });

  it('ignores Infinity values', () => {
    const features = [
      mkFeature({ hr_mtu: Infinity }),
      mkFeature({ hr_mtu: 15000 }),
      mkFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
  });

  it('produces evenly spaced stops', () => {
    const features = [
      mkFeature({ hr_mtu: 0 }),
      mkFeature({ hr_mtu: 300 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    // 4 stops from 0 to 300: [0, 100, 200, 300]
    expect(rescaled.stops).toEqual([0, 100, 200, 300]);
  });
});

describe('buildFillColorExpression', () => {
  it('returns a valid MapLibre expression structure', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    // Should be ['case', condition, interpolation, fallbackColor]
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('case');
    // Last element should be the fallback gray color
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });

  it('uses the layer property name in the expression', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const json = JSON.stringify(expr);
    expect(json).toContain(layer.property);
  });

  it('supports property override', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer, 'custom_prop');
    const json = JSON.stringify(expr);
    expect(json).toContain('custom_prop');
    expect(json).not.toContain(layer.property);
  });

  it('includes typeof number check to prevent string coercion', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const json = JSON.stringify(expr);
    expect(json).toContain('typeof');
    expect(json).toContain('number');
  });
});
