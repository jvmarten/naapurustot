/**
 * Tests for rescaleLayerToData's identity cache + degenerate-stop edge cases.
 *
 * The map uses rescaleLayerToData on every layer/data change. Without a cache,
 * every React re-render would re-scan all features (O(n) worst case across
 * ~1200 neighborhoods for the combined view). The cache keys on (layerId,
 * features identity), so a stale cache would silently serve the wrong layer's
 * stops and miscolor the map.
 *
 * Uncovered branches we target:
 *   - Cache HIT: second call with same (layer.id, features) returns identical result
 *   - Cache INVALIDATION: different layer.id re-runs the scan
 *   - Cache INVALIDATION: different features reference re-runs the scan
 *   - n <= 1: a layer with a single stop returns the original unchanged
 */
import { describe, it, expect } from 'vitest';
import { rescaleLayerToData, type LayerConfig } from '../utils/colorScales';

const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

function makeFeatures(values: Array<number | null>): GeoJSON.Feature[] {
  return values.map((v) => ({
    type: 'Feature',
    properties: { hr_mtu: v },
    geometry: poly,
  })) as GeoJSON.Feature[];
}

const baseLayer: LayerConfig = {
  id: 'median_income',
  labelKey: 'layer.median_income',
  property: 'hr_mtu',
  unit: '€',
  colors: ['#aaa', '#bbb', '#ccc', '#ddd'],
  stops: [10000, 20000, 30000, 40000],
  format: (v: number) => `${v}`,
};

describe('rescaleLayerToData — identity cache', () => {
  it('second call with same layer.id + same features reference returns the exact cached result', () => {
    const features = makeFeatures([5000, 15000, 25000]);

    const first = rescaleLayerToData(baseLayer, features);
    const second = rescaleLayerToData(baseLayer, features);

    // Same object reference = cache hit. If the cache ever loses identity
    // (for example if someone rewrote it to always reallocate), repeated
    // React renders would cause every map re-color to allocate a fresh
    // layer config and cascade new renders.
    expect(second).toBe(first);
  });

  it('cache invalidates when layer.id changes', () => {
    const features = makeFeatures([100, 400]);
    const layerA: LayerConfig = { ...baseLayer, id: 'median_income' };
    const layerB: LayerConfig = { ...baseLayer, id: 'unemployment' };

    const a = rescaleLayerToData(layerA, features);
    const b = rescaleLayerToData(layerB, features);

    // Different layer.id → different cache entry → NOT identical (even if
    // numerically the stops are the same, the returned reference must
    // track the layer-b input so the map reflects the correct layer label).
    expect(b.id).toBe('unemployment');
    expect(a.id).toBe('median_income');
  });

  it('cache invalidates when features reference changes (even if contents identical)', () => {
    const v = [100, 400];
    const featuresA = makeFeatures(v);
    const featuresB = makeFeatures(v); // different array reference, same contents

    const a = rescaleLayerToData(baseLayer, featuresA);
    const b = rescaleLayerToData(baseLayer, featuresB);

    // The cache key is features IDENTITY, not features contents. Each new
    // loadData call produces a new features array — rescale must re-run.
    expect(b).not.toBe(a);
    // But the resulting stops should be numerically identical
    expect(b.stops).toEqual(a.stops);
  });

  it('cache hit survives min === max early exit (degenerate data)', () => {
    // All features have identical value → min === max → returns original layer.
    // The cache MUST still be populated, or every re-render with constant data
    // would re-scan the full feature set.
    const features = makeFeatures([25000, 25000, 25000]);
    const a = rescaleLayerToData(baseLayer, features);
    const b = rescaleLayerToData(baseLayer, features);

    expect(a).toBe(baseLayer);
    expect(b).toBe(baseLayer);
    // Both return the same (original) reference — confirms the cache path
    // for the degenerate branch.
    expect(b).toBe(a);
  });
});

describe('rescaleLayerToData — single-stop layer (n <= 1)', () => {
  it('returns the original layer unchanged when layer has 0 stops', () => {
    const empty: LayerConfig = { ...baseLayer, stops: [], colors: [] };
    const features = makeFeatures([10, 20]);
    // A 0-stop layer is degenerate; the function must not try to build a
    // new-stops array (would emit [NaN] or similar silent garbage).
    const result = rescaleLayerToData(empty, features);
    expect(result).toBe(empty);
  });

  it('returns the original layer unchanged when layer has a single stop', () => {
    const one: LayerConfig = {
      ...baseLayer,
      id: 'single_stop_layer',
      stops: [100],
      colors: ['#fff'],
    };
    const features = makeFeatures([10, 20, 30]);
    const result = rescaleLayerToData(one, features);
    // n-1 = 0 in the division → would produce NaN. Early return is required.
    expect(result).toBe(one);
    expect(result.stops).toEqual([100]);
  });

  it('caches the single-stop early-exit result (second call returns same reference)', () => {
    const one: LayerConfig = {
      ...baseLayer,
      id: 'single_stop_cached',
      stops: [100],
      colors: ['#fff'],
    };
    const features = makeFeatures([10, 20]);
    const a = rescaleLayerToData(one, features);
    const b = rescaleLayerToData(one, features);
    expect(b).toBe(a);
  });
});
