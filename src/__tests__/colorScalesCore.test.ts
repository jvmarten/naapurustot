import { describe, it, expect } from 'vitest';
import {
  LAYERS,
  getLayerById,
  getColorForValue,
  rescaleLayerToData,
  buildFillColorExpression,
  type LayerId,
} from '../utils/colorScales';

describe('LAYERS configuration integrity', () => {
  it('all layers have matching colors and stops lengths', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length).toBe(layer.stops.length);
    }
  });

  it('all layers have stops in ascending order', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('all layers have valid hex color codes', () => {
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it('all layer IDs are unique', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all layers have a format function', () => {
    for (const layer of LAYERS) {
      expect(typeof layer.format).toBe('function');
      // Should not throw for a normal numeric value
      expect(() => layer.format(42)).not.toThrow();
    }
  });
});

describe('getLayerById', () => {
  it('returns the correct layer for known IDs', () => {
    const layer = getLayerById('median_income');
    expect(layer.id).toBe('median_income');
    expect(layer.property).toBe('hr_mtu');
  });

  it('falls back to first layer for unknown ID', () => {
    const layer = getLayerById('nonexistent_id' as LayerId);
    expect(layer.id).toBe(LAYERS[0].id);
  });
});

describe('getColorForValue', () => {
  const incomeLayer = LAYERS.find((l) => l.id === 'median_income')!;

  it('returns gray for null value', () => {
    expect(getColorForValue(incomeLayer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined value', () => {
    expect(getColorForValue(incomeLayer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below all stops', () => {
    expect(getColorForValue(incomeLayer, 0)).toBe(incomeLayer.colors[0]);
  });

  it('returns last color for value at or above last stop', () => {
    const lastStop = incomeLayer.stops[incomeLayer.stops.length - 1];
    expect(getColorForValue(incomeLayer, lastStop)).toBe(incomeLayer.colors[incomeLayer.colors.length - 1]);
    expect(getColorForValue(incomeLayer, lastStop + 10000)).toBe(incomeLayer.colors[incomeLayer.colors.length - 1]);
  });

  it('returns correct color for value exactly at a stop', () => {
    const midIdx = Math.floor(incomeLayer.stops.length / 2);
    const result = getColorForValue(incomeLayer, incomeLayer.stops[midIdx]);
    expect(result).toBe(incomeLayer.colors[midIdx]);
  });

  it('returns correct color for value between stops', () => {
    // Value between first and second stop should return first color
    const val = (incomeLayer.stops[0] + incomeLayer.stops[1]) / 2;
    const result = getColorForValue(incomeLayer, val);
    expect(result).toBe(incomeLayer.colors[0]);
  });
});

describe('rescaleLayerToData', () => {
  const baseLayer = LAYERS.find((l) => l.id === 'median_income')!;

  it('rescales stops to data range', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: 20000 }, geometry: null },
      { type: 'Feature' as const, properties: { hr_mtu: 50000 }, geometry: null },
    ];
    const rescaled = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    expect(rescaled.stops[0]).toBe(20000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(50000);
  });

  it('returns original layer when all values are the same', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: 30000 }, geometry: null },
      { type: 'Feature' as const, properties: { hr_mtu: 30000 }, geometry: null },
    ];
    const result = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    expect(result).toBe(baseLayer); // same reference
  });

  it('returns original layer when no valid values exist', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: null }, geometry: null },
      { type: 'Feature' as const, properties: {}, geometry: null },
    ];
    const result = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    expect(result).toBe(baseLayer);
  });

  it('handles string-encoded numeric values', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: '10000' }, geometry: null },
      { type: 'Feature' as const, properties: { hr_mtu: '60000' }, geometry: null },
    ];
    const rescaled = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    expect(rescaled.stops[0]).toBe(10000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(60000);
  });

  it('preserves colors when rescaling', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: 15000 }, geometry: null },
      { type: 'Feature' as const, properties: { hr_mtu: 45000 }, geometry: null },
    ];
    const rescaled = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    expect(rescaled.colors).toEqual(baseLayer.colors);
  });

  it('creates evenly spaced stops', () => {
    const features = [
      { type: 'Feature' as const, properties: { hr_mtu: 0 }, geometry: null },
      { type: 'Feature' as const, properties: { hr_mtu: 100 }, geometry: null },
    ];
    const rescaled = rescaleLayerToData(baseLayer, features as GeoJSON.Feature[]);
    const n = rescaled.stops.length;
    const step = 100 / (n - 1);
    for (let i = 0; i < n; i++) {
      expect(rescaled.stops[i]).toBeCloseTo(i * step, 5);
    }
  });
});

describe('buildFillColorExpression', () => {
  it('produces a valid MapLibre case expression', () => {
    const layer = LAYERS.find((l) => l.id === 'quality_index')!;
    const expr = buildFillColorExpression(layer);

    // Should be a 'case' expression
    expect(expr[0]).toBe('case');
    // Last element is the fallback color (gray)
    expect(expr[expr.length - 1]).toBe('#d1d5db');
  });

  it('uses propertyOverride when provided', () => {
    const layer = LAYERS.find((l) => l.id === 'quality_index')!;
    const expr = buildFillColorExpression(layer, 'custom_prop');
    // The expression should reference 'custom_prop' instead of 'quality_index'
    const exprStr = JSON.stringify(expr);
    expect(exprStr).toContain('custom_prop');
    expect(exprStr).not.toContain('"quality_index"');
  });

  it('includes all stops and colors in interpolation', () => {
    const layer = LAYERS.find((l) => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer);
    const exprStr = JSON.stringify(expr);
    for (const stop of layer.stops) {
      expect(exprStr).toContain(String(stop));
    }
    for (const color of layer.colors) {
      expect(exprStr).toContain(color);
    }
  });
});
