import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';

let parseTrendSeries: typeof import('../utils/metrics').parseTrendSeries;
let computeQuickWinMetrics: typeof import('../utils/metrics').computeQuickWinMetrics;
let computeChangeMetrics: typeof import('../utils/metrics').computeChangeMetrics;
let computeMetroAverages: typeof import('../utils/metrics').computeMetroAverages;

function makeFeature(props: Partial<NeighborhoodProperties> = {}): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki',
      he_vakiy: 1000, ...props,
    } as NeighborhoodProperties,
  };
}

describe('parseTrendSeries', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metrics');
    parseTrendSeries = mod.parseTrendSeries;
    computeQuickWinMetrics = mod.computeQuickWinMetrics;
    computeChangeMetrics = mod.computeChangeMetrics;
    computeMetroAverages = mod.computeMetroAverages;
  });

  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2020,100],[2021,200]]');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('returns null for null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('{not json}')).toBeNull();
  });

  it('returns null for array with fewer than 2 elements', () => {
    expect(parseTrendSeries('[[2020,100]]')).toBeNull();
  });

  it('returns null for array with non-numeric elements', () => {
    expect(parseTrendSeries('[["2020","100"],[2021,200]]')).toBeNull();
  });

  it('returns null for array with NaN values', () => {
    expect(parseTrendSeries('[[2020,NaN],[2021,200]]')).toBeNull();
  });

  it('returns null for array with Infinity', () => {
    // JSON.parse doesn't support Infinity, so it's just invalid JSON
    expect(parseTrendSeries('[[2020,Infinity],[2021,200]]')).toBeNull();
  });

  it('returns null for array with wrong inner length', () => {
    expect(parseTrendSeries('[[2020,100,5],[2021,200]]')).toBeNull();
  });

  it('caches results by string identity', () => {
    const json = '[[2020,100],[2021,200]]';
    const r1 = parseTrendSeries(json);
    const r2 = parseTrendSeries(json);
    expect(r1).toBe(r2); // same reference
  });

  it('caches null results too', () => {
    const invalid = '{bad}';
    const r1 = parseTrendSeries(invalid);
    const r2 = parseTrendSeries(invalid);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });
});

describe('computeChangeMetrics', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metrics');
    computeChangeMetrics = mod.computeChangeMetrics;
  });

  it('computes percentage change from first to last data point', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 25000], [2019, 26000], [2020, 27500]]),
      population_history: JSON.stringify([[2018, 1000], [2020, 1100]]),
      unemployment_history: JSON.stringify([[2018, 10], [2020, 8]]),
    })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(10, 1); // (27500-25000)/25000 * 100
    expect(p.population_change_pct).toBeCloseTo(10, 1);
    expect(p.unemployment_change_pct).toBeCloseTo(-20, 1); // (8-10)/10 * 100
  });

  it('returns null when series has fewer than 2 points', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2020, 25000]]),
      population_history: null,
      unemployment_history: '',
    })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 0], [2020, 25000]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative first values correctly', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, -100], [2020, -50]]),
      population_history: null,
      unemployment_history: null,
    })];
    computeChangeMetrics(features);
    // (-50 - (-100)) / |-100| * 100 = 50%
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeCloseTo(50, 1);
  });
});

describe('computeQuickWinMetrics', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metrics');
    computeQuickWinMetrics = mod.computeQuickWinMetrics;
  });

  it('computes youth_ratio_pct from age brackets', () => {
    const features = [makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 150 })];
    computeQuickWinMetrics(features);
    // (50+100+150)/1000 * 100 = 30.0
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeCloseTo(30.0, 1);
  });

  it('computes gender_ratio as women/men', () => {
    const features = [makeFeature({ he_naiset: 600, he_miehet: 400 })];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeCloseTo(1.50, 2);
  });

  it('does not compute gender_ratio when men = 0', () => {
    const features = [makeFeature({ he_naiset: 600, he_miehet: 0 })];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('computes employment_rate correctly', () => {
    const features = [makeFeature({ pt_tyoll: 500, pt_vakiy: 800 })];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBeCloseTo(62.5, 1);
  });

  it('computes elderly_ratio_pct from all 65+ age brackets', () => {
    const features = [makeFeature({ he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10 })];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).elderly_ratio_pct).toBeCloseTo(15.0, 1);
  });

  it('skips metrics when population is 0', () => {
    const features = [makeFeature({ he_vakiy: 0, he_18_19: 0, he_20_24: 0, he_25_29: 0, he_naiset: 0, he_miehet: 0 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.avg_household_size).toBeUndefined();
  });

  it('computes avg_household_size', () => {
    const features = [makeFeature({ he_vakiy: 2000, te_taly: 800 })];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBeCloseTo(2.50, 2);
  });
});

describe('computeMetroAverages', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metrics');
    computeMetroAverages = mod.computeMetroAverages;
  });

  it('computes population-weighted averages', () => {
    const features = [
      makeFeature({ he_vakiy: 2000, hr_mtu: 40000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 25000 }),
    ];
    const avg = computeMetroAverages(features);
    // (40000*2000 + 25000*1000) / 3000 = 35000
    expect(avg.hr_mtu).toBe(35000);
    expect(avg.he_vakiy).toBe(3000);
  });

  it('skips features with null or zero population', () => {
    const features = [
      makeFeature({ he_vakiy: null }),
      makeFeature({ pno: '00200', he_vakiy: 0 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('excludes hr_mtu <= 0 due to requirePositive', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: -5000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('computes unemployment_rate as ratio of total counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 800 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 600 }),
    ];
    const avg = computeMetroAverages(features);
    // total unemployed: 150, total active pop: 1400
    expect(avg.unemployment_rate).toBeCloseTo((150 / 1400) * 100, 1);
  });

  it('handles pctOfPop metrics by converting to counts and back', () => {
    const features = [
      makeFeature({ he_vakiy: 2000, foreign_language_pct: 20 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, foreign_language_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    // counts: 400 + 100 = 500, total pop: 3000
    // pct: 500/3000 * 100 = 16.7
    expect(avg.foreign_language_pct).toBeCloseTo(16.7, 1);
  });

  it('handles pctOfHh metrics by converting to counts and back', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 60 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 40 }),
    ];
    const avg = computeMetroAverages(features);
    // counts: 300 + 200 = 500, total hh: 1000
    // pct: 500/1000 * 100 = 50.0
    expect(avg.single_person_hh_pct).toBeCloseTo(50.0, 1);
  });

  it('computes employment_rate as special ratio (not data-driven)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyoll: 600, pt_vakiy: 800 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, pt_tyoll: 400, pt_vakiy: 700 }),
    ];
    const avg = computeMetroAverages(features);
    // total employed: 1000, total active pop: 1500
    expect(avg.employment_rate).toBeCloseTo((1000 / 1500) * 100, 1);
  });

  it('uses total pop as fallback when pt_vakiy is null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: null, pt_tyoll: 500, pt_tyott: 100 }),
    ];
    const avg = computeMetroAverages(features);
    // pt_vakiy is null, so totalActPop falls back to he_vakiy (1000)
    expect(avg.unemployment_rate).toBeCloseTo(10, 1);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [makeFeature({ he_vakiy: 1000, hr_mtu: null })];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('population_density uses total area in km²', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, pinta_ala: 2_000_000 }), // 2 km²
      makeFeature({ pno: '00200', he_vakiy: 3000, pinta_ala: 1_000_000 }), // 1 km²
    ];
    const avg = computeMetroAverages(features);
    // 8000 / 3 km² ≈ 2667
    expect(avg.population_density).toBe(Math.round(8000 / 3));
  });
});
