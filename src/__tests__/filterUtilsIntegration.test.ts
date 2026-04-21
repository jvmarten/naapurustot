/**
 * Integration tests for filterUtils.ts — tests the full filter pipeline
 * that powers the FilterPanel's "matching neighborhoods" feature.
 *
 * Critical behavior:
 * - Multi-criteria AND logic (all filters must pass)
 * - Outlier inclusion at slider extremes
 * - Features with null/non-numeric values are excluded
 * - Features with zero/null population are excluded
 * - Empty filters return the stable EMPTY_SET
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';

function makeData(features: Array<{ pno: string; he_vakiy: number | null; [key: string]: unknown }>): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props) => ({
      type: 'Feature' as const,
      properties: props,
      geometry: { type: 'Point' as const, coordinates: [24.94, 60.17] },
    })),
  };
}

describe('computeMatchingPnos — basic filtering', () => {
  const data = makeData([
    { pno: '00100', he_vakiy: 5000, hr_mtu: 30000, unemployment_rate: 5 },
    { pno: '00200', he_vakiy: 3000, hr_mtu: 20000, unemployment_rate: 8 },
    { pno: '00300', he_vakiy: 4000, hr_mtu: 45000, unemployment_rate: 3 },
  ]);

  it('single filter narrows results correctly', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 50000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true); // 30000 in range
    expect(result.has('00200')).toBe(false); // 20000 below min
    expect(result.has('00300')).toBe(true); // 45000 in range
  });

  it('multiple filters use AND logic', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 50000 },
      { layerId: 'unemployment', min: 1, max: 6 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true); // income ok, unemployment 5 ok
    expect(result.has('00200')).toBe(false); // income below min
    expect(result.has('00300')).toBe(true); // income ok, unemployment 3 ok
  });
});

describe('computeMatchingPnos — outlier inclusion at extremes', () => {
  const data = makeData([
    { pno: '00100', he_vakiy: 5000, hr_mtu: 10000 }, // below first stop
    { pno: '00200', he_vakiy: 3000, hr_mtu: 30000 }, // middle of stops
    { pno: '00300', he_vakiy: 4000, hr_mtu: 80000 }, // above last stop
  ]);

  it('includes values below first stop when slider min is at first stop', () => {
    // median_income stops start at 15000
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    // 00100 has hr_mtu=10000 which is below min=15000, but since min=15000
    // equals the first stop (rangeMin), values beyond are included
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(true);
    expect(result.has('00300')).toBe(true); // 80000 > 55000, max=55000 = last stop?
    // Actually need to check: median_income last stop is 55000
  });

  it('includes values above last stop when slider max is at last stop', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    // 80000 > 55000, but max=55000 equals the last stop, so outliers are included
    expect(result.has('00300')).toBe(true);
  });
});

describe('computeMatchingPnos — null and zero population handling', () => {
  it('excludes features with null population', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: null, hr_mtu: 30000 },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with zero population', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 0, hr_mtu: 30000 },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with non-numeric property values', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 5000, hr_mtu: 'N/A' },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with null property values', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 5000, hr_mtu: null },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });
});

describe('computeMatchingPnos — empty input handling', () => {
  it('returns empty set for empty filters', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [
      { layerId: 'median_income', min: 0, max: 100000 },
    ]);
    expect(result.size).toBe(0);
  });

  it('returns stable reference for repeated calls with no filters', () => {
    const data = makeData([{ pno: '00100', he_vakiy: 5000, hr_mtu: 30000 }]);
    const r1 = computeMatchingPnos(data, []);
    const r2 = computeMatchingPnos(data, []);
    expect(r1).toBe(r2); // same reference (EMPTY_SET)
  });
});

describe('computeMatchingPnos — NaN and Infinity handling', () => {
  it('excludes features with NaN values', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 5000, hr_mtu: NaN },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with Infinity values', () => {
    const data = makeData([
      { pno: '00100', he_vakiy: 5000, hr_mtu: Infinity },
      { pno: '00200', he_vakiy: 5000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });
});
