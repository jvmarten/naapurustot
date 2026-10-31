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
        pno: String(i).padStart(5, '0'),
        nimi: `Area ${i}`,
        namn: `Area ${i}`,
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...props,
      },
      geometry: null as unknown as GeoJSON.Geometry,
    })),
  };
}

describe('computeMatchingPnos — outlier inclusion at slider extremes', () => {
  // The unemployment layer has stops [3, 5, 7, 8.5, 10, 11.5, 13, 15, 18, 25]
  // When slider min is at 1 (the minimum stop), values below 1 should STILL be included

  it('includes values below range when slider min equals first stop', () => {
    const data = makeCollection([
      { unemployment_rate: 1.9 }, // below stop range (3–25)
      { unemployment_rate: 7.4 },
      { unemployment_rate: 33.8 }, // above stop range
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 3, max: 11.8 }, // min at first stop
    ];
    const result = computeMatchingPnos(data, filters);
    // 0.5 should be included (outlier below range, slider at extreme)
    expect(result.has('00000')).toBe(true);
    expect(result.has('00001')).toBe(true);
    expect(result.has('00002')).toBe(false); // 15 > 5
  });

  it('includes values above range when slider max equals last stop', () => {
    const data = makeCollection([
      { unemployment_rate: 1.9 },
      { unemployment_rate: 7.4 },
      { unemployment_rate: 33.8 }, // above stop range (3–25)
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 11.8, max: 25 }, // max at last stop
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00000')).toBe(false); // 0.5 < 5
    expect(result.has('00001')).toBe(false); // 3 < 5
    expect(result.has('00002')).toBe(true); // 15 included because slider max at extreme
  });

  it('excludes outliers when slider is NOT at extreme positions', () => {
    const data = makeCollection([
      { unemployment_rate: 1.9 },
      { unemployment_rate: 7.4 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 5.2, max: 22.8 }, // not at extremes (3 and 25)
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00000')).toBe(false); // 0.5 < 2
    expect(result.has('00001')).toBe(true);
  });
});

describe('computeMatchingPnos — AND semantics with multiple filters', () => {
  it('requires ALL filters to match', () => {
    const data = makeCollection([
      { unemployment_rate: 7.4, hr_mtu: 35000 }, // matches both
      { unemployment_rate: 7.4, hr_mtu: 10000 }, // matches unemployment, fails income
      { unemployment_rate: 33.8, hr_mtu: 35000 }, // fails unemployment, matches income
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 3, max: 11.8 },
      { layerId: 'median_income', min: 20000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00000')).toBe(true);
  });
});

describe('computeMatchingPnos — edge cases', () => {
  it('excludes features with zero population', () => {
    const data = makeCollection([{ he_vakiy: 0, unemployment_rate: 7.4 }]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 3, max: 25 },
    ];
    expect(computeMatchingPnos(data, filters).size).toBe(0);
  });

  it('excludes features with null property value', () => {
    const data = makeCollection([{ unemployment_rate: null }]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 3, max: 25 },
    ];
    expect(computeMatchingPnos(data, filters).size).toBe(0);
  });

  it('returns empty set for null data', () => {
    expect(computeMatchingPnos(null, [{ layerId: 'unemployment', min: 3, max: 11.8 }]).size).toBe(0);
  });

  it('returns empty set for empty filters', () => {
    const data = makeCollection([{ unemployment_rate: 11.8 }]);
    expect(computeMatchingPnos(data, []).size).toBe(0);
  });

  it('exact boundary values are inclusive', () => {
    const data = makeCollection([
      { unemployment_rate: 7.4 }, // exactly at min
      { unemployment_rate: 16.2 }, // exactly at max
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 7.4, max: 16.2 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(2);
  });
});
