import { describe, it, expect } from 'vitest';
import {
  getColorForValue,
  getLayerById,
  rescaleLayerToData,
  buildFillColorExpression,
  LAYERS,
  setColorblindMode,
} from '../utils/colorScales';
import type { Feature } from 'geojson';

describe('getColorForValue — boundary and edge cases', () => {
  it('returns gray for null', () => {
    const layer = getLayerById('median_income');
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    const layer = getLayerById('median_income');
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for values below first stop', () => {
    const layer = getLayerById('median_income');
    expect(getColorForValue(layer, -1000)).toBe(layer.colors[0]);
  });

  it('returns last color for values at or above last stop', () => {
    const layer = getLayerById('median_income');
    const lastIdx = layer.stops.length - 1;
    expect(getColorForValue(layer, layer.stops[lastIdx])).toBe(layer.colors[lastIdx]);
    expect(getColorForValue(layer, layer.stops[lastIdx] + 10000)).toBe(layer.colors[lastIdx]);
  });

  it('returns correct color for mid-range values', () => {
    const layer = getLayerById('quality_index');
    // Value between two stops should get the lower stop's color
    const result = getColorForValue(layer, layer.stops[3] + 0.1);
    expect(result).toBe(layer.colors[3]);
  });

  it('returns correct color at exact stop boundaries', () => {
    const layer = getLayerById('quality_index');
    for (let i = 0; i < layer.stops.length; i++) {
      expect(getColorForValue(layer, layer.stops[i])).toBe(layer.colors[i]);
    }
  });
});

describe('rescaleLayerToData — edge cases', () => {
  function makeFeature(value: unknown): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { quality_index: value },
    };
  }

  it('returns original when all values are the same', () => {
    const layer = getLayerById('quality_index');
    const features = [makeFeature(50), makeFeature(50)];
    const result = rescaleLayerToData(layer, features);
    expect(result).toBe(layer); // same reference
  });

  it('rescales stops to actual data range', () => {
    const layer = getLayerById('quality_index');
    const features = [makeFeature(20), makeFeature(80)];
    const result = rescaleLayerToData(layer, features);

    expect(result.stops[0]).toBe(20);
    expect(result.stops[result.stops.length - 1]).toBe(80);
    // Intermediate stops should be evenly spaced
    const range = 80 - 20;
    const n = result.stops.length;
    for (let i = 0; i < n; i++) {
      expect(result.stops[i]).toBeCloseTo(20 + (i / (n - 1)) * range, 5);
    }
  });

  it('handles string property values by coercing to numbers', () => {
    const layer = getLayerById('quality_index');
    const features = [
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { quality_index: '30' } },
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { quality_index: '70' } },
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(30);
    expect(result.stops[result.stops.length - 1]).toBe(70);
  });

  it('skips non-numeric string values', () => {
    const layer = getLayerById('quality_index');
    const features = [
      makeFeature('abc'),
      makeFeature(40),
      makeFeature(60),
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(40);
    expect(result.stops[result.stops.length - 1]).toBe(60);
  });

  it('returns original for empty features', () => {
    const layer = getLayerById('quality_index');
    const result = rescaleLayerToData(layer, []);
    expect(result).toBe(layer);
  });

  it('handles negative data range', () => {
    const layer = getLayerById('income_change');
    const features = [
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { income_change_pct: -20 } },
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { income_change_pct: -5 } },
    ];
    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(-20);
    expect(result.stops[result.stops.length - 1]).toBe(-5);
  });
});

describe('buildFillColorExpression — structure validation', () => {
  it('generates valid MapLibre expression with case/interpolation', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer) as unknown[];

    // Top-level should be a 'case' expression
    expect(expr[0]).toBe('case');
    // Condition should be an 'all' array
    expect((expr[1] as unknown[])[0]).toBe('all');
    // Fallback (last element) should be gray
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });

  it('references correct property name', () => {
    const layer = getLayerById('median_income');
    const expr = buildFillColorExpression(layer) as unknown[];
    // The 'has' check should use layer.property
    const condition = expr[1] as unknown[];
    const hasCheck = condition[1] as unknown[];
    expect(hasCheck[0]).toBe('has');
    expect(hasCheck[1]).toBe('hr_mtu');
  });

  it('uses property override when provided', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer, 'custom_prop') as unknown[];
    const condition = expr[1] as unknown[];
    const hasCheck = condition[1] as unknown[];
    expect(hasCheck[1]).toBe('custom_prop');
  });

  it('includes all stops and colors in interpolation', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer) as unknown[];
    const interpolation = expr[2] as unknown[];

    // Format: ['interpolate', ['linear'], ['get', prop], stop1, color1, stop2, color2, ...]
    expect(interpolation[0]).toBe('interpolate');
    expect(interpolation[1]).toEqual(['linear']);

    // Count stop-color pairs (starts at index 3)
    const pairs = (interpolation.length - 3) / 2;
    expect(pairs).toBe(layer.stops.length);
  });
});

describe('getLayerById — robustness', () => {
  it('returns quality_index as fallback for invalid id', () => {
    const layer = getLayerById('nonexistent_layer' as any);
    expect(layer.id).toBe('quality_index');
  });

  it('returns correct layer for all valid IDs', () => {
    for (const l of LAYERS) {
      const result = getLayerById(l.id);
      expect(result.id).toBe(l.id);
      expect(result.property).toBe(l.property);
    }
  });
});

describe('colorblind mode', () => {
  afterEach(() => {
    setColorblindMode('off');
  });

  it('replaces colors when colorblind mode is active', () => {
    const normalLayer = getLayerById('quality_index');
    setColorblindMode('protanopia');
    const cbLayer = getLayerById('quality_index');

    // Same structure, different colors
    expect(cbLayer.id).toBe(normalLayer.id);
    expect(cbLayer.stops).toEqual(normalLayer.stops);
    expect(cbLayer.colors).not.toEqual(normalLayer.colors);
    expect(cbLayer.colors.length).toBe(normalLayer.colors.length);
  });

  it('returns original colors when mode is off', () => {
    setColorblindMode('off');
    const layer = getLayerById('quality_index');
    const original = LAYERS.find((l) => l.id === 'quality_index')!;
    expect(layer.colors).toEqual(original.colors);
  });
});

describe('LAYERS — data integrity', () => {
  it('all layers have matching colors and stops array lengths', () => {
    for (const l of LAYERS) {
      expect(l.colors.length).toBe(l.stops.length);
    }
  });

  it('all layer stops are in ascending order', () => {
    for (const l of LAYERS) {
      for (let i = 1; i < l.stops.length; i++) {
        expect(l.stops[i]).toBeGreaterThan(l.stops[i - 1]);
      }
    }
  });

  it('all layer colors are valid hex codes', () => {
    for (const l of LAYERS) {
      for (const c of l.colors) {
        expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('all layers have unique ids', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('format functions do not throw for valid numbers', () => {
    for (const l of LAYERS) {
      expect(() => l.format(0)).not.toThrow();
      expect(() => l.format(100)).not.toThrow();
      expect(() => l.format(-50)).not.toThrow();
    }
  });

  it('higherIsBetter is explicitly set for inverted metrics', () => {
    const invertedLayers = ['unemployment', 'crime_rate', 'air_quality', 'light_pollution', 'noise_pollution', 'traffic_accidents'];
    for (const id of invertedLayers) {
      const layer = LAYERS.find((l) => l.id === id);
      if (layer) {
        expect(layer.higherIsBetter).toBe(false);
      }
    }
  });
});
