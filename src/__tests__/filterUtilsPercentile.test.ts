/**
 * CF-7: percentile / relative-threshold mode for range filters.
 *
 * In percentile mode a criterion's min/max are 0–100 ranks over the active scope's
 * distribution, resolved to concrete metric values at filter time. These tests pin:
 *  - resolveCriterionBounds maps ranks → quantiles of the supplied feature set,
 *  - computeMatchingPnos selects exactly the band the ranks describe,
 *  - the band honours the scope (different feature sets → different resolved values),
 *  - the URL serializer round-trips the per-criterion mode (the trailing `~p` flag),
 *  - absolute criteria are byte-identical to the legacy encoding.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  computeMatchingPnos,
  resolveCriterionBounds,
  serializeFilters,
  deserializeFilters,
  type FilterCriterion,
} from '../utils/filterUtils';
import type { FeatureCollection, Feature } from 'geojson';

// Mock i18n to avoid localStorage / dictionary loading in the test environment.
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return { type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [0, 0] } };
}
function makeCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

// median_income reads `hr_mtu`. Build a clean 1..5 distribution of incomes so the
// quantiles are easy to reason about.
function incomeFc(values: number[]): FeatureCollection {
  return makeCollection(
    values.map((v, i) => makeFeature({ pno: `001${String(i).padStart(2, '0')}`, he_vakiy: 1000, hr_mtu: v })),
  );
}

describe('CF-7 resolveCriterionBounds', () => {
  it('passes absolute criteria through with the layer stop range', () => {
    const c: FilterCriterion = { layerId: 'median_income', min: 25000, max: 40000 };
    const r = resolveCriterionBounds(c, null);
    expect(r).not.toBeNull();
    expect(r!.valueMin).toBe(25000);
    expect(r!.valueMax).toBe(40000);
    // median_income stops are [15000 … 55000].
    expect(r!.rangeMin).toBe(15000);
    expect(r!.rangeMax).toBe(55000);
  });

  it('resolves percentile ranks to the scope distribution quantiles', () => {
    const fc = incomeFc([10000, 20000, 30000, 40000, 50000]);
    const c: FilterCriterion = { layerId: 'median_income', min: 0, max: 50, mode: 'percentile' };
    const r = resolveCriterionBounds(c, fc.features);
    expect(r).not.toBeNull();
    // p0 → min (10000), p50 → median observation (30000).
    expect(r!.valueMin).toBe(10000);
    expect(r!.valueMax).toBe(30000);
    // rangeMin/Max are the observed extremes, not the layer stops.
    expect(r!.rangeMin).toBe(10000);
    expect(r!.rangeMax).toBe(50000);
  });

  it('returns null for a percentile criterion with no data in scope', () => {
    expect(resolveCriterionBounds({ layerId: 'median_income', min: 0, max: 50, mode: 'percentile' }, [])).toBeNull();
    expect(resolveCriterionBounds({ layerId: 'median_income', min: 0, max: 50, mode: 'percentile' }, null)).toBeNull();
    // Features present but no value for the metric → empty distribution → null.
    const noIncome = makeCollection([makeFeature({ pno: '00100', he_vakiy: 1000 })]);
    expect(resolveCriterionBounds({ layerId: 'median_income', min: 0, max: 50, mode: 'percentile' }, noIncome.features)).toBeNull();
  });
});

describe('CF-7 computeMatchingPnos — percentile mode', () => {
  it('selects the bottom band [0,50]', () => {
    const fc = incomeFc([10000, 20000, 30000, 40000, 50000]);
    // p0..p50 → values 10000..30000 inclusive.
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 50, mode: 'percentile' }];
    const result = computeMatchingPnos(fc, filters);
    // 10000 (p0 → at-rail outlier inclusion), 20000, 30000 pass; 40000, 50000 excluded.
    expect(result).toEqual(new Set(['00100', '00101', '00102']));
  });

  it('selects the top band [50,100]', () => {
    const fc = incomeFc([10000, 20000, 30000, 40000, 50000]);
    // p50..p100 → values 30000..50000 inclusive.
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 50, max: 100, mode: 'percentile' }];
    const result = computeMatchingPnos(fc, filters);
    expect(result).toEqual(new Set(['00102', '00103', '00104']));
  });

  it('selecting the full [0,100] band matches every populated feature', () => {
    const fc = incomeFc([10000, 20000, 30000, 40000, 50000]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100, mode: 'percentile' }];
    const result = computeMatchingPnos(fc, filters);
    expect(result.size).toBe(5);
  });

  it('resolves against the active scope, so the same ranks pick different areas', () => {
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 50, max: 100, mode: 'percentile' }];
    // Scope A: incomes 10k..50k → top half is 30k+.
    const a = incomeFc([10000, 20000, 30000, 40000, 50000]);
    // Scope B: incomes 1k..5k → top half is 3k+; absolute thresholds would differ wildly.
    const b = makeCollection([
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 1000 }),
      makeFeature({ pno: '00201', he_vakiy: 1000, hr_mtu: 2000 }),
      makeFeature({ pno: '00202', he_vakiy: 1000, hr_mtu: 3000 }),
      makeFeature({ pno: '00203', he_vakiy: 1000, hr_mtu: 4000 }),
      makeFeature({ pno: '00204', he_vakiy: 1000, hr_mtu: 5000 }),
    ]);
    expect(computeMatchingPnos(a, filters)).toEqual(new Set(['00102', '00103', '00104']));
    expect(computeMatchingPnos(b, filters)).toEqual(new Set(['00202', '00203', '00204']));
  });

  it('drops an unresolvable percentile criterion but keeps other criteria meaningful', () => {
    // crime_rate reads `crime_index`, absent here, so the percentile criterion can't
    // resolve; the absolute income criterion must still apply on its own.
    const fc = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 50000 }),
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'crime_rate', min: 0, max: 50, mode: 'percentile' },
      { layerId: 'median_income', min: 25000, max: 40000 },
    ];
    const result = computeMatchingPnos(fc, filters);
    expect(result).toEqual(new Set(['00100']));
  });

  it('combines a percentile criterion with an absolute one (AND)', () => {
    const fc = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 50000, unemployment_rate: 3 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 40000, unemployment_rate: 12 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 4 }),
    ]);
    const filters: FilterCriterion[] = [
      // Top half of income within this scope (median 40000 → 40000..50000).
      { layerId: 'median_income', min: 50, max: 100, mode: 'percentile' },
      // Absolute unemployment cap.
      { layerId: 'unemployment', min: 0, max: 10 },
    ];
    const result = computeMatchingPnos(fc, filters);
    // 00100: income 50000 (top), unemployment 3 (ok) → match.
    // 00200: income 40000 (median, in top band) but unemployment 12 → fail.
    // 00300: income 30000 (bottom band) → fail.
    expect(result).toEqual(new Set(['00100']));
  });
});

describe('CF-7 serializeFilters / deserializeFilters — mode round-trip', () => {
  it('encodes absolute criteria identically to the legacy format', () => {
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 25000, max: 40000 }];
    expect(serializeFilters(filters)).toBe('median_income~25000~40000');
  });

  it('appends a ~p flag for percentile criteria', () => {
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20, max: 100, mode: 'percentile' }];
    expect(serializeFilters(filters)).toBe('median_income~20~100~p');
  });

  it('round-trips a mix of absolute and percentile criteria', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20, max: 80, mode: 'percentile' },
      { layerId: 'unemployment', min: 1, max: 5 },
    ];
    const round = deserializeFilters(serializeFilters(filters));
    expect(round).toEqual(filters);
  });

  it('still parses legacy 3-field absolute entries (no mode key)', () => {
    const round = deserializeFilters('median_income~25000~40000');
    expect(round).toEqual([{ layerId: 'median_income', min: 25000, max: 40000 }]);
  });

  it('rejects a bogus 4th field that is not the percentile flag', () => {
    expect(deserializeFilters('median_income~20~80~x')).toEqual([]);
  });

  it('drops percentile entries whose ranks fall outside [0,100]', () => {
    expect(deserializeFilters('median_income~-5~80~p')).toEqual([]);
    expect(deserializeFilters('median_income~20~150~p')).toEqual([]);
  });
});
