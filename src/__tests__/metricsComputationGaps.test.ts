import { describe, it, expect } from 'vitest';
import {
  parseTrendSeries,
  computeQuickWinMetrics,
  computeChangeMetrics,
  computeMetroAverages,
} from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

// ─── parseTrendSeries ───

describe('parseTrendSeries', () => {
  it('parses valid JSON trend series', () => {
    const result = parseTrendSeries('[[2020,100],[2021,110]]');
    expect(result).toEqual([[2020, 100], [2021, 110]]);
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

  it('returns null for array with fewer than 2 points', () => {
    expect(parseTrendSeries('[[2020,100]]')).toBeNull();
  });

  it('returns null for malformed data points', () => {
    expect(parseTrendSeries('[[2020,"abc"],[2021,110]]')).toBeNull();
  });

  it('returns null for data points with wrong length', () => {
    expect(parseTrendSeries('[[2020,100,999],[2021,110]]')).toBeNull();
  });

  it('returns null for NaN values', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, NaN], [2021, 110]]))).toBeNull();
  });

  it('returns null for Infinity values', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, Infinity], [2021, 110]]))).toBeNull();
  });

  it('handles negative values correctly', () => {
    const result = parseTrendSeries('[[2020,-5],[2021,-3]]');
    expect(result).toEqual([[2020, -5], [2021, -3]]);
  });

  it('handles decimal values', () => {
    const result = parseTrendSeries('[[2020,10.5],[2021,11.3]]');
    expect(result).toEqual([[2020, 10.5], [2021, 11.3]]);
  });
});

// ─── computeChangeMetrics ───

describe('computeChangeMetrics', () => {
  it('computes percentage change from income history', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 20000], [2020, 24000]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    // (24000 - 20000) / 20000 * 100 = 20%
    expect(features[0].properties!.income_change_pct).toBe(20);
  });

  it('computes negative change correctly', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 30000], [2020, 24000]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    // (24000 - 30000) / 30000 * 100 = -20%
    expect(features[0].properties!.income_change_pct).toBe(-20);
  });

  it('computes population change', () => {
    const features = [makeFeature({
      income_history: null,
      population_history: JSON.stringify([[2018, 1000], [2020, 1100]]),
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    expect(features[0].properties!.population_change_pct).toBe(10);
  });

  it('computes unemployment change', () => {
    const features = [makeFeature({
      income_history: null,
      population_history: null,
      unemployment_history: JSON.stringify([[2018, 10], [2020, 8]]),
    })];
    computeChangeMetrics(features);
    expect(features[0].properties!.unemployment_change_pct).toBe(-20);
  });

  it('sets null when history is missing', () => {
    const features = [makeFeature({
      income_history: null,
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
    expect(features[0].properties!.population_change_pct).toBeNull();
    expect(features[0].properties!.unemployment_change_pct).toBeNull();
  });

  it('sets null when first value is zero (division by zero)', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 0], [2020, 24000]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('sets null when series has only one data point', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2020, 24000]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });
});

// ─── computeQuickWinMetrics ───

describe('computeQuickWinMetrics', () => {
  it('computes youth_ratio_pct correctly', () => {
    const features = [makeFeature({
      he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 150,
    })];
    computeQuickWinMetrics(features);
    // (50+100+150)/1000 * 100 = 30.0%
    expect(features[0].properties!.youth_ratio_pct).toBe(30);
  });

  it('computes gender_ratio correctly', () => {
    const features = [makeFeature({
      he_naiset: 520, he_miehet: 480,
    })];
    computeQuickWinMetrics(features);
    // 520/480 = 1.08
    expect(features[0].properties!.gender_ratio).toBe(1.08);
  });

  it('computes single_parent_hh_pct correctly', () => {
    const features = [makeFeature({
      te_eil_np: 30, te_taly: 200,
    })];
    computeQuickWinMetrics(features);
    // 30/200 * 100 = 15.0%
    expect(features[0].properties!.single_parent_hh_pct).toBe(15);
  });

  it('computes families_with_children_pct correctly', () => {
    const features = [makeFeature({
      te_laps: 80, te_taly: 400,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.families_with_children_pct).toBe(20);
  });

  it('computes tech_sector_pct correctly', () => {
    const features = [makeFeature({
      tp_j_info: 25, tp_tyopy: 500,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.tech_sector_pct).toBe(5);
  });

  it('computes healthcare_workers_pct correctly', () => {
    const features = [makeFeature({
      tp_q_terv: 75, tp_tyopy: 500,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.healthcare_workers_pct).toBe(15);
  });

  it('computes employment_rate correctly', () => {
    const features = [makeFeature({
      pt_tyoll: 400, pt_vakiy: 800,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.employment_rate).toBe(50);
  });

  it('computes elderly_ratio_pct correctly', () => {
    const features = [makeFeature({
      he_vakiy: 1000, he_65_69: 40, he_70_74: 30,
      he_75_79: 20, he_80_84: 15, he_85_: 10,
    })];
    computeQuickWinMetrics(features);
    // (40+30+20+15+10)/1000 * 100 = 11.5%
    expect(features[0].properties!.elderly_ratio_pct).toBe(11.5);
  });

  it('computes avg_household_size correctly', () => {
    const features = [makeFeature({
      he_vakiy: 2400, te_taly: 1000,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.avg_household_size).toBe(2.4);
  });

  it('computes manufacturing_jobs_pct correctly', () => {
    const features = [makeFeature({
      tp_jalo_bf: 100, tp_tyopy: 1000,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.manufacturing_jobs_pct).toBe(10);
  });

  it('computes public_sector_jobs_pct correctly', () => {
    const features = [makeFeature({
      tp_o_julk: 50, tp_tyopy: 500,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.public_sector_jobs_pct).toBe(10);
  });

  it('computes service_sector_jobs_pct correctly', () => {
    const features = [makeFeature({
      tp_palv_gu: 200, tp_tyopy: 1000,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.service_sector_jobs_pct).toBe(20);
  });

  it('computes new_construction_pct correctly', () => {
    const features = [makeFeature({
      ra_raky: 10, ra_asunn: 500,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.new_construction_pct).toBe(2);
  });

  it('skips youth_ratio when population is null', () => {
    const features = [makeFeature({
      he_vakiy: null, he_18_19: 50, he_20_24: 100, he_25_29: 150,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('skips youth_ratio when population is 0', () => {
    const features = [makeFeature({
      he_vakiy: 0, he_18_19: 50, he_20_24: 100, he_25_29: 150,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('skips gender_ratio when men is 0', () => {
    const features = [makeFeature({
      he_naiset: 520, he_miehet: 0,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.gender_ratio).toBeUndefined();
  });

  it('skips metrics when denominator fields are null', () => {
    const features = [makeFeature({
      te_eil_np: 30, te_taly: null,
    })];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.single_parent_hh_pct).toBeUndefined();
  });

  it('handles all metrics for a complete feature', () => {
    const features = [makeFeature({
      he_vakiy: 5000, he_18_19: 100, he_20_24: 200, he_25_29: 300,
      he_naiset: 2600, he_miehet: 2400,
      te_eil_np: 50, te_taly: 2000, te_laps: 600,
      tp_j_info: 100, tp_q_terv: 200, tp_tyopy: 2000,
      tp_jalo_bf: 300, tp_o_julk: 150, tp_palv_gu: 500,
      pt_tyoll: 3000, pt_vakiy: 4000,
      he_65_69: 200, he_70_74: 150, he_75_79: 100, he_80_84: 50, he_85_: 30,
      ra_raky: 20, ra_asunn: 1500,
    })];
    computeQuickWinMetrics(features);

    const p = features[0].properties!;
    expect(p.youth_ratio_pct).toBeDefined();
    expect(p.gender_ratio).toBeDefined();
    expect(p.single_parent_hh_pct).toBeDefined();
    expect(p.families_with_children_pct).toBeDefined();
    expect(p.tech_sector_pct).toBeDefined();
    expect(p.healthcare_workers_pct).toBeDefined();
    expect(p.employment_rate).toBeDefined();
    expect(p.elderly_ratio_pct).toBeDefined();
    expect(p.avg_household_size).toBeDefined();
    expect(p.manufacturing_jobs_pct).toBeDefined();
    expect(p.public_sector_jobs_pct).toBeDefined();
    expect(p.service_sector_jobs_pct).toBeDefined();
    expect(p.new_construction_pct).toBeDefined();
  });
});

// ─── computeMetroAverages additional tests ───

describe('computeMetroAverages edge cases', () => {
  it('returns zero for all metrics when no valid features', () => {
    const features = [
      makeFeature({ he_vakiy: 0 }),
      makeFeature({ he_vakiy: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
  });

  it('computes student_share correctly', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000, pt_opisk: 100, pt_vakiy: 800,
        ko_yl_kork: 0, ko_al_kork: 0, ko_ika18y: 0,
        te_omis_as: 0, te_taly: 0, te_vuok_as: 0,
        he_0_2: 0, he_3_6: 0, pinta_ala: 1000000,
        ra_pt_as: 0, ra_asunn: 0, pt_elakel: 0, pt_tyott: 0,
      }),
      makeFeature({
        he_vakiy: 1000, pt_opisk: 200, pt_vakiy: 800,
        ko_yl_kork: 0, ko_al_kork: 0, ko_ika18y: 0,
        te_omis_as: 0, te_taly: 0, te_vuok_as: 0,
        he_0_2: 0, he_3_6: 0, pinta_ala: 1000000,
        ra_pt_as: 0, ra_asunn: 0, pt_elakel: 0, pt_tyott: 0,
      }),
    ];
    const avg = computeMetroAverages(features);
    // Total students: 300, total active pop: 1600
    // student_share = 300/1600 * 100 = 18.75 → rounded to 18.8
    expect(avg.student_share).toBeCloseTo(18.8, 1);
  });

  it('computes pensioner_share correctly', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000, pt_elakel: 200,
        pt_tyott: 0, ko_yl_kork: 0, ko_al_kork: 0, ko_ika18y: 0,
        te_omis_as: 0, te_taly: 0, te_vuok_as: 0,
        pt_opisk: 0, pt_vakiy: 0,
        he_0_2: 0, he_3_6: 0, pinta_ala: 1000000,
        ra_pt_as: 0, ra_asunn: 0,
      }),
    ];
    const avg = computeMetroAverages(features);
    // 200/1000 * 100 = 20.0
    expect(avg.pensioner_share).toBe(20);
  });

  it('population_density uses pinta_ala in m² converted to km²', () => {
    const features = [
      makeFeature({
        he_vakiy: 5000, pinta_ala: 2000000, // 2 km²
        pt_tyott: 0, ko_yl_kork: 0, ko_al_kork: 0, ko_ika18y: 0,
        te_omis_as: 0, te_taly: 0, te_vuok_as: 0,
        pt_opisk: 0, pt_vakiy: 0, pt_elakel: 0,
        he_0_2: 0, he_3_6: 0, ra_pt_as: 0, ra_asunn: 0,
      }),
    ];
    const avg = computeMetroAverages(features);
    // 5000 / (2000000 / 1_000_000) = 5000 / 2 = 2500
    expect(avg.population_density).toBe(2500);
  });

  it('requirePositive excludes zero and negative values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0, property_price_sqm: -5 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000, property_price_sqm: 4000 }),
    ];
    const avg = computeMetroAverages(features);
    // hr_mtu: only 30000 counted (0 excluded by requirePositive)
    expect(avg.hr_mtu).toBe(30000);
    // property_price_sqm: only 4000 counted (-5 excluded)
    expect(avg.property_price_sqm).toBe(4000);
  });
});
