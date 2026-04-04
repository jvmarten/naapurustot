/**
 * Filter utils — critical path tests for EMPTY_SET identity stability,
 * outlier inclusion at both slider extremes, Infinity/NaN handling,
 * and multi-filter AND semantics with missing properties.
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';
import { getLayerById } from '../utils/colorScales';

function makeData(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((p, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [24.9 + i * 0.01, 60.2] },
      properties: {
        pno: String(10000 + i).padStart(5, '0'),
        nimi: `Test ${i}`,
        namn: `Test ${i}`,
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...p,
      } as NeighborhoodProperties,
    })),
  };
}

describe('EMPTY_SET reference stability', () => {
  it('returns the same Set instance for empty filters on different data', () => {
    const data1 = makeData([{ quality_index: 50 }]);
    const data2 = makeData([{ quality_index: 70 }]);
    const set1 = computeMatchingPnos(data1, []);
    const set2 = computeMatchingPnos(data2, []);
    expect(set1).toBe(set2); // Same reference, not just equal
  });

  it('returns the same Set instance for null data', () => {
    const set1 = computeMatchingPnos(null, []);
    const set2 = computeMatchingPnos(null, [{ layerId: 'quality_index', min: 0, max: 100 }]);
    expect(set1).toBe(set2); // Both return EMPTY_SET
  });
});

describe('outlier inclusion at slider extremes', () => {
  it('includes values below first stop when slider min is at minimum stop', () => {
    const layer = getLayerById('quality_index');
    const rangeMin = layer.stops[0]; // e.g., 0
    const rangeMax = layer.stops[layer.stops.length - 1]; // e.g., 100

    const data = makeData([
      { quality_index: rangeMin - 5 }, // Below range
      { quality_index: rangeMin + 10 },
      { quality_index: rangeMax - 10 },
    ]);

    // Slider at minimum → include outliers below range
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index',
      min: rangeMin,
      max: rangeMax,
    }]);

    // Should include the below-range value because slider is at extreme
    expect(result.size).toBe(3);
  });

  it('includes values above last stop when slider max is at maximum stop', () => {
    const layer = getLayerById('quality_index');
    const rangeMin = layer.stops[0];
    const rangeMax = layer.stops[layer.stops.length - 1];

    const data = makeData([
      { quality_index: rangeMax + 50 }, // Above range
      { quality_index: rangeMin + 10 },
    ]);

    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index',
      min: rangeMin,
      max: rangeMax,
    }]);

    // Should include above-range value when slider at maximum
    expect(result.size).toBe(2);
  });

  it('excludes outliers when slider is NOT at extreme positions', () => {
    const layer = getLayerById('quality_index');
    const rangeMin = layer.stops[0];
    const rangeMax = layer.stops[layer.stops.length - 1];

    const data = makeData([
      { quality_index: rangeMin - 5 }, // Below narrowed range
      { quality_index: 50 },
    ]);

    // Slider NOT at extreme (min set above rangeMin)
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index',
      min: rangeMin + 1, // Not at extreme
      max: rangeMax,
    }]);

    // Should exclude below-range value
    expect(result.size).toBe(1);
  });
});

describe('non-finite values in data', () => {
  it('excludes features with NaN property values', () => {
    const data = makeData([
      { quality_index: NaN },
      { quality_index: 50 },
    ]);
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index', min: 0, max: 100,
    }]);
    expect(result.size).toBe(1);
  });

  it('excludes features with Infinity property values', () => {
    const data = makeData([
      { quality_index: Infinity },
      { quality_index: 50 },
    ]);
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index', min: 0, max: 100,
    }]);
    expect(result.size).toBe(1);
  });

  it('excludes features with -Infinity property values', () => {
    const data = makeData([
      { quality_index: -Infinity },
      { quality_index: 50 },
    ]);
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index', min: 0, max: 100,
    }]);
    expect(result.size).toBe(1);
  });
});

describe('population filter', () => {
  it('excludes features with zero population', () => {
    const data = makeData([
      { he_vakiy: 0, quality_index: 50 },
      { he_vakiy: 1000, quality_index: 50 },
    ]);
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index', min: 0, max: 100,
    }]);
    expect(result.size).toBe(1);
  });

  it('excludes features with null population', () => {
    const data = makeData([
      { he_vakiy: null, quality_index: 50 },
      { he_vakiy: 500, quality_index: 50 },
    ]);
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index', min: 0, max: 100,
    }]);
    expect(result.size).toBe(1);
  });
});

describe('multi-filter AND semantics', () => {
  it('requires ALL filters to match for inclusion', () => {
    const data = makeData([
      { quality_index: 80, hr_mtu: 50000 },  // Both match
      { quality_index: 80, hr_mtu: 10000 },  // Only first matches
      { quality_index: 20, hr_mtu: 50000 },  // Only second matches
    ]);
    const result = computeMatchingPnos(data, [
      { layerId: 'quality_index', min: 50, max: 100 },
      { layerId: 'median_income', min: 30000, max: 60000 },
    ]);
    expect(result.size).toBe(1); // Only the first feature
  });

  it('excludes feature when one property is missing (null)', () => {
    const data = makeData([
      { quality_index: 80, hr_mtu: null },  // Missing second filter property
      { quality_index: 80, hr_mtu: 40000 },
    ]);
    const result = computeMatchingPnos(data, [
      { layerId: 'quality_index', min: 50, max: 100 },
      { layerId: 'median_income', min: 30000, max: 60000 },
    ]);
    expect(result.size).toBe(1);
  });
});
