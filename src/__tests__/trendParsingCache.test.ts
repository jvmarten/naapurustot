import { describe, it, expect } from 'vitest';
import { parseTrendSeries, computeChangeMetrics, computeQuickWinMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('parseTrendSeries — validation and caching', () => {
  it('returns same reference for identical string input (caching)', () => {
    const json = JSON.stringify([[2020, 100], [2021, 200]]);
    const result1 = parseTrendSeries(json);
    const result2 = parseTrendSeries(json);
    expect(result1).toBe(result2);
  });

  it('caches null results for invalid input', () => {
    const result1 = parseTrendSeries('not-json');
    const result2 = parseTrendSeries('not-json');
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });

  it('rejects single-point series', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100]]))).toBeNull();
  });

  it('rejects series with non-finite values', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, Infinity], [2021, 200]]))).toBeNull();
    expect(parseTrendSeries(JSON.stringify([[NaN, 100], [2021, 200]]))).toBeNull();
  });

  it('rejects series with wrong tuple length', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100, 'extra'], [2021, 200]]))).toBeNull();
    expect(parseTrendSeries(JSON.stringify([[2020], [2021, 200]]))).toBeNull();
  });

  it('rejects non-array input', () => {
    expect(parseTrendSeries(JSON.stringify({ year: 2020, value: 100 }))).toBeNull();
    expect(parseTrendSeries(JSON.stringify('just a string'))).toBeNull();
  });

  it('returns null for null, undefined, and empty string', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
    expect(parseTrendSeries('')).toBeNull();
  });

  it('accepts valid 2+ point series', () => {
    const result = parseTrendSeries(JSON.stringify([[2018, 100], [2019, 110], [2020, 120]]));
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0]).toEqual([2018, 100]);
  });
});

describe('computeChangeMetrics — percentage change', () => {
  it('computes positive change from trend data', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 30000], [2020, 33000]]),
      population_history: JSON.stringify([[2018, 1000], [2020, 1100]]),
      unemployment_history: JSON.stringify([[2018, 10], [2020, 8]]),
    })];

    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.income_change_pct).toBeCloseTo(10, 1);
    expect(p.population_change_pct).toBeCloseTo(10, 1);
    expect(p.unemployment_change_pct).toBeCloseTo(-20, 1);
  });

  it('returns null when first value is 0 (division by zero)', () => {
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, 0], [2020, 33000]]),
    })];

    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('returns null when history is missing or single-point', () => {
    const features = [makeFeature({
      income_history: null,
      population_history: JSON.stringify([[2020, 1000]]),
    })];

    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
  });

  it('computes negative change correctly', () => {
    const features = [makeFeature({
      population_history: JSON.stringify([[2018, 1000], [2020, 800]]),
    })];

    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).population_change_pct).toBeCloseTo(-20, 1);
  });

  it('handles negative initial value with absolute denominator', () => {
    // Not typical for real data, but tests the Math.abs(first) in denominator
    const features = [makeFeature({
      income_history: JSON.stringify([[2018, -100], [2020, -50]]),
    })];

    computeChangeMetrics(features);
    // Change: (-50 - (-100)) / abs(-100) * 100 = 50/100 * 100 = 50%
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeCloseTo(50, 1);
  });
});

describe('computeQuickWinMetrics — derived field computation', () => {
  it('computes youth_ratio_pct correctly', () => {
    const features = [makeFeature({
      he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 80,
    })];

    computeQuickWinMetrics(features);
    // (50+100+80)/1000 * 100 = 23.0%
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBe(23.0);
  });

  it('computes gender_ratio correctly', () => {
    const features = [makeFeature({
      he_vakiy: 1000, he_naiset: 520, he_miehet: 480,
    })];

    computeQuickWinMetrics(features);
    // 520/480 = 1.0833... → rounded to 1.08
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeCloseTo(1.08, 2);
  });

  it('computes employment_rate from pt_tyoll / pt_vakiy', () => {
    const features = [makeFeature({
      pt_tyoll: 700, pt_vakiy: 1000,
    })];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBe(70);
  });

  it('computes elderly_ratio_pct from 65+ age groups', () => {
    const features = [makeFeature({
      he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
    })];

    computeQuickWinMetrics(features);
    // (50+40+30+20+10)/1000 * 100 = 15.0%
    expect((features[0].properties as NeighborhoodProperties).elderly_ratio_pct).toBe(15.0);
  });

  it('computes avg_household_size from pop / households', () => {
    const features = [makeFeature({
      he_vakiy: 2500, te_taly: 1000,
    })];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBe(2.5);
  });

  it('skips metrics when denominator is zero or null', () => {
    const features = [makeFeature({
      he_vakiy: 0, he_18_19: 50, he_20_24: 100, he_25_29: 80,
      he_naiset: 520, he_miehet: 0,
      tp_tyopy: 0, tp_j_info: 10,
    })];

    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.gender_ratio).toBeUndefined();
    expect(p.tech_sector_pct).toBeUndefined();
  });

  it('computes new_construction_pct from ra_raky / ra_asunn', () => {
    const features = [makeFeature({
      ra_raky: 50, ra_asunn: 500,
    })];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).new_construction_pct).toBe(10);
  });
});
