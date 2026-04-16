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

describe('parseTrendSeries — edge cases', () => {
  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for single data point (needs >= 2)', () => {
    expect(parseTrendSeries('[[2020, 100]]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('returns null for array of wrong shape', () => {
    expect(parseTrendSeries('[[1, 2, 3]]')).toBeNull();
  });

  it('returns null for array with string values', () => {
    expect(parseTrendSeries('[["2020", 100], ["2021", 200]]')).toBeNull();
  });

  it('parses valid 2-point series', () => {
    const result = parseTrendSeries('[[2020, 100], [2021, 200]]');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('parses 5-point series', () => {
    const json = '[[2018,10],[2019,20],[2020,30],[2021,40],[2022,50]]';
    const result = parseTrendSeries(json);
    expect(result).toHaveLength(5);
    expect(result![0]).toEqual([2018, 10]);
    expect(result![4]).toEqual([2022, 50]);
  });

  it('returns null for nested arrays', () => {
    expect(parseTrendSeries('[[[2020], 100]]')).toBeNull();
  });

  it('handles already-parsed value passed as raw', () => {
    // The function checks typeof raw === 'string' and parses, otherwise uses directly
    const arr = [[2020, 100], [2021, 200]];
    const result = parseTrendSeries(arr as unknown as string);
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });
});

describe('computeQuickWinMetrics — denominator edge cases', () => {
  it('skips youth_ratio when population is 0', () => {
    const features = [
      makeFeature({ he_vakiy: 0, he_18_19: 10, he_20_24: 20, he_25_29: 30 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('skips gender_ratio when miehet is 0', () => {
    const features = [
      makeFeature({ he_naiset: 50, he_miehet: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.gender_ratio).toBeUndefined();
  });

  it('skips single_parent_hh_pct when te_taly is 0', () => {
    const features = [
      makeFeature({ te_eil_np: 5, te_taly: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.single_parent_hh_pct).toBeUndefined();
  });

  it('skips tech_sector_pct when tp_tyopy is 0', () => {
    const features = [
      makeFeature({ tp_j_info: 10, tp_tyopy: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.tech_sector_pct).toBeUndefined();
  });

  it('skips employment_rate when pt_vakiy is 0', () => {
    const features = [
      makeFeature({ pt_tyoll: 100, pt_vakiy: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.employment_rate).toBeUndefined();
  });

  it('computes all metrics correctly with valid data', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_18_19: 50, he_20_24: 100, he_25_29: 80,
        he_naiset: 520, he_miehet: 480,
        te_eil_np: 30, te_taly: 400, te_laps: 120,
        tp_j_info: 20, tp_tyopy: 200, tp_q_terv: 30,
        pt_tyoll: 600, pt_vakiy: 800,
        he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
        tp_jalo_bf: 40, tp_o_julk: 25, tp_palv_gu: 60,
        ra_raky: 5, ra_asunn: 500,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties!;

    // youth_ratio: (50+100+80)/1000 * 100 = 23.0
    expect(p.youth_ratio_pct).toBe(23);
    // gender_ratio: 520/480 ≈ 1.08
    expect(p.gender_ratio).toBe(1.08);
    // single_parent: 30/400 * 100 = 7.5
    expect(p.single_parent_hh_pct).toBe(7.5);
    // families_with_children: 120/400 * 100 = 30.0
    expect(p.families_with_children_pct).toBe(30);
    // tech_sector: 20/200 * 100 = 10.0
    expect(p.tech_sector_pct).toBe(10);
    // healthcare: 30/200 * 100 = 15.0
    expect(p.healthcare_workers_pct).toBe(15);
    // employment_rate: 600/800 * 100 = 75.0
    expect(p.employment_rate).toBe(75);
    // elderly: (50+40+30+20+10)/1000 * 100 = 15.0
    expect(p.elderly_ratio_pct).toBe(15);
    // avg_household_size: 1000/400 = 2.5
    expect(p.avg_household_size).toBe(2.5);
    // manufacturing: 40/200 * 100 = 20.0
    expect(p.manufacturing_jobs_pct).toBe(20);
    // public_sector: 25/200 * 100 = 12.5
    expect(p.public_sector_jobs_pct).toBe(12.5);
    // service_sector: 60/200 * 100 = 30.0
    expect(p.service_sector_jobs_pct).toBe(30);
    // new_construction: 5/500 * 100 = 1.0
    expect(p.new_construction_pct).toBe(1);
  });

  it('skips elderly_ratio when any age group is null', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_65_69: 50, he_70_74: null, he_75_79: 30, he_80_84: 20, he_85_: 10,
      }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.elderly_ratio_pct).toBeUndefined();
  });

  it('skips avg_household_size when population is null', () => {
    const features = [
      makeFeature({ he_vakiy: null, te_taly: 400 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.avg_household_size).toBeUndefined();
  });
});

describe('computeChangeMetrics — edge cases', () => {
  it('computes positive change correctly', () => {
    const features = [
      makeFeature({
        income_history: '[[2018, 30000], [2022, 36000]]',
        population_history: '[[2018, 1000], [2022, 1200]]',
        unemployment_history: '[[2018, 10], [2022, 8]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties!;
    // income: (36000-30000)/30000 * 100 = 20%
    expect(p.income_change_pct).toBe(20);
    // population: (1200-1000)/1000 * 100 = 20%
    expect(p.population_change_pct).toBe(20);
    // unemployment: (8-10)/10 * 100 = -20%
    expect(p.unemployment_change_pct).toBe(-20);
  });

  it('returns null when first value is 0 (division by zero)', () => {
    const features = [
      makeFeature({
        income_history: '[[2018, 0], [2022, 5000]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('returns null when history has only one data point', () => {
    const features = [
      makeFeature({
        income_history: '[[2018, 30000]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('returns null for null history', () => {
    const features = [
      makeFeature({
        income_history: null,
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
    expect(features[0].properties!.population_change_pct).toBeNull();
    expect(features[0].properties!.unemployment_change_pct).toBeNull();
  });

  it('handles negative first value correctly', () => {
    const features = [
      makeFeature({
        income_history: '[[2018, -100], [2022, -50]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    // (-50 - (-100)) / |-100| * 100 = 50/100 * 100 = 50%
    expect(features[0].properties!.income_change_pct).toBe(50);
  });
});

describe('computeMetroAverages — untested branches', () => {
  it('falls back to he_vakiy when pt_vakiy is null for unemployment rate', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: null }),
      makeFeature({ he_vakiy: 2000, pt_tyott: 200, pt_vakiy: null }),
    ];
    const avg = computeMetroAverages(features);
    // totalActPop = 1000+2000 = 3000 (fallback from he_vakiy)
    // (100+200)/3000 * 100 = 10.0%
    expect(avg.unemployment_rate).toBe(10);
  });

  it('computes student share from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_opisk: 100, pt_vakiy: 800 }),
      makeFeature({ he_vakiy: 1000, pt_opisk: 200, pt_vakiy: 900 }),
    ];
    const avg = computeMetroAverages(features);
    // (100+200)/(800+900) * 100 = 300/1700 * 100 ≈ 17.6
    expect(avg.student_share).toBeCloseTo(17.6, 1);
  });

  it('computes pensioner_share from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_elakel: 200 }),
      makeFeature({ he_vakiy: 1000, pt_elakel: 300 }),
    ];
    const avg = computeMetroAverages(features);
    // (200+300)/2000 * 100 = 25%
    expect(avg.pensioner_share).toBe(25);
  });

  it('computes detached_house_share from dwelling counts', () => {
    const features = [
      makeFeature({ he_vakiy: 500, ra_pt_as: 100, ra_asunn: 500 }),
      makeFeature({ he_vakiy: 500, ra_pt_as: 50, ra_asunn: 250 }),
    ];
    const avg = computeMetroAverages(features);
    // (100+50)/(500+250) * 100 = 150/750 * 100 = 20.0%
    expect(avg.detached_house_share).toBe(20);
  });

  it('skips income with value 0 (requirePositive)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only second feature contributes: 40000
    expect(avg.hr_mtu).toBe(40000);
  });

  it('handles household-weighted metrics (single_person_hh_pct)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 40 }),
      makeFeature({ he_vakiy: 1000, te_taly: 300, single_person_hh_pct: 60 }),
    ];
    const avg = computeMetroAverages(features);
    // pctOfHh: totals = (40/100)*500 + (60/100)*300 = 200 + 180 = 380
    // weights = 500 + 300 = 800
    // result = (380/800)*100 = 47.5
    expect(avg.single_person_hh_pct).toBe(47.5);
  });

  it('returns 0 for metric when all features have null values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: null }),
      makeFeature({ he_vakiy: 1000, hr_mtu: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('computes employment_rate from raw counts (pt_tyoll / pt_vakiy)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: 800, pt_tyoll: 560 }),
      makeFeature({ he_vakiy: 3000, pt_vakiy: 2400, pt_tyoll: 1920 }),
    ];
    const avg = computeMetroAverages(features);
    // totalEmployed = 560 + 1920 = 2480
    // totalActPop = 800 + 2400 = 3200
    // result = (2480/3200)*100 = 77.5
    expect(avg.employment_rate).toBe(77.5);
  });
});
