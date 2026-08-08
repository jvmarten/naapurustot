import { describe, it, expect } from 'vitest';
import {
  LAYERS,
  getLayerById,
  getColorForValue,
  rescaleLayerToData,
  buildFillColorExpression,
} from '../utils/colorScales';
import type { Feature } from 'geojson';

describe('getLayerById', () => {
  it('returns the matching layer for a valid id', () => {
    const layer = getLayerById('quality_index');
    expect(layer.id).toBe('quality_index');
    expect(layer.property).toBe('quality_index');
  });

  it('returns first layer as fallback for unknown id', () => {
    const layer = getLayerById('nonexistent' as any);
    expect(layer.id).toBe(LAYERS[0].id);
  });

  it('returns layer with correct number of stops and colors', () => {
    for (const layer of LAYERS) {
      const retrieved = getLayerById(layer.id);
      expect(retrieved.stops.length).toBe(retrieved.colors.length);
    }
  });
});

describe('getColorForValue', () => {
  const testLayer = {
    id: 'test' as any,
    labelKey: 'test',
    property: 'test',
    unit: '',
    format: (v: number) => String(v),
    stops: [0, 25, 50, 75, 100],
    colors: ['#a', '#b', '#c', '#d', '#e'],
  };

  it('returns gray for null', () => {
    expect(getColorForValue(testLayer, null)).toBe('#d1d5db');
  });

  it('returns gray for undefined', () => {
    expect(getColorForValue(testLayer, undefined)).toBe('#d1d5db');
  });

  it('returns first color for value below first stop', () => {
    expect(getColorForValue(testLayer, -10)).toBe('#a');
  });

  it('returns first color for value at first stop', () => {
    expect(getColorForValue(testLayer, 0)).toBe('#a');
  });

  it('returns correct color for value at each stop', () => {
    expect(getColorForValue(testLayer, 25)).toBe('#b');
    expect(getColorForValue(testLayer, 50)).toBe('#c');
    expect(getColorForValue(testLayer, 75)).toBe('#d');
    expect(getColorForValue(testLayer, 100)).toBe('#e');
  });

  it('returns last color for value above last stop', () => {
    expect(getColorForValue(testLayer, 999)).toBe('#e');
  });

  it('returns the lower bracket color for value between stops', () => {
    expect(getColorForValue(testLayer, 37)).toBe('#b'); // between 25 and 50
    expect(getColorForValue(testLayer, 60)).toBe('#c'); // between 50 and 75
  });
});

describe('rescaleLayerToData', () => {
  const baseLayer = {
    id: 'test' as any,
    labelKey: 'test',
    property: 'value',
    unit: '',
    format: (v: number) => String(v),
    stops: [0, 50, 100],
    colors: ['#a', '#b', '#c'],
  };

  function makeFeature(value: unknown): Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { value },
    };
  }

  it('rescales stops to match data range', () => {
    const features = [makeFeature(10), makeFeature(30)];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(10);
    expect(rescaled.stops[2]).toBe(30);
    expect(rescaled.stops[1]).toBe(20); // midpoint
  });

  it('returns original layer when all values are identical', () => {
    const features = [makeFeature(50), makeFeature(50)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer); // identity check — not rescaled
  });

  it('returns original layer for empty features', () => {
    const result = rescaleLayerToData(baseLayer, []);
    expect(result).toBe(baseLayer);
  });

  it('returns original layer when all values are null', () => {
    const features = [makeFeature(null), makeFeature(null)];
    const result = rescaleLayerToData(baseLayer, features);
    expect(result).toBe(baseLayer);
  });

  it('ignores non-numeric values', () => {
    const features = [makeFeature('hello'), makeFeature(10), makeFeature(20)];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(10);
    expect(rescaled.stops[2]).toBe(20);
  });

  it('handles string-encoded numbers', () => {
    const features = [makeFeature('10'), makeFeature('30')];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(10);
    expect(rescaled.stops[2]).toBe(30);
  });

  it('preserves colors when rescaling', () => {
    const features = [makeFeature(5), makeFeature(15)];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.colors).toEqual(baseLayer.colors);
  });

  it('ignores Infinity values', () => {
    const features = [makeFeature(Infinity), makeFeature(10), makeFeature(20)];
    const rescaled = rescaleLayerToData(baseLayer, features);
    expect(rescaled.stops[0]).toBe(10);
    expect(rescaled.stops[2]).toBe(20);
  });
});

describe('buildFillColorExpression', () => {
  it('returns a valid MapLibre expression array', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer);
    expect(Array.isArray(expr)).toBe(true);
    expect(expr[0]).toBe('case');
  });

  it('uses propertyOverride when provided', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer, 'custom_prop');
    // The expression should reference 'custom_prop' not 'quality_index'
    const json = JSON.stringify(expr);
    expect(json).toContain('custom_prop');
  });

  it('includes gray fallback color', () => {
    const layer = getLayerById('quality_index');
    const expr = buildFillColorExpression(layer);
    const json = JSON.stringify(expr);
    expect(json).toContain('#d1d5db');
  });
});

describe('LAYERS consistency', () => {
  it('every layer has a unique id', () => {
    const ids = LAYERS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every layer has matching stops and colors count', () => {
    for (const layer of LAYERS) {
      expect(layer.stops.length).toBe(layer.colors.length);
    }
  });

  it('every layer has stops in ascending order', () => {
    for (const layer of LAYERS) {
      for (let i = 1; i < layer.stops.length; i++) {
        expect(layer.stops[i]).toBeGreaterThanOrEqual(layer.stops[i - 1]);
      }
    }
  });

  it('every layer has at least 2 stops', () => {
    for (const layer of LAYERS) {
      expect(layer.stops.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every layer has valid hex colors', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const layer of LAYERS) {
      for (const color of layer.colors) {
        expect(color).toMatch(hexRegex);
      }
    }
  });

  it('format function produces a string for typical values', () => {
    for (const layer of LAYERS) {
      if (layer.format) {
        const midStop = layer.stops[Math.floor(layer.stops.length / 2)];
        const result = layer.format(midStop);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    }
  });
});
