/**
 * Metrics — critical path tests for computeChangePct edge cases,
 * computeMetroAverages with pctOfPop/pctOfHh conversions,
 * and parseTrendSeries with already-parsed arrays.
 */
import { describe, it, expect } from 'vitest';
import {
  computeChangeMetrics,
  computeQuickWinMetrics,
  computeMetroAverages,
  parseTrendSeries,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      he_vakiy: 1000, ...props,
    } as NeighborhoodProperties,
  };
}

describe('parseTrendSeries — edge cases', () => {
  it('handles already-parsed array (non-string input)', () => {
    // The code does `typeof raw === 'string' ? JSON.parse(raw) : raw`
    // so passing an actual array should work
    const arr = [[2020, 100], [2021, 200]] as [number, number][];
    const result = parseTrendSeries(arr as unknown as string);
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('rejects tuples with 3 elements', () => {
    const result = parseTrendSeries('[[2020, 100, 5]]');
    expect(result).toBeNull();
  });

  it('rejects object instead of array', () => {
    const result = parseTrendSeries('{"year": 2020, "value": 100}');
    expect(result).toBeNull();
  });

  it('rejects array of strings', () => {
    const result = parseTrendSeries('[["2020", "100"], ["2021", "200"]]');
    expect(result).toBeNull();
  });

  it('accepts long series (10+ data points)', () => {
    const series = Array.from({ length: 20 }, (_, i) => [2000 + i, 100 + i * 10]);
    const result = parseTrendSeries(JSON.stringify(series));
    expect(result).toHaveLength(20);
  });
});

describe('computeChangeMetrics — edge cases not previously tested', () => {
  it('handles negative-to-positive change using abs(first) in denominator', () => {
    // first=-100, last=50 → ((50 - (-100)) / abs(-100)) * 100 = 150%
    const features = [
      makeFeature({
        income_history: JSON.stringify([
          [2020, -100],
          [2023, 50],
        ]),
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(150, 1);
  });

  it('handles last value of zero (100% decline)', () => {
    const features = [
      makeFeature({
        population_history: JSON.stringify([
          [2020, 500],
          [2023, 0],
        ]),
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.population_change_pct).toBe(-100);
  });

  it('handles very small fractional change', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([
          [2020, 100000],
          [2023, 100001],
        ]),
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(0.001, 3);
  });

  it('sets all three change metrics independently', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2020, 100], [2023, 200]]),
        population_history: JSON.stringify([[2020, 50], [2023, 100]]),
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBe(100);
    expect(p.population_change_pct).toBe(100);
    expect(p.unemployment_change_pct).toBeNull();
  });
});

describe('computeQuickWinMetrics — precision and boundary values', () => {
  it('computes correct youth_ratio_pct with very small population', () => {
    const features = [
      makeFeature({
        he_vakiy: 3,
        he_18_19: 1,
        he_20_24: 1,
        he_25_29: 1,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBe(100.0);
  });

  it('computes gender_ratio correctly when women > men', () => {
    const features = [
      makeFeature({
        he_naiset: 600,
        he_miehet: 400,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.gender_ratio).toBe(1.5);
  });

  it('does not set any metric when population is zero', () => {
    const features = [
      makeFeature({
        he_vakiy: 0,
        he_18_19: 10,
        he_20_24: 10,
        he_25_29: 10,
        he_naiset: 20,
        he_miehet: 10,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
    // gender_ratio doesn't depend on pop, only miehet > 0
    expect(p.gender_ratio).toBe(2.0);
  });

  it('handles all metrics on a single feature', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_18_19: 50, he_20_24: 80, he_25_29: 70,
        he_naiset: 520, he_miehet: 480,
        te_eil_np: 30, te_taly: 400, te_laps: 120,
        tp_tyopy: 500, tp_j_info: 50, tp_q_terv: 80,
        pt_tyoll: 700, pt_vakiy: 800,
        he_65_69: 40, he_70_74: 30, he_75_79: 20, he_80_84: 10, he_85_: 5,
        ra_raky: 5, ra_asunn: 200,
        tp_jalo_bf: 100, tp_o_julk: 60, tp_palv_gu: 200,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.youth_ratio_pct).toBe(20.0); // (50+80+70)/1000 * 100 = 20.0
    expect(p.gender_ratio).toBe(1.08);    // 520/480 = 1.08333 → rounded to 1.08
    expect(p.single_parent_hh_pct).toBe(7.5); // 30/400 * 100 = 7.5
    expect(p.families_with_children_pct).toBe(30.0); // 120/400 * 100 = 30.0
    expect(p.tech_sector_pct).toBe(10.0); // 50/500 * 100 = 10.0
    expect(p.healthcare_workers_pct).toBe(16.0); // 80/500 * 100 = 16.0
    expect(p.employment_rate).toBe(87.5); // 700/800 * 100 = 87.5
    expect(p.elderly_ratio_pct).toBe(10.5); // (40+30+20+10+5)/1000 * 100 = 10.5
    expect(p.avg_household_size).toBe(2.5); // 1000/400 = 2.5
    expect(p.manufacturing_jobs_pct).toBe(20.0);
    expect(p.public_sector_jobs_pct).toBe(12.0);
    expect(p.service_sector_jobs_pct).toBe(40.0);
    expect(p.new_construction_pct).toBe(2.5); // 5/200 * 100 = 2.5
  });
});

describe('computeMetroAverages — pctOfPop and pctOfHh conversions', () => {
  it('correctly converts pctOfPop back to percentage', () => {
    // foreign_language_pct is pctOfPop
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }), // 100 people
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 20 }), // 600 people
    ];
    const avg = computeMetroAverages(features);
    // Total foreign: 100 + 600 = 700, total pop: 4000 → 17.5%
    expect(avg.foreign_language_pct).toBe(17.5);
  });

  it('correctly converts pctOfHh back to percentage', () => {
    // single_person_hh_pct is pctOfHh
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 40 }), // 200 single hh
      makeFeature({ he_vakiy: 1000, te_taly: 300, single_person_hh_pct: 20 }), // 60 single hh
    ];
    const avg = computeMetroAverages(features);
    // Total single: 200 + 60 = 260, total hh: 500 + 300 = 800 → 32.5%
    expect(avg.single_person_hh_pct).toBe(32.5);
  });

  it('skips features with zero population', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only the second feature contributes
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('skips features with null population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 2000, hr_mtu: 25000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(25000);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('respects requirePositive flag for income', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    // hr_mtu=0 is excluded (requirePositive), only 30000 contributes
    expect(avg.hr_mtu).toBe(30000);
  });

  it('computes ratio-based metrics correctly (unemployment_rate)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 800 }),
      makeFeature({ he_vakiy: 2000, pt_tyott: 200, pt_vakiy: 1600 }),
    ];
    const avg = computeMetroAverages(features);
    // totalUnemployed=250, totalActPop=2400 → 250/2400*100 = 10.416... → 10.4
    expect(avg.unemployment_rate).toBe(10.4);
  });

  it('computes higher_education_rate summing both university and polytechnic', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 200, ko_ika18y: 800 }),
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 150, ko_al_kork: 50, ko_ika18y: 700 }),
    ];
    const avg = computeMetroAverages(features);
    // totalHigherEd = 100+200+150+50 = 500, totalAdultPop = 800+700 = 1500
    // 500/1500*100 = 33.333... → 33.3
    expect(avg.higher_education_rate).toBe(33.3);
  });

  it('uses pt_vakiy for active pop, falls back to he_vakiy when null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: null, pt_tyott: 100 }),
    ];
    const avg = computeMetroAverages(features);
    // pt_vakiy is null → totalActPop uses he_vakiy (1000)
    // unemployment_rate = 100/1000*100 = 10.0
    expect(avg.unemployment_rate).toBe(10.0);
  });

  it('population_density converts m² to km²', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pinta_ala: 2_000_000 }), // 2 km²
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(5000); // 10000 / 2 = 5000 per km²
  });

  it('handles empty features array', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.higher_education_rate).toBe(0);
  });
});
