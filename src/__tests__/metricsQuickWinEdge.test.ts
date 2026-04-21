/**
 * Edge case tests for computeQuickWinMetrics and computeChangeMetrics.
 *
 * These functions mutate feature properties in-place — bugs here mean
 * wrong values in the neighborhood panel and wrong metro averages.
 *
 * Focus:
 * - Division by zero protection (population=0, households=0, jobs=0)
 * - Rounding precision (1 decimal place for percentages, 2 for ratios)
 * - computeChangePct edge cases (first value 0, negative first, single data point)
 * - parseTrendSeries validation (malformed JSON, non-array, single point)
 */
import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics, computeChangeMetrics, parseTrendSeries } from '../utils/metrics';

function makeFeature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('computeQuickWinMetrics — division by zero protection', () => {
  it('does not compute youth_ratio when population is 0', () => {
    const f = makeFeature({
      he_vakiy: 0, he_18_19: 100, he_20_24: 100, he_25_29: 100,
    });
    computeQuickWinMetrics([f]);
    expect(f.properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not compute youth_ratio when population is null', () => {
    const f = makeFeature({
      he_vakiy: null, he_18_19: 100, he_20_24: 100, he_25_29: 100,
    });
    computeQuickWinMetrics([f]);
    expect(f.properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not compute gender_ratio when he_miehet is 0', () => {
    const f = makeFeature({ he_naiset: 500, he_miehet: 0 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.gender_ratio).toBeUndefined();
  });

  it('does not compute single_parent_hh_pct when te_taly is 0', () => {
    const f = makeFeature({ te_eil_np: 100, te_taly: 0 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.single_parent_hh_pct).toBeUndefined();
  });

  it('does not compute tech_sector_pct when tp_tyopy is 0', () => {
    const f = makeFeature({ tp_j_info: 50, tp_tyopy: 0 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.tech_sector_pct).toBeUndefined();
  });

  it('does not compute employment_rate when pt_vakiy is 0', () => {
    const f = makeFeature({ pt_tyoll: 500, pt_vakiy: 0 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.employment_rate).toBeUndefined();
  });

  it('does not compute new_construction_pct when ra_asunn is 0', () => {
    const f = makeFeature({ ra_raky: 5, ra_asunn: 0 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.new_construction_pct).toBeUndefined();
  });
});

describe('computeQuickWinMetrics — rounding precision', () => {
  it('youth_ratio_pct has exactly 1 decimal place', () => {
    const f = makeFeature({
      he_vakiy: 10000, he_18_19: 333, he_20_24: 333, he_25_29: 334,
    });
    computeQuickWinMetrics([f]);
    const val = f.properties!.youth_ratio_pct as number;
    // (333+333+334)/10000 = 0.1 = 10.0%
    expect(val).toBe(10);
    expect(String(val).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it('gender_ratio has exactly 2 decimal places', () => {
    const f = makeFeature({ he_naiset: 5100, he_miehet: 4900, he_vakiy: 10000 });
    computeQuickWinMetrics([f]);
    const val = f.properties!.gender_ratio as number;
    // 5100/4900 = 1.0408... → rounds to 1.04
    expect(val).toBe(1.04);
  });

  it('avg_household_size has 2 decimal places', () => {
    const f = makeFeature({ he_vakiy: 10000, te_taly: 4500 });
    computeQuickWinMetrics([f]);
    const val = f.properties!.avg_household_size as number;
    // 10000/4500 = 2.2222... → rounds to 2.22
    expect(val).toBe(2.22);
  });
});

describe('computeQuickWinMetrics — correct metric computation', () => {
  it('elderly_ratio_pct sums all 65+ age groups', () => {
    const f = makeFeature({
      he_vakiy: 10000,
      he_65_69: 500, he_70_74: 400, he_75_79: 300, he_80_84: 200, he_85_: 100,
    });
    computeQuickWinMetrics([f]);
    // (500+400+300+200+100)/10000 = 15%
    expect(f.properties!.elderly_ratio_pct).toBe(15);
  });

  it('families_with_children_pct uses te_laps / te_taly', () => {
    const f = makeFeature({ te_laps: 200, te_taly: 1000, he_vakiy: 5000 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.families_with_children_pct).toBe(20);
  });

  it('healthcare_workers_pct uses tp_q_terv / tp_tyopy', () => {
    const f = makeFeature({ tp_q_terv: 150, tp_tyopy: 1000, he_vakiy: 5000 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.healthcare_workers_pct).toBe(15);
  });

  it('manufacturing_jobs_pct uses tp_jalo_bf / tp_tyopy', () => {
    const f = makeFeature({ tp_jalo_bf: 200, tp_tyopy: 1000, he_vakiy: 5000 });
    computeQuickWinMetrics([f]);
    expect(f.properties!.manufacturing_jobs_pct).toBe(20);
  });
});

describe('computeChangeMetrics — percentage change computation', () => {
  it('positive change: income increased from 30000 to 35000 = +16.67%', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2020, 30000], [2024, 35000]]),
    });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeCloseTo(16.67, 1);
  });

  it('negative change: unemployment decreased from 8 to 6 = -25%', () => {
    const f = makeFeature({
      unemployment_history: JSON.stringify([[2020, 8], [2024, 6]]),
    });
    computeChangeMetrics([f]);
    expect(f.properties!.unemployment_change_pct).toBe(-25);
  });

  it('handles first value = 0 (returns null to avoid division by zero)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2020, 0], [2024, 5000]]),
    });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeNull();
  });

  it('handles null history (returns null)', () => {
    const f = makeFeature({ income_history: null });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeNull();
  });

  it('handles single data point (returns null)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2024, 35000]]),
    });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeNull();
  });

  it('uses absolute value of first for negative starting values', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2020, -10], [2024, -5]]),
    });
    computeChangeMetrics([f]);
    // (-5 - -10) / |-10| * 100 = 5/10 * 100 = 50%
    expect(f.properties!.income_change_pct).toBe(50);
  });
});

describe('parseTrendSeries — validation', () => {
  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2020,30000],[2024,35000]]');
    expect(result).toEqual([[2020, 30000], [2024, 35000]]);
  });

  it('returns null for null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('returns null for single data point (requires >= 2)', () => {
    expect(parseTrendSeries('[[2024,35000]]')).toBeNull();
  });

  it('returns null for non-array entries', () => {
    expect(parseTrendSeries('[{"year":2020,"value":30000}]')).toBeNull();
  });

  it('returns null for arrays with non-numeric values', () => {
    expect(parseTrendSeries('[["2020",30000],[2024,35000]]')).toBeNull();
  });

  it('returns null for entries with wrong length', () => {
    expect(parseTrendSeries('[[2020,30000,extra],[2024,35000]]')).toBeNull();
  });

  it('returns null for entries containing NaN', () => {
    expect(parseTrendSeries('[[NaN,30000],[2024,35000]]')).toBeNull();
  });

  it('returns null for entries containing Infinity', () => {
    // JSON.parse won't produce Infinity from "Infinity" — it would throw
    // But we test with well-formed JSON that might have edge values
    const result = parseTrendSeries('[[2020,1e309],[2024,35000]]');
    expect(result).toBeNull(); // 1e309 = Infinity
  });

  it('caches parsed results for the same string', () => {
    const json = '[[2020,10],[2024,20]]';
    const r1 = parseTrendSeries(json);
    const r2 = parseTrendSeries(json);
    expect(r1).toBe(r2); // same reference from cache
  });
});
