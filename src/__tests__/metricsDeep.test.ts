import { describe, it, expect } from 'vitest';
import {
  computeMetroAverages,
  computeChangeMetrics,
  computeQuickWinMetrics,
  parseTrendSeries,
} from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeMetroAverages — edge cases', () => {
  it('returns zeros when all features have zero population', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 0, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.hr_mtu).toBe(0);
  });

  it('returns zeros for empty features array', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
  });

  it('skips features with null population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 99999 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(1000);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('skips requirePositive metrics with value 0 or negative', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: -5000 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only the 40000 value should contribute
    expect(avg.hr_mtu).toBe(40000);
  });

  it('computes population-weighted average correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 100, hr_mtu: 20000 }),
      makeFeature({ he_vakiy: 900, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // (20000*100 + 40000*900) / (100+900) = 38000
    expect(avg.hr_mtu).toBe(38000);
  });

  it('computes household-weighted metrics (pctOfHh) correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 400, single_person_hh_pct: 50 }),
      makeFeature({ he_vakiy: 1000, te_taly: 600, single_person_hh_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // (0.50 * 400 + 0.30 * 600) / (400 + 600) = 380/1000 = 38%
    expect(avg.single_person_hh_pct).toBe(38);
  });

  it('computes pctOfPop metrics correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 2000, foreign_language_pct: 10 }),
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // (0.10 * 2000 + 0.20 * 3000) / (2000 + 3000) = 800/5000 = 16%
    expect(avg.foreign_language_pct).toBe(16);
  });

  it('computes unemployment_rate from raw counts, not averaging percentages', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 50 }),
      makeFeature({ he_vakiy: 4000, pt_tyott: 400 }),
    ];
    const avg = computeMetroAverages(features);
    // 450 unemployed / 5000 total population = 9%
    expect(avg.unemployment_rate).toBe(9);
  });

  it('computes higher_education_rate from ko_yl_kork + ko_al_kork / ko_ika18y', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 50, ko_ika18y: 500 }),
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 200, ko_al_kork: 100, ko_ika18y: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // (300 + 150) / 1000 = 45%
    expect(avg.higher_education_rate).toBe(45);
  });

  it('computes population_density from total pop / total area', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km²
      makeFeature({ he_vakiy: 5000, pinta_ala: 4_000_000 }), // 4 km²
    ];
    const avg = computeMetroAverages(features);
    // 10000 / (5_000_000 / 1_000_000) = 2000
    expect(avg.population_density).toBe(2000);
  });

  it('handles single feature correctly', () => {
    const features = [
      makeFeature({
        he_vakiy: 5000,
        hr_mtu: 35000,
        pt_tyott: 250,
        ko_yl_kork: 1000,
        ko_al_kork: 500,
        ko_ika18y: 3000,
        te_omis_as: 1500,
        te_taly: 2500,
        te_vuok_as: 800,
      }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(35000);
    expect(avg.unemployment_rate).toBe(5); // 250/5000 = 5%
    expect(avg.ownership_rate).toBe(60); // 1500/2500 = 60%
    expect(avg.rental_rate).toBe(32); // 800/2500 = 32%
  });
});

describe('computeChangeMetrics — edge cases', () => {
  it('handles negative historical values', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2020, -100], [2021, -50]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    // (-50 - (-100)) / |-100| * 100 = 50%
    expect(features[0].properties!.income_change_pct).toBe(50);
  });

  it('returns null when first value is 0 (division by zero)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2020, 0], [2021, 100]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('computes correct change for decreasing values', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2020, 200], [2021, 150]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    // (150 - 200) / |200| * 100 = -25%
    expect(features[0].properties!.income_change_pct).toBe(-25);
  });

  it('handles multi-year series (uses first and last only)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2018, 100], [2019, 500], [2020, 200]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    // (200 - 100) / |100| * 100 = 100%
    expect(features[0].properties!.income_change_pct).toBe(100);
  });
});

describe('parseTrendSeries — edge cases', () => {
  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for single data point', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100]]))).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseTrendSeries('{not valid}')).toBeNull();
  });

  it('returns null for array with wrong inner structure', () => {
    expect(parseTrendSeries(JSON.stringify([['a', 'b'], ['c', 'd']]))).toBeNull();
  });

  it('returns null for array with wrong tuple length', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100, 200], [2021, 200, 300]]))).toBeNull();
  });

  it('parses valid trend data', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, 100], [2021, 200]]));
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('handles negative values in series', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, -10], [2021, -5]]));
    expect(result).toEqual([[2020, -10], [2021, -5]]);
  });

  it('returns null for undefined', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });
});

describe('computeQuickWinMetrics — edge cases', () => {
  it('handles features with all null Paavo fields', () => {
    const features = [
      makeFeature({
        he_vakiy: null,
        he_18_19: null,
        he_20_24: null,
        he_25_29: null,
        he_naiset: null,
        he_miehet: null,
        te_eil_np: null,
        te_taly: null,
        te_laps: null,
        tp_tyopy: null,
        tp_jk_info: null,
        tp_qr_terv: null,
        pt_tyoll: null,
        pt_vakiy: null,
        he_65_69: null,
        he_70_74: null,
        he_75_79: null,
        he_80_84: null,
        he_85_: null,
        tp_jalo_bf: null,
        tp_o_julk: null,
        tp_palv_gu: null,
        ra_raky: null,
        ra_asunn: null,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties!;
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.gender_ratio).toBeUndefined();
    expect(p.employment_rate).toBeUndefined();
    expect(p.elderly_ratio_pct).toBeUndefined();
  });

  it('does not divide by zero when population is 0', () => {
    const features = [
      makeFeature({
        he_vakiy: 0,
        he_18_19: 10,
        he_20_24: 10,
        he_25_29: 10,
      }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not divide by zero when miehet is 0', () => {
    const features = [
      makeFeature({
        he_vakiy: 100,
        he_naiset: 100,
        he_miehet: 0,
      }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.gender_ratio).toBeUndefined();
  });

  it('correctly rounds youth_ratio_pct to 1 decimal', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_18_19: 33,
        he_20_24: 33,
        he_25_29: 34,
      }),
    ];
    computeQuickWinMetrics(features);
    // (33+33+34)/1000 * 100 = 10.0
    expect(features[0].properties!.youth_ratio_pct).toBe(10);
  });

  it('correctly computes avg_household_size', () => {
    const features = [
      makeFeature({
        he_vakiy: 3000,
        te_taly: 1200,
      }),
    ];
    computeQuickWinMetrics(features);
    // 3000/1200 = 2.5
    expect(features[0].properties!.avg_household_size).toBe(2.5);
  });

  it('correctly computes new_construction_pct', () => {
    const features = [
      makeFeature({
        ra_raky: 10,
        ra_asunn: 500,
      }),
    ];
    computeQuickWinMetrics(features);
    // 10/500 * 100 = 2.0%
    expect(features[0].properties!.new_construction_pct).toBe(2);
  });
});
