/**
 * Filter utils — range slider behavior and outlier handling.
 *
 * Priority 2: User-facing filter logic. Wrong matching causes neighborhoods
 * to appear/disappear incorrectly from the map.
 *
 * Targets untested paths:
 * - Outlier inclusion when slider is at extreme positions
 * - Non-numeric property values excluded
 * - AND logic across multiple simultaneous filters
 * - Features with he_vakiy <= 0 excluded
 * - Empty filter array returns EMPTY_SET (stable reference)
 * - Null data returns EMPTY_SET
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeData(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      properties: {
        pno: String(i + 100).padStart(5, '0'),
        nimi: 'Test',
        namn: 'Test',
        kunta: null,
        city: null,
        he_vakiy: 1000,
        ...props,
      },
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
    })),
  };
}

describe('computeMatchingPnos — basic matching', () => {
  it('returns pnos within the filter range', () => {
    const data = makeData([
      { hr_mtu: 20000 },
      { hr_mtu: 30000 },
      { hr_mtu: 40000 },
      { hr_mtu: 50000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 45000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(2);
    expect(result.has('00101')).toBe(true);
    expect(result.has('00102')).toBe(true);
  });

  it('uses inclusive boundaries (min and max included)', () => {
    const data = makeData([
      { hr_mtu: 25000 },
      { hr_mtu: 45000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 45000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(2);
  });
});

describe('computeMatchingPnos — outlier handling at slider extremes', () => {
  it('includes values below stop range when slider min is at range minimum', () => {
    // median_income stops start at 15000
    const data = makeData([
      { hr_mtu: 12000 }, // below stop range, should be included when slider at min
      { hr_mtu: 20000 },
      { hr_mtu: 50000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 30000 }, // min is at range minimum
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true); // 12000 included (below range, slider at min)
    expect(result.has('00101')).toBe(true); // 20000 within range
    expect(result.has('00102')).toBe(false); // 50000 above max
  });

  it('includes values above stop range when slider max is at range maximum', () => {
    // median_income stops end at 55000
    const data = makeData([
      { hr_mtu: 20000 },
      { hr_mtu: 50000 },
      { hr_mtu: 70000 }, // above stop range
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 40000, max: 55000 }, // max is at range maximum
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false); // 20000 below min
    expect(result.has('00101')).toBe(true); // 50000 within range
    expect(result.has('00102')).toBe(true); // 70000 included (above range, slider at max)
  });
});

describe('computeMatchingPnos — non-numeric values', () => {
  it('excludes features with null property values', () => {
    const data = makeData([
      { hr_mtu: null },
      { hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00101')).toBe(true);
  });

  it('excludes features with NaN property values', () => {
    const data = makeData([
      { hr_mtu: NaN },
      { hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
  });

  it('excludes features with Infinity property values', () => {
    const data = makeData([
      { hr_mtu: Infinity },
      { hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
  });
});

describe('computeMatchingPnos — AND logic with multiple filters', () => {
  it('requires all filters to match (AND logic)', () => {
    const data = makeData([
      { hr_mtu: 30000, unemployment_rate: 3 },
      { hr_mtu: 30000, unemployment_rate: 8 },
      { hr_mtu: 50000, unemployment_rate: 3 },
      { hr_mtu: 50000, unemployment_rate: 8 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 35000 },
      { layerId: 'unemployment', min: 2, max: 5 },
    ];
    const result = computeMatchingPnos(data, filters);
    // Only first feature matches both
    expect(result.size).toBe(1);
    expect(result.has('00100')).toBe(true);
  });
});

describe('computeMatchingPnos — population filter', () => {
  it('excludes features with he_vakiy <= 0', () => {
    const data = makeData([
      { he_vakiy: 0, hr_mtu: 30000 },
      { he_vakiy: -1, hr_mtu: 30000 },
      { he_vakiy: 1000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00102')).toBe(true);
  });

  it('excludes features with null he_vakiy', () => {
    const data = makeData([
      { he_vakiy: null, hr_mtu: 30000 },
      { he_vakiy: 1000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
  });
});

describe('computeMatchingPnos — empty/null inputs', () => {
  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100 }]);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty filters array', () => {
    const data = makeData([{ hr_mtu: 30000 }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns stable empty set reference for repeated calls with no filters', () => {
    const data = makeData([{ hr_mtu: 30000 }]);
    const r1 = computeMatchingPnos(data, []);
    const r2 = computeMatchingPnos(data, []);
    expect(r1).toBe(r2); // same reference (EMPTY_SET)
  });

  it('returns stable empty set for null data across calls', () => {
    const r1 = computeMatchingPnos(null, []);
    const r2 = computeMatchingPnos(null, []);
    expect(r1).toBe(r2);
  });
});
