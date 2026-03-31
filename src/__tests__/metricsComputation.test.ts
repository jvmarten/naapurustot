import { describe, it, expect } from 'vitest';
import {
  parseTrendSeries,
  computeQuickWinMetrics,
  computeChangeMetrics,
  computeMetroAverages,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('parseTrendSeries', () => {
  it('parses valid JSON array', () => {
    const result = parseTrendSeries('[[2020,100],[2021,200]]');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('returns null for single data point (needs >= 2)', () => {
    expect(parseTrendSeries('[[2020,100]]')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('{bad json}')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseTrendSeries('{"a":1}')).toBeNull();
  });

  it('rejects entries with non-numeric values', () => {
    expect(parseTrendSeries('[[2020,"abc"],[2021,200]]')).toBeNull();
  });

  it('rejects entries with NaN', () => {
    expect(parseTrendSeries(`[[2020,${NaN}],[2021,200]]`)).toBeNull();
  });

  it('rejects entries with Infinity', () => {
    // JSON doesn't have Infinity, so this would be invalid JSON anyway
    expect(parseTrendSeries('[[2020,Infinity],[2021,200]]')).toBeNull();
  });

  it('rejects entries with wrong tuple length', () => {
    expect(parseTrendSeries('[[2020,100,3],[2021,200,4]]')).toBeNull();
  });

  it('accepts negative values', () => {
    const result = parseTrendSeries('[[2020,-5],[2021,10]]');
    expect(result).toEqual([[2020, -5], [2021, 10]]);
  });
});

describe('computeChangeMetrics', () => {
  it('computes percentage change from first to last data point', () => {
    const features = [
      makeFeature({
        income_history: '[[2018,20000],[2019,22000],[2020,24000]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (24000 - 20000) / |20000| * 100 = 20%
    expect(p.income_change_pct).toBeCloseTo(20, 5);
  });

  it('handles negative starting value', () => {
    const features = [
      makeFeature({
        income_history: '[[2018,-100],[2020,-50]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (-50 - (-100)) / |-100| * 100 = 50%
    expect(p.income_change_pct).toBeCloseTo(50, 5);
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [
      makeFeature({
        income_history: '[[2018,0],[2020,100]]',
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
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
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('computes all three change metrics independently', () => {
    const features = [
      makeFeature({
        income_history: '[[2018,100],[2020,150]]',
        population_history: '[[2018,1000],[2020,900]]',
        unemployment_history: '[[2018,50],[2020,75]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(50, 5);
    expect(p.population_change_pct).toBeCloseTo(-10, 5);
    expect(p.unemployment_change_pct).toBeCloseTo(50, 5);
  });
});

describe('computeQuickWinMetrics', () => {
  it('computes youth ratio correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 50 }),
    ];
    computeQuickWinMetrics(features);
    // (50 + 100 + 50) / 1000 * 100 = 20%
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeCloseTo(20, 1);
  });

  it('skips youth ratio when population is zero', () => {
    const features = [
      makeFeature({ he_vakiy: 0, he_18_19: 50, he_20_24: 100, he_25_29: 50 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('skips youth ratio when any age group is null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: null, he_25_29: 50 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('computes gender ratio correctly', () => {
    const features = [
      makeFeature({ he_naiset: 520, he_miehet: 480 }),
    ];
    computeQuickWinMetrics(features);
    // 520 / 480 = 1.0833... → rounded to 1.08
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeCloseTo(1.08, 2);
  });

  it('skips gender ratio when men count is zero', () => {
    const features = [
      makeFeature({ he_naiset: 500, he_miehet: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('computes employment rate from employed / working-age', () => {
    const features = [
      makeFeature({ pt_tyoll: 600, pt_vakiy: 1000 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBeCloseTo(60, 1);
  });

  it('computes elderly ratio from age groups', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_65_69: 40, he_70_74: 30, he_75_79: 20, he_80_84: 10, he_85_: 5,
      }),
    ];
    computeQuickWinMetrics(features);
    // (40+30+20+10+5) / 1000 * 100 = 10.5%
    expect((features[0].properties as NeighborhoodProperties).elderly_ratio_pct).toBeCloseTo(10.5, 1);
  });

  it('computes avg household size', () => {
    const features = [
      makeFeature({ he_vakiy: 3000, te_taly: 1500 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBeCloseTo(2.0, 2);
  });

  it('computes new construction percentage', () => {
    const features = [
      makeFeature({ ra_raky: 10, ra_asunn: 200 }),
    ];
    computeQuickWinMetrics(features);
    // 10/200 * 100 = 5%
    expect((features[0].properties as NeighborhoodProperties).new_construction_pct).toBeCloseTo(5, 1);
  });

  it('handles multiple features', () => {
    const features = [
      makeFeature({ he_vakiy: 500, he_18_19: 25, he_20_24: 50, he_25_29: 25 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, he_18_19: 10, he_20_24: 20, he_25_29: 10 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeCloseTo(20, 1);
    expect((features[1].properties as NeighborhoodProperties).youth_ratio_pct).toBeCloseTo(4, 1);
  });
});

describe('computeMetroAverages', () => {
  it('computes population-weighted average for income', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // Weighted: (30000*1000 + 40000*3000) / (1000+3000) = 37500
    expect(avg.hr_mtu).toBe(37500);
  });

  it('skips features with null or zero population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 100000 }),
      makeFeature({ pno: '00200', he_vakiy: 0, hr_mtu: 100000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 25000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(25000);
  });

  it('computes ratio-based unemployment rate from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 800 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, pt_tyott: 200, pt_vakiy: 1600 }),
    ];
    const avg = computeMetroAverages(features);
    // total unemployed = 250, total active pop = 2400
    // 250/2400 * 100 = 10.4166...
    expect(avg.unemployment_rate).toBeCloseTo(10.4, 1);
  });

  it('computes ratio-based education rate from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 200, ko_al_kork: 100, ko_ika18y: 800 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 50, ko_ika18y: 800 }),
    ];
    const avg = computeMetroAverages(features);
    // total higher ed = 450, total adult pop = 1600
    // 450/1600 * 100 = 28.125
    expect(avg.higher_education_rate).toBeCloseTo(28.1, 1);
  });

  it('computes ownership rate from household counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_omis_as: 300, te_taly: 500 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_omis_as: 200, te_taly: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // 500/1000 * 100 = 50%
    expect(avg.ownership_rate).toBeCloseTo(50, 1);
  });

  it('computes population density from area', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: 1_000_000 }), // 1 km²
      makeFeature({ pno: '00200', he_vakiy: 3000, pinta_ala: 1_000_000 }), // 1 km²
    ];
    const avg = computeMetroAverages(features);
    // total pop 4000, total area 2km² → 2000/km²
    expect(avg.population_density).toBe(2000);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('handles pctOfPop metrics by accumulating counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 20 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, foreign_language_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    // 20% of 1000 = 200, 10% of 3000 = 300 → 500/4000 * 100 = 12.5%
    expect(avg.foreign_language_pct).toBeCloseTo(12.5, 1);
  });

  it('handles pctOfHh metrics by accumulating household counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 400, single_person_hh_pct: 50 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_taly: 600, single_person_hh_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // 50% of 400 = 200, 30% of 600 = 180 → 380/1000 * 100 = 38%
    expect(avg.single_person_hh_pct).toBeCloseTo(38, 1);
  });

  it('returns total population as he_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 1000 }),
      makeFeature({ pno: '00200', he_vakiy: 2000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(3000);
  });

  it('skips requirePositive metrics with zero or negative values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only the second feature contributes
    expect(avg.hr_mtu).toBe(30000);
  });
});
