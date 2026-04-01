import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeData(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.1] },
      properties: {
        pno: '00100',
        nimi: 'Test',
        namn: 'Test',
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...props,
      } as NeighborhoodProperties,
    })),
  };
}

describe('computeMatchingPnos', () => {
  it('returns empty set when no filters', () => {
    const data = makeData([{ pno: '00100' }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns empty set when data is null', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100000 }]);
    expect(result.size).toBe(0);
  });

  it('filters by single criterion', () => {
    const data = makeData([
      { pno: '00100', hr_mtu: 30000 },
      { pno: '00200', hr_mtu: 50000 },
      { pno: '00300', hr_mtu: 10000 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 25000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(false);
  });

  it('filters with multiple criteria (AND logic)', () => {
    const data = makeData([
      { pno: '00100', hr_mtu: 30000, unemployment_rate: 5 },
      { pno: '00200', hr_mtu: 50000, unemployment_rate: 15 },
      { pno: '00300', hr_mtu: 30000, unemployment_rate: 15 },
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 40000 },
      { layerId: 'unemployment', min: 0, max: 10 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true); // passes both
    expect(result.has('00200')).toBe(false); // fails income
    expect(result.has('00300')).toBe(false); // fails unemployment
  });

  it('excludes features with zero or null population', () => {
    const data = makeData([
      { pno: '00100', hr_mtu: 30000, he_vakiy: 0 },
      { pno: '00200', hr_mtu: 30000, he_vakiy: null as any },
      { pno: '00300', hr_mtu: 30000, he_vakiy: 1000 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(true);
  });

  it('excludes features with non-numeric filter values', () => {
    const data = makeData([
      { pno: '00100', hr_mtu: null as any },
      { pno: '00200', hr_mtu: NaN as any },
      { pno: '00300', hr_mtu: 30000 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(true);
  });

  it('returns stable empty set reference for no filters', () => {
    const data = makeData([{ pno: '00100' }]);
    const result1 = computeMatchingPnos(data, []);
    const result2 = computeMatchingPnos(data, []);
    expect(result1).toBe(result2); // Same reference for stability
  });

  it('includes outlier values when slider is at extreme range', () => {
    // This tests the boundary behavior: when min is at or below the layer's first stop,
    // values below the stop should still be included
    const data = makeData([
      { pno: '00100', hr_mtu: 5000 },  // Very low income (below typical stops)
      { pno: '00200', hr_mtu: 30000 },
    ]);

    // Using min=0 which should be at or below the first color stop
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(true);
  });
});
