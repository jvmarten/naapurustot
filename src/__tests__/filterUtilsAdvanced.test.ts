import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeCollection(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      properties: {
        pno: `001${String(i).padStart(2, '0')}`,
        nimi: `Area ${i}`,
        namn: `Område ${i}`,
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...props,
      },
      geometry: { type: 'Point' as const, coordinates: [24.94, 60.17] },
    })),
  };
}

describe('computeMatchingPnos', () => {
  it('returns stable empty set when no filters provided', () => {
    const data = makeCollection([{ hr_mtu: 30000 }]);
    const result1 = computeMatchingPnos(data, []);
    const result2 = computeMatchingPnos(data, []);
    // Should be the same reference (stable empty set for memo optimization)
    expect(result1).toBe(result2);
    expect(result1.size).toBe(0);
  });

  it('returns stable empty set when data is null', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100000 }]);
    expect(result.size).toBe(0);
  });

  it('filters by single criterion', () => {
    const data = makeCollection([
      { hr_mtu: 20000 },
      { hr_mtu: 30000 },
      { hr_mtu: 50000 },
    ]);
    const filter: FilterCriterion = { layerId: 'median_income', min: 25000, max: 40000 };
    const result = computeMatchingPnos(data, [filter]);
    expect(result.size).toBe(1);
    expect(result.has('00101')).toBe(true);
  });

  it('applies AND logic for multiple criteria', () => {
    const data = makeCollection([
      { hr_mtu: 30000, unemployment_rate: 5 },
      { hr_mtu: 30000, unemployment_rate: 15 },
      { hr_mtu: 50000, unemployment_rate: 5 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 35000 },
      { layerId: 'unemployment', min: 1, max: 10 },
    ];
    const result = computeMatchingPnos(data, filters);
    // Only first matches both criteria
    expect(result.size).toBe(1);
    expect(result.has('00100')).toBe(true);
  });

  it('excludes features with null/missing values', () => {
    const data = makeCollection([
      { hr_mtu: null },
      { hr_mtu: 30000 },
    ]);
    const filter: FilterCriterion = { layerId: 'median_income', min: 0, max: 100000 };
    const result = computeMatchingPnos(data, [filter]);
    expect(result.size).toBe(1);
  });

  it('excludes features with zero or negative population', () => {
    const data = makeCollection([
      { he_vakiy: 0, hr_mtu: 30000 },
      { he_vakiy: -1, hr_mtu: 30000 },
      { he_vakiy: 1000, hr_mtu: 30000 },
    ]);
    const filter: FilterCriterion = { layerId: 'median_income', min: 0, max: 100000 };
    const result = computeMatchingPnos(data, [filter]);
    expect(result.size).toBe(1);
  });

  it('includes outlier values when slider is at extreme positions', () => {
    // When criterion.min <= rangeMin, all values below rangeMin are included
    // When criterion.max >= rangeMax, all values above rangeMax are included
    const data = makeCollection([
      { unemployment_rate: 0.5 },  // below stops range
      { unemployment_rate: 5 },    // within range
      { unemployment_rate: 20 },   // above stops range
    ]);
    // Unemployment layer stops: [1, ..., 11]
    // Setting min=1 (at rangeMin) and max=11 (at rangeMax) should include all outliers
    const filter: FilterCriterion = { layerId: 'unemployment', min: 1, max: 11 };
    const result = computeMatchingPnos(data, [filter]);
    expect(result.size).toBe(3); // all included because sliders at extremes
  });

  it('excludes outlier values when slider is not at extreme', () => {
    const data = makeCollection([
      { unemployment_rate: 0.5 },  // below stops range
      { unemployment_rate: 5 },    // within range
    ]);
    // Setting min=2 (NOT at rangeMin of 1) means 0.5 should be excluded
    const filter: FilterCriterion = { layerId: 'unemployment', min: 2, max: 11 };
    const result = computeMatchingPnos(data, [filter]);
    expect(result.size).toBe(1); // only 5 matches
  });
});
