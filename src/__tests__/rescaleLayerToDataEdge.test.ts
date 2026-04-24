/**
 * Tests for rescaleLayerToData edge cases and caching behavior.
 *
 * rescaleLayerToData maps color stops to the actual data range.
 * Bugs here cause miscolored maps — the visual output would be wrong
 * even though the data is correct.
 *
 * Uncovered branches:
 * - Cache hit path (line 820)
 * - Single-stop layer (lines 838-839)
 * - No valid values in data (line 832-834)
 * - clearRescaleCache (line 812)
 */
import { describe, it, expect } from 'vitest';
import { rescaleLayerToData, clearRescaleCache, type LayerConfig } from '../utils/colorScales';

function makeLayer(overrides: Partial<LayerConfig> = {}): LayerConfig {
  return {
    id: 'test_layer' as LayerConfig['id'],
    label: { fi: 'Testi', en: 'Test' },
    property: 'hr_mtu',
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    stops: [0, 50, 100],
    format: (v) => String(v),
    category: 'socioeconomic' as LayerConfig['category'],
    source: { fi: '', en: '' },
    ...overrides,
  };
}

function makeFeatures(values: (number | null | string)[]): GeoJSON.Feature[] {
  return values.map((v) => ({
    type: 'Feature' as const,
    properties: { hr_mtu: v },
    geometry: { type: 'Point' as const, coordinates: [24.9, 60.2] },
  }));
}

describe('rescaleLayerToData — cache behavior', () => {
  it('returns cached result when called with same layer and features reference', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, 20, 30]);

    const result1 = rescaleLayerToData(layer, features);
    const result2 = rescaleLayerToData(layer, features);
    expect(result2).toBe(result1);
  });

  it('recomputes when features reference changes', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features1 = makeFeatures([10, 20, 30]);
    const features2 = makeFeatures([100, 200, 300]);

    const result1 = rescaleLayerToData(layer, features1);
    const result2 = rescaleLayerToData(layer, features2);
    expect(result2).not.toBe(result1);
    expect(result2.stops[0]).toBe(100);
    expect(result2.stops[2]).toBe(300);
  });

  it('recomputes when layer ID changes', () => {
    clearRescaleCache();
    const layer1 = makeLayer({ id: 'median_income' as LayerConfig['id'] });
    const layer2 = makeLayer({ id: 'unemployment' as LayerConfig['id'] });
    const features = makeFeatures([10, 20, 30]);

    const result1 = rescaleLayerToData(layer1, features);
    const result2 = rescaleLayerToData(layer2, features);
    expect(result2).not.toBe(result1);
  });

  it('clearRescaleCache forces recomputation', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, 20, 30]);

    const result1 = rescaleLayerToData(layer, features);
    clearRescaleCache();
    const result2 = rescaleLayerToData(layer, features);
    expect(result2).not.toBe(result1);
    expect(result2.stops).toEqual(result1.stops);
  });
});

describe('rescaleLayerToData — edge cases', () => {
  it('returns original layer when no valid numeric values exist', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([null, null, null]);

    const result = rescaleLayerToData(layer, features);
    expect(result).toBe(layer);
  });

  it('returns original layer when all values are the same (min === max)', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([50, 50, 50]);

    const result = rescaleLayerToData(layer, features);
    expect(result).toBe(layer);
  });

  it('returns original layer when layer has 1 or fewer stops', () => {
    clearRescaleCache();
    const singleStop = makeLayer({ stops: [50], colors: ['#ff0000'] });
    const features = makeFeatures([10, 20, 30]);

    const result = rescaleLayerToData(singleStop, features);
    expect(result).toBe(singleStop);
  });

  it('handles empty features array', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const result = rescaleLayerToData(layer, []);
    expect(result).toBe(layer);
  });

  it('rescales stops linearly to actual data range', () => {
    clearRescaleCache();
    const layer = makeLayer({ stops: [0, 50, 100] });
    const features = makeFeatures([200, 400]);

    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(200);
    expect(result.stops[1]).toBe(300);
    expect(result.stops[2]).toBe(400);
    expect(result.colors).toEqual(layer.colors);
  });

  it('skips string values that are not numeric when computing range', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, 'not a number', 30]);

    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(10);
    expect(result.stops[2]).toBe(30);
  });

  it('coerces string-typed numeric values to numbers for range computation', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, '20', 30]);

    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(10);
    expect(result.stops[2]).toBe(30);
  });

  it('ignores Infinity and NaN values', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, Infinity, NaN, -Infinity, 30]);

    const result = rescaleLayerToData(layer, features);
    expect(result.stops[0]).toBe(10);
    expect(result.stops[2]).toBe(30);
  });

  it('preserves all other layer properties in rescaled result', () => {
    clearRescaleCache();
    const layer = makeLayer();
    const features = makeFeatures([10, 30]);

    const result = rescaleLayerToData(layer, features);
    expect(result.id).toBe(layer.id);
    expect(result.label).toBe(layer.label);
    expect(result.property).toBe(layer.property);
    expect(result.colors).toBe(layer.colors);
    expect(result.format).toBe(layer.format);
  });
});
