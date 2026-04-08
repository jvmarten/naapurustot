/**
 * Tests for getColorForValue, rescaleLayerToData, buildFillColorExpression,
 * and getLayerById — the core color mapping pipeline.
 *
 * These functions run on every hover (~60Hz), every layer switch, and every map
 * paint update. Bugs here cause incorrect choropleth rendering or crashes.
 */
import { describe, it, expect } from 'vitest';
import {
  LAYERS,
  LAYER_MAP,
  getColorForValue,
  getLayerById,
  rescaleLayerToData,
  buildFillColorExpression,
  setColorblindMode,
  type LayerConfig,
} from '../utils/colorScales';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('getColorForValue', () => {
  const layer = LAYERS.find((l) => l.id === 'median_income')!;

  it('returns gray for null values', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined values', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for values below the first stop', () => {
    expect(getColorForValue(layer, 0)).toBe(layer.colors[0]);
  });

  it('returns last color for values at or above the last stop', () => {
    const lastStop = layer.stops[layer.stops.length - 1];
    expect(getColorForValue(layer, lastStop)).toBe(layer.colors[layer.colors.length - 1]);
    expect(getColorForValue(layer, lastStop + 10000)).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns correct color for value exactly at a middle stop', () => {
    // Value at the 4th stop should return the 4th color
    const idx = 3;
    expect(getColorForValue(layer, layer.stops[idx])).toBe(layer.colors[idx]);
  });

  it('returns the lower color for values between two stops', () => {
    // Value between stop[1] and stop[2] should return color[1] (floor behavior)
    const midValue = (layer.stops[1] + layer.stops[2]) / 2;
    expect(getColorForValue(layer, midValue)).toBe(layer.colors[1]);
  });

  it('handles negative values by returning first color', () => {
    expect(getColorForValue(layer, -999)).toBe(layer.colors[0]);
  });
});

describe('getLayerById', () => {
  it('returns the correct layer for a valid ID', () => {
    const layer = getLayerById('median_income');
    expect(layer.id).toBe('median_income');
    expect(layer.property).toBe('hr_mtu');
  });

  it('returns fallback (first layer) for unknown ID', () => {
    const layer = getLayerById('nonexistent' as any);
    expect(layer.id).toBe(LAYERS[0].id);
  });

  it('returns stable reference for repeated calls (no colorblind mode)', () => {
    setColorblindMode('off');
    const a = getLayerById('unemployment');
    const b = getLayerById('unemployment');
    expect(a).toBe(b);
  });
});

describe('LAYER_MAP', () => {
  it('contains every layer from LAYERS array', () => {
    for (const layer of LAYERS) {
      expect(LAYER_MAP.has(layer.id)).toBe(true);
      expect(LAYER_MAP.get(layer.id)).toBe(layer);
    }
  });

  it('has no extra entries beyond LAYERS', () => {
    expect(LAYER_MAP.size).toBe(LAYERS.length);
  });
});

describe('LAYERS consistency', () => {
  it('every layer has colors and stops of equal length', () => {
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

  it('every layer has valid hex colors', () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(hexPattern);
      }
    }
  });

  it('every layer has a format function that handles typical values', () => {
    for (const layer of LAYERS) {
      const midStop = layer.stops[Math.floor(layer.stops.length / 2)];
      const result = layer.format(midStop);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('every layer has a unique id', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('rescaleLayerToData', () => {
  const baseLayer: LayerConfig = {
    id: 'median_income',
    labelKey: 'layer.median_income',
    property: 'hr_mtu',
    unit: '€',
    colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
    stops: [10000, 20000, 30000, 40000],
    format: (v) => `${v}`,
  };

  it('rescales stops to match data range', () => {
    const features = [
      makeFeature({ hr_mtu: 15000 }),
      makeFeature({ hr_mtu: 35000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
    // Intermediate stops should be evenly distributed
    expect(rescaled.stops[1]).toBeCloseTo(15000 + (1 / 3) * 20000, 1);
    expect(rescaled.stops[2]).toBeCloseTo(15000 + (2 / 3) * 20000, 1);
  });

  it('returns original layer when all values are the same (min === max)', () => {
    const features = [
      makeFeature({ hr_mtu: 25000 }),
      makeFeature({ hr_mtu: 25000 }),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('returns original layer when no valid values exist', () => {
    const features = [
      makeFeature({ hr_mtu: null }),
      makeFeature({}),
    ];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('coerces string values to numbers before computing range', () => {
    const features = [
      makeFeature({ hr_mtu: '15000' }),
      makeFeature({ hr_mtu: '35000' }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(15000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);
  });

  it('preserves colors array unchanged', () => {
    const features = [
      makeFeature({ hr_mtu: 10000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.colors).toEqual(baseLayer.colors);
  });

  it('ignores NaN and Infinity values', () => {
    const features = [
      makeFeature({ hr_mtu: NaN }),
      makeFeature({ hr_mtu: Infinity }),
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 30000 }),
    ];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(20000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(30000);
  });
});

describe('buildFillColorExpression', () => {
  it('returns a valid MapLibre expression array', () => {
    const layer = LAYERS[0]; // quality_index
    const expr = buildFillColorExpression(layer);
    expect(Array.isArray(expr)).toBe(true);
    // Top level should be a 'case' expression
    expect(expr[0]).toBe('case');
  });

  it('uses the layer property by default', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('hr_mtu');
  });

  it('uses propertyOverride when provided', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer, 'custom_prop');
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_prop');
    expect(exprStr).not.toContain('hr_mtu');
  });

  it('includes all stops and colors in the interpolation', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    for (const stop of layer.stops) {
      expect(exprStr).toContain(String(stop));
    }
    for (const color of layer.colors) {
      expect(exprStr).toContain(color);
    }
  });

  it('includes gray fallback for missing data', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('#d1d5db');
  });
});
