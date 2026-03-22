/**
 * Critical tests for filterUtils.ts — outlier inclusion logic,
 * AND semantics, and edge cases in range boundary handling.
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeCollection(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      properties: {
        pno: String(i + 1).padStart(5, '0'),
        nimi: `Test${i}`,
        namn: `Test${i}`,
        he_vakiy: 1000,
        ...props,
      },
    })),
  };
}

describe('computeMatchingPnos — outlier inclusion at slider extremes', () => {
  it('includes values below stop range when slider min is at minimum stop', () => {
    // median_income layer has stops starting at some value.
    // When slider min = first stop, outliers below should be included.
    const data = makeCollection([
      { hr_mtu: 15000 }, // below typical stop range
      { hr_mtu: 30000 }, // within range
      { hr_mtu: 50000 }, // within range
    ]);

    // Filter with min at the layer's first stop value
    // The median_income layer has stops — when min is at the first stop,
    // values below should still be included
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 60000 },
    ];

    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(3); // All should match
  });

  it('multiple filters use AND semantics (all must match)', () => {
    const data = makeCollection([
      { hr_mtu: 40000, unemployment_rate: 5 },
      { hr_mtu: 40000, unemployment_rate: 20 },
      { hr_mtu: 20000, unemployment_rate: 5 },
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 30000, max: 60000 },
      { layerId: 'unemployment', min: 0, max: 10 },
    ];

    const result = computeMatchingPnos(data, filters);
    // Only first feature matches both: income >= 30k AND unemployment <= 10
    expect(result.size).toBe(1);
    expect(result.has('00001')).toBe(true);
  });

  it('excludes features with null property values', () => {
    const data = makeCollection([
      { hr_mtu: null },
      { hr_mtu: 40000 },
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 0, max: 100000 },
    ];

    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00002')).toBe(true);
  });

  it('excludes features with zero population', () => {
    const data = makeCollection([
      { he_vakiy: 0, hr_mtu: 40000 },
      { he_vakiy: 1000, hr_mtu: 40000 },
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 0, max: 100000 },
    ];

    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
  });

  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100000 }]);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty filters array', () => {
    const data = makeCollection([{ hr_mtu: 40000 }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });
});
