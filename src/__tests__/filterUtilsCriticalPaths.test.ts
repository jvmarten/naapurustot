import { describe, it, expect } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFC(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [24.9, 60.2] },
      properties: {
        pno: `0010${i}`, nimi: `Test ${i}`, namn: `Test ${i}`, kunta: '091', city: 'helsinki',
        he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 7, higher_education_rate: 40,
        ...props,
      },
    })),
  };
}

describe('computeMatchingPnos critical paths', () => {
  it('returns EMPTY_SET for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 20000, max: 40000 }]);
    expect(result.size).toBe(0);
  });

  it('returns EMPTY_SET for empty filters', () => {
    const data = makeFC([{ hr_mtu: 30000 }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns same EMPTY_SET reference for repeated calls with no filters', () => {
    const r1 = computeMatchingPnos(null, []);
    const r2 = computeMatchingPnos(makeFC([]), []);
    expect(r1).toBe(r2); // identity check
  });

  it('filters neighborhoods within range', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 25000, he_vakiy: 1000 },
      { pno: '00200', hr_mtu: 35000, he_vakiy: 1000 },
      { pno: '00300', hr_mtu: 50000, he_vakiy: 1000 },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(true);
    expect(result.has('00300')).toBe(false);
  });

  it('extreme slider position includes outliers below min stop', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 5000, he_vakiy: 1000 }, // below min stop of 15000
      { pno: '00200', hr_mtu: 25000, he_vakiy: 1000 },
    ]);
    // min at first stop (15000) = extreme position
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    // value 5000 is below the stop range, but since slider is at extreme min,
    // outliers are included
    expect(result.has('00100')).toBe(true);
  });

  it('extreme slider position includes outliers above max stop', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 25000, he_vakiy: 1000 },
      { pno: '00200', hr_mtu: 70000, he_vakiy: 1000 }, // above max stop of 55000
    ]);
    // max at last stop (55000) = extreme position
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00200')).toBe(true);
  });

  it('non-extreme slider excludes values beyond range', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 70000, he_vakiy: 1000 },
    ]);
    // max at 40000 (not the last stop of 55000) — not extreme
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
  });

  it('excludes features with non-numeric property values', () => {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { pno: '00100', he_vakiy: 1000, hr_mtu: 'N/A' },
      }],
    };
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
  });

  it('excludes features with NaN property values', () => {
    const data = makeFC([{ pno: '00100', hr_mtu: NaN, he_vakiy: 1000 }]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
  });

  it('excludes features with zero or null population', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 30000, he_vakiy: 0 },
      { pno: '00200', hr_mtu: 30000, he_vakiy: null },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(0);
  });

  it('multiple filters are ANDed together', () => {
    const data = makeFC([
      { pno: '00100', hr_mtu: 30000, unemployment_rate: 5, he_vakiy: 1000 },
      { pno: '00200', hr_mtu: 30000, unemployment_rate: 15, he_vakiy: 1000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
      { layerId: 'unemployment', min: 1, max: 8 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(false);
  });
});
