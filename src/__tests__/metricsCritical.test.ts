/**
 * Critical tests for metrics.ts — ratio-based metro averages,
 * pctOfPop/pctOfHh conversion, change computation edge cases.
 */
import { describe, it, expect } from 'vitest';
import {
  computeMetroAverages,
  computeChangeMetrics,
  computeQuickWinMetrics,
  parseTrendSeries,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
  };
}

describe('computeMetroAverages — ratio-based metrics', () => {
  it('unemployment_rate is computed from raw counts, not averaged percentages', () => {
    // Area A: 100 unemployed, working-age pop 1000
    // Area B: 50 unemployed, working-age pop 500
    // Correct weighted = 150/1500 = 10.0%
    // (denominator is working-age population pt_vakiy, not total population)
    const features = [
      makeFeature({ he_vakiy: 1200, pt_tyott: 100, pt_vakiy: 1000 }),
      makeFeature({ pno: '00200', he_vakiy: 600, pt_tyott: 50, pt_vakiy: 500 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBeCloseTo(10.0, 1);
  });

  it('unemployment_rate correctly handles different rates per area', () => {
    // Area A: 200 unemployed, working-age pop 2000
    // Area B: 50 unemployed, working-age pop 100
    // Weighted: 250/2100 ≈ 11.9%
    // (denominator is working-age population pt_vakiy, not total population)
    const features = [
      makeFeature({ he_vakiy: 2500, pt_tyott: 200, pt_vakiy: 2000 }),
      makeFeature({ pno: '00200', he_vakiy: 150, pt_tyott: 50, pt_vakiy: 100 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBeCloseTo(11.9, 1);
  });

  it('higher_education_rate sums both ko_yl_kork and ko_al_kork', () => {
    // Both university and polytechnic degrees count
    const features = [
      makeFeature({ he_vakiy: 1000, ko_ika18y: 800, ko_yl_kork: 100, ko_al_kork: 200 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, ko_ika18y: 800, ko_yl_kork: 150, ko_al_kork: 50 }),
    ];
    const avg = computeMetroAverages(features);
    // (100+200+150+50) / (800+800) = 500/1600 = 31.25%
    expect(avg.higher_education_rate).toBeCloseTo(31.3, 1);
  });

  it('ownership_rate is based on household counts, not population', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, te_omis_as: 1000, te_taly: 2000 }),
      makeFeature({ pno: '00200', he_vakiy: 100, te_omis_as: 50, te_taly: 100 }),
    ];
    const avg = computeMetroAverages(features);
    // 1050/2100 = 50%
    expect(avg.ownership_rate).toBe(50);
  });

  it('population_density uses pinta_ala in m² converted to km²', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pinta_ala: 2_000_000 }), // 2 km², 5000/km²
      makeFeature({ pno: '00200', he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km², 5000/km²
    ];
    const avg = computeMetroAverages(features);
    // total 15000 pop / 3 km² = 5000/km²
    expect(avg.population_density).toBe(5000);
  });

  it('pctOfPop metrics convert percentage to count, then back', () => {
    // foreign_language_pct is pctOfPop
    // Area A: pop 1000, 10% foreign → 100 people
    // Area B: pop 3000, 20% foreign → 600 people
    // Weighted: 700/4000 = 17.5%
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBe(17.5);
  });

  it('pctOfHh metrics use household weight, not population', () => {
    // single_person_hh_pct is pctOfHh
    // Area A: 2000 households, 30% single → 600
    // Area B: 1000 households, 60% single → 600
    // Weighted: 1200/3000 = 40%
    const features = [
      makeFeature({ he_vakiy: 5000, te_taly: 2000, single_person_hh_pct: 30 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_taly: 1000, single_person_hh_pct: 60 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBe(40);
  });

  it('requirePositive excludes zero/negative values from average', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 0 }), // should be excluded
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 60000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only valid: 40000*1000 + 60000*1000 = 100M / 2000 = 50000
    expect(avg.hr_mtu).toBe(50000);
  });

  it('features with zero population are completely excluded', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 100000 }), // should be skipped
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(40000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('empty features array returns zero for all metrics', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.hr_mtu).toBe(0);
  });

  it('child_ratio sums he_0_2 and he_3_6', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 30, he_3_6: 40 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, he_0_2: 50, he_3_6: 60 }),
    ];
    const avg = computeMetroAverages(features);
    // (30+40+50+60) / 2000 * 100 = 9%
    expect(avg.child_ratio).toBe(9);
  });
});

describe('computeChangeMetrics — edge cases', () => {
  it('computes percentage change from first to last data point', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2019, 30000], [2020, 31000], [2021, 33000]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (33000-30000)/30000 * 100 = 10%
    expect(p.income_change_pct).toBe(10);
  });

  it('handles negative base value correctly with Math.abs', () => {
    // Edge case: first value is negative (e.g., trend going from -5 to 5)
    const f = makeFeature({
      income_history: JSON.stringify([[2019, -100], [2021, 100]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (100 - (-100)) / Math.abs(-100) * 100 = 200%
    expect(p.income_change_pct).toBe(200);
  });

  it('returns null when first value is zero (division by zero)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2019, 0], [2021, 100]]),
    });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('returns null for single data point', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2021, 100]]),
    });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('returns null for null/missing history', () => {
    const f = makeFeature({ income_history: null });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative change correctly', () => {
    const f = makeFeature({
      population_history: JSON.stringify([[2019, 1000], [2021, 900]]),
    });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).population_change_pct).toBe(-10);
  });
});

describe('parseTrendSeries — validation', () => {
  it('rejects non-array JSON', () => {
    expect(parseTrendSeries('{"a":1}')).toBeNull();
  });

  it('rejects arrays with non-pair elements', () => {
    expect(parseTrendSeries('[[2019, 100, 200]]')).toBeNull();
  });

  it('rejects arrays with string values', () => {
    expect(parseTrendSeries('[[2019, "abc"]]')).toBeNull();
  });

  it('rejects empty array', () => {
    expect(parseTrendSeries('[]')).toBeNull();
  });

  it('rejects single-element array', () => {
    expect(parseTrendSeries('[[2021, 100]]')).toBeNull();
  });

  it('accepts valid 2+ element arrays', () => {
    const result = parseTrendSeries('[[2019, 100], [2021, 200]]');
    expect(result).toEqual([[2019, 100], [2021, 200]]);
  });

  it('handles invalid JSON gracefully', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('handles undefined/null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
  });
});

describe('computeQuickWinMetrics — division safety and rounding', () => {
  it('youth_ratio_pct rounds to 1 decimal place', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_18_19: 33,
      he_20_24: 67,
      he_25_29: 100,
    });
    computeQuickWinMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (33+67+100)/1000 * 100 = 20%
    expect(p.youth_ratio_pct).toBe(20);
  });

  it('gender_ratio rounds to 2 decimal places', () => {
    const f = makeFeature({
      he_naiset: 333,
      he_miehet: 667,
    });
    computeQuickWinMetrics([f]);
    // 333/667 ≈ 0.4993... → rounds to 0.50
    expect((f.properties as NeighborhoodProperties).gender_ratio).toBe(0.50);
  });

  it('skips metrics when denominator is zero', () => {
    const f = makeFeature({
      he_vakiy: 0,
      he_18_19: 0,
      he_20_24: 0,
      he_25_29: 0,
    });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('skips metrics when required fields are null', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_18_19: null,
      he_20_24: 50,
      he_25_29: 50,
    });
    computeQuickWinMetrics([f]);
    // he_18_19 is null → youth_ratio_pct should not be computed
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('employment_rate uses pt_vakiy as denominator, not he_vakiy', () => {
    const f = makeFeature({
      he_vakiy: 2000,
      pt_tyoll: 500,
      pt_vakiy: 1000,
    });
    computeQuickWinMetrics([f]);
    // 500/1000 * 100 = 50%
    expect((f.properties as NeighborhoodProperties).employment_rate).toBe(50);
  });

  it('elderly_ratio_pct sums all 65+ age groups', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_65_69: 50,
      he_70_74: 40,
      he_75_79: 30,
      he_80_84: 20,
      he_85_: 10,
    });
    computeQuickWinMetrics([f]);
    // (50+40+30+20+10)/1000 * 100 = 15%
    expect((f.properties as NeighborhoodProperties).elderly_ratio_pct).toBe(15);
  });

  it('new_construction_pct uses ra_asunn as denominator', () => {
    const f = makeFeature({
      ra_raky: 5,
      ra_asunn: 200,
    });
    computeQuickWinMetrics([f]);
    // 5/200 * 100 = 2.5%
    expect((f.properties as NeighborhoodProperties).new_construction_pct).toBe(2.5);
  });
});
