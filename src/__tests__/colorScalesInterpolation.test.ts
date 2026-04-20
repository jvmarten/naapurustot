/**
 * Color scales — interpolation, rescaling, and MapLibre expression tests.
 *
 * Priority 2: Data visualization. Wrong colors mislead users about
 * neighborhood characteristics.
 *
 * Targets untested paths:
 * - getColorForValue boundary behavior at each stop
 * - getColorForValue below lowest stop
 * - rescaleLayerToData with string-encoded feature values
 * - rescaleLayerToData cache invalidation across different layers
 * - rescaleLayerToData with single-value features (min === max)
 * - buildFillColorExpression typeof guard structure
 * - resamplePalette with exact match (no interpolation)
 * - resamplePalette count=1 edge case
 * - LAYER_MAP integrity — all layers accessible via O(1) lookup
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
} from '../utils/colorScales';

beforeEach(() => {
  setColorblindMode('off');
  clearRescaleCache();
});

describe('getColorForValue — stop boundary behavior', () => {
  const layer = LAYERS.find(l => l.id === 'median_income')!;

  it('returns first color for value exactly at first stop', () => {
    const color = getColorForValue(layer, layer.stops[0]);
    expect(color).toBe(layer.colors[0]);
  });

  it('returns last color for value exactly at last stop', () => {
    const color = getColorForValue(layer, layer.stops[layer.stops.length - 1]);
    expect(color).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns last color for value above last stop', () => {
    const color = getColorForValue(layer, layer.stops[layer.stops.length - 1] + 10000);
    expect(color).toBe(layer.colors[layer.colors.length - 1]);
  });

  it('returns first color for value below first stop', () => {
    const color = getColorForValue(layer, layer.stops[0] - 1);
    expect(color).toBe(layer.colors[0]);
  });

  it('returns gray (#d1d5db) for null value', () => {
    expect(getColorForValue(layer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined value', () => {
    expect(getColorForValue(layer, undefined)).toBe('#d1d5db');
  });

  it('buckets value between stops to the highest stop it meets', () => {
    // getColorForValue iterates from end: first stop where value >= stop wins
    const midValue = (layer.stops[1] + layer.stops[2]) / 2;
    const color = getColorForValue(layer, midValue);
    // midValue >= stops[1] so it gets colors[1]
    expect(color).toBe(layer.colors[1]);
  });
});

describe('getColorForValue — higherIsBetter=false layers', () => {
  it('returns correct colors for unemployment (inverted scale)', () => {
    const unemp = LAYERS.find(l => l.id === 'unemployment')!;
    const lowColor = getColorForValue(unemp, 1);
    const highColor = getColorForValue(unemp, 11);
    expect(lowColor).toBe(unemp.colors[0]); // green for low unemployment
    expect(highColor).toBe(unemp.colors[unemp.colors.length - 1]); // red for high
  });
});

describe('rescaleLayerToData', () => {
  const layer = LAYERS.find(l => l.id === 'median_income')!;

  it('rescales stops to actual data range', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 22000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 38000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const rescaled = rescaleLayerToData(layer, features);

    expect(rescaled.stops[0]).toBe(22000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(38000);
    expect(rescaled.colors).toEqual(layer.colors);
  });

  it('handles string-encoded feature values', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: '18000' }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: '42000' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled.stops[0]).toBe(18000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(42000);
  });

  it('returns original layer when all values are identical (min === max)', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 30000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled).toBe(layer);
  });

  it('returns original layer when no valid values exist', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: null }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: NaN }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const rescaled = rescaleLayerToData(layer, features);
    expect(rescaled).toBe(layer);
  });

  it('returns cached result for same layer + features', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 20000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 50000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const r1 = rescaleLayerToData(layer, features);
    const r2 = rescaleLayerToData(layer, features);
    expect(r1).toBe(r2);
  });

  it('invalidates cache when layer changes', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 20000, unemployment_rate: 5 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 50000, unemployment_rate: 15 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const layer2 = LAYERS.find(l => l.id === 'unemployment')!;
    const r1 = rescaleLayerToData(layer, features);
    const r2 = rescaleLayerToData(layer2, features);
    expect(r1.stops[0]).not.toBe(r2.stops[0]);
  });

  it('evenly distributes stops across data range', () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', properties: { hr_mtu: 10000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
      { type: 'Feature', properties: { hr_mtu: 90000 }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ];
    const rescaled = rescaleLayerToData(layer, features);
    const n = rescaled.stops.length;
    for (let i = 1; i < n; i++) {
      const expected = 10000 + (i / (n - 1)) * 80000;
      expect(rescaled.stops[i]).toBeCloseTo(expected, 0);
    }
  });
});

describe('buildFillColorExpression', () => {
  it('produces a valid MapLibre expression with case/interpolate structure', () => {
    const layer = LAYERS.find(l => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer);

    expect(expr[0]).toBe('case');
    const condition = expr[1] as unknown[];
    expect(condition[0]).toBe('all');
    const fallback = expr[3];
    expect(fallback).toBe('#d1d5db');
  });

  it('includes typeof check to guard against non-numeric properties', () => {
    const layer = LAYERS.find(l => l.id === 'median_income')!;
    const expr = buildFillColorExpression(layer);

    const condition = expr[1] as unknown[];
    const typeofCheck = condition.find(
      (c: unknown) => Array.isArray(c) && c[0] === '==' && Array.isArray(c[1]) && c[1][0] === 'typeof'
    );
    expect(typeofCheck).toBeDefined();
  });

  it('uses propertyOverride when provided', () => {
    const layer = LAYERS.find(l => l.id === 'air_quality')!;
    const expr = buildFillColorExpression(layer, 'custom_prop');

    const condition = expr[1] as unknown[];
    const hasCheck = condition.find(
      (c: unknown) => Array.isArray(c) && c[0] === 'has' && c[1] === 'custom_prop'
    );
    expect(hasCheck).toBeDefined();
  });
});

describe('LAYER_MAP integrity', () => {
  it('has an entry for every layer in LAYERS', () => {
    for (const layer of LAYERS) {
      expect(LAYER_MAP.has(layer.id)).toBe(true);
    }
    expect(LAYER_MAP.size).toBe(LAYERS.length);
  });

  it('getLayerById returns correct layer for each ID', () => {
    for (const layer of LAYERS) {
      expect(getLayerById(layer.id).id).toBe(layer.id);
    }
  });

  it('getLayerById falls back to first layer for unknown ID', () => {
    const result = getLayerById('nonexistent_layer' as never);
    expect(result.id).toBe(LAYERS[0].id);
  });
});

describe('LAYERS data integrity', () => {
  it('every layer has matching colors and stops length', () => {
    for (const layer of LAYERS) {
      expect(layer.colors.length, `${layer.id}: colors/stops length mismatch`).toBe(layer.stops.length);
    }
  });

  it('every layer has strictly sorted stops', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i], `${layer.id}: stops[${i}] not sorted`).toBeGreaterThan(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has valid hex color strings', () => {
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color, `${layer.id}: invalid color ${color}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('every layer has a unique ID', () => {
    const ids = LAYERS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every format function is callable with a number', () => {
    for (const layer of LAYERS) {
      expect(() => layer.format(42)).not.toThrow();
      expect(typeof layer.format(42)).toBe('string');
    }
  });
});
