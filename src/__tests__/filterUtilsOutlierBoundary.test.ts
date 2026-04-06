/**
 * Tests for filterUtils outlier boundary logic at slider extremes.
 *
 * The key behavior: when the slider is at its extreme position (equal to
 * the layer's min/max stop), neighborhoods with outlier values beyond
 * the stop range are INCLUDED. When the slider moves away from the extreme,
 * those outliers are EXCLUDED.
 *
 * This logic is at filterUtils.ts:49:
 *   const minOk = r.min <= r.rangeMin || value >= r.min;
 *   const maxOk = r.max >= r.rangeMax || value <= r.max;
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

// median_income layer: stops range [15000, 55000]
function makeData(neighborhoods: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: neighborhoods.map((p, i) => ({
      type: 'Feature' as const,
      properties: {
        pno: String(i).padStart(5, '0'),
        nimi: `Area ${i}`,
        namn: `Area ${i}`,
        he_vakiy: 1000,
        ...p,
      },
      geometry: { type: 'Point' as const, coordinates: [25, 60] },
    })),
  };
}

describe('filterUtils — outlier inclusion at slider extremes', () => {
  const data = makeData([
    { pno: '00001', hr_mtu: 10000 },  // below min stop (15000)
    { pno: '00002', hr_mtu: 15000 },  // at min stop
    { pno: '00003', hr_mtu: 35000 },  // in range
    { pno: '00004', hr_mtu: 55000 },  // at max stop
    { pno: '00005', hr_mtu: 80000 },  // above max stop (55000)
  ]);

  it('slider at full range includes outliers on both ends', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    // All 5 neighborhoods should match — outliers included when slider at extremes
    expect(result.size).toBe(5);
    expect(result.has('00001')).toBe(true); // below min stop, but slider at min
    expect(result.has('00005')).toBe(true); // above max stop, but slider at max
  });

  it('slider moved above min excludes low outliers', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    // 00001 (10000) and 00002 (15000) should be excluded
    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(false);
    expect(result.has('00003')).toBe(true);
    expect(result.has('00004')).toBe(true);
    expect(result.has('00005')).toBe(true); // max slider still at extreme
  });

  it('slider moved below max excludes high outliers', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 40000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(true); // min slider still at extreme
    expect(result.has('00003')).toBe(true);
    expect(result.has('00004')).toBe(false); // 55000 > 40000
    expect(result.has('00005')).toBe(false); // 80000 > 40000
  });

  it('slider narrowed on both ends excludes both outliers', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 50000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(false); // 10000 < 20000
    expect(result.has('00002')).toBe(false); // 15000 < 20000
    expect(result.has('00003')).toBe(true);  // 35000 in [20000, 50000]
    expect(result.has('00004')).toBe(false); // 55000 > 50000
    expect(result.has('00005')).toBe(false); // 80000 > 50000
  });
});

describe('filterUtils — neighborhoods with missing or invalid values', () => {
  it('neighborhoods with null metric value are excluded by any filter', () => {
    const data = makeData([
      { pno: '00001', hr_mtu: null },
      { pno: '00002', hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(true);
  });

  it('neighborhoods with NaN metric value are excluded', () => {
    const data = makeData([
      { pno: '00001', hr_mtu: NaN },
      { pno: '00002', hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(false);
  });

  it('neighborhoods with zero population are excluded', () => {
    const data = makeData([
      { pno: '00001', he_vakiy: 0, hr_mtu: 30000 },
      { pno: '00002', he_vakiy: 1000, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(true);
  });
});

describe('filterUtils — multiple concurrent filters', () => {
  it('all filters must match (AND logic)', () => {
    const data = makeData([
      { pno: '00001', hr_mtu: 40000, unemployment_rate: 5 },  // both in range
      { pno: '00002', hr_mtu: 40000, unemployment_rate: 15 }, // income ok, unemployment 15 (outlier above max stop 11)
      { pno: '00003', hr_mtu: 10000, unemployment_rate: 3 },  // income below slider min, unemployment ok
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 55000 },
      // unemployment stops: [1..11], slider at max=11 → outliers above ARE included
      { layerId: 'unemployment', min: 1, max: 11 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(true);
    // 00002: income 40k ok (in range), unemployment 15 > 11 but max slider at extreme → included
    expect(result.has('00002')).toBe(true);
    // 00003: income 10k < 20000 slider AND min slider NOT at extreme (20000 > 15000) → excluded
    expect(result.has('00003')).toBe(false);
  });

  it('moving unemployment slider away from max excludes high outliers', () => {
    const data = makeData([
      { pno: '00001', hr_mtu: 40000, unemployment_rate: 5 },
      { pno: '00002', hr_mtu: 40000, unemployment_rate: 15 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
      // Move max slider to 8 (not at extreme 11) → outliers excluded
      { layerId: 'unemployment', min: 1, max: 8 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(true);  // unemployment 5 <= 8
    expect(result.has('00002')).toBe(false);  // unemployment 15 > 8, slider not at extreme
  });

  it('empty filters return empty set', () => {
    const data = makeData([{ pno: '00001', hr_mtu: 30000 }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('null data returns empty set', () => {
    const result = computeMatchingPnos(null, [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ]);
    expect(result.size).toBe(0);
  });
});
