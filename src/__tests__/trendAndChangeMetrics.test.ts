/**
 * Trend parsing and change metric computation.
 *
 * Priority 2: Data transformation. Wrong change metrics lead to incorrect
 * "income change", "population change" choropleth layers.
 *
 * Targets untested paths:
 * - parseTrendSeries with malformed JSON
 * - parseTrendSeries with arrays shorter than 2 elements
 * - parseTrendSeries with Infinity/NaN values
 * - parseTrendSeries caching behavior (string identity)
 * - computeChangePct with negative base values
 * - computeChangePct with zero base value (division by zero)
 * - computeChangeMetrics mutating properties in place
 * - roundTo precision edge cases
 */
import { describe, it, expect } from 'vitest';
import {
  parseTrendSeries,
  computeChangeMetrics,
  computeQuickWinMetrics,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: null, he_vakiy: 1000, ...props },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('parseTrendSeries', () => {
  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2020, 100], [2021, 105], [2022, 110]]');
    expect(result).toEqual([[2020, 100], [2021, 105], [2022, 110]]);
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

  it('returns null for arrays with fewer than 2 elements', () => {
    expect(parseTrendSeries('[[2020, 100]]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseTrendSeries('{"year": 2020}')).toBeNull();
  });

  it('returns null for arrays with non-pair elements', () => {
    expect(parseTrendSeries('[[2020, 100, 200], [2021, 105]]')).toBeNull();
  });

  it('returns null for arrays with non-numeric values', () => {
    expect(parseTrendSeries('[[2020, "hundred"], [2021, 105]]')).toBeNull();
  });

  it('returns null for arrays containing Infinity', () => {
    expect(parseTrendSeries(`[[2020, ${Infinity}], [2021, 105]]`)).toBeNull();
  });

  it('returns null for nested arrays', () => {
    expect(parseTrendSeries('[[[2020, 100]], [[2021, 105]]]')).toBeNull();
  });

  it('caches results by string value', () => {
    const json = '[[2020, 1], [2021, 2]]';
    const r1 = parseTrendSeries(json);
    const r2 = parseTrendSeries(json);
    expect(r1).toBe(r2); // same reference
  });

  it('caches null results too', () => {
    const invalid = 'invalid';
    const r1 = parseTrendSeries(invalid);
    const r2 = parseTrendSeries(invalid);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  it('handles large trend series', () => {
    const series = Array.from({ length: 30 }, (_, i) => [1990 + i, 100 + i]);
    const json = JSON.stringify(series);
    const result = parseTrendSeries(json);
    expect(result).toHaveLength(30);
    expect(result![0]).toEqual([1990, 100]);
  });

  it('handles negative values', () => {
    const result = parseTrendSeries('[[2020, -5], [2021, -3]]');
    expect(result).toEqual([[2020, -5], [2021, -3]]);
  });

  it('handles zero values', () => {
    const result = parseTrendSeries('[[2020, 0], [2021, 0]]');
    expect(result).toEqual([[2020, 0], [2021, 0]]);
  });

  it('handles decimal values', () => {
    const result = parseTrendSeries('[[2020, 5.5], [2021, 6.3]]');
    expect(result).toEqual([[2020, 5.5], [2021, 6.3]]);
  });
});

describe('computeChangeMetrics', () => {
  it('computes percentage change from first to last data point', () => {
    const features = [
      makeFeature({
        income_history: '[[2018, 30000], [2020, 33000]]',
        population_history: '[[2018, 1000], [2020, 1100]]',
        unemployment_history: '[[2018, 8.0], [2020, 6.0]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.income_change_pct).toBeCloseTo(10.0, 1);
    expect(p.population_change_pct).toBeCloseTo(10.0, 1);
    expect(p.unemployment_change_pct).toBeCloseTo(-25.0, 1);
  });

  it('returns null when history is null', () => {
    const features = [
      makeFeature({ income_history: null, population_history: null, unemployment_history: null }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null when history has only one data point', () => {
    const features = [makeFeature({ income_history: '[[2020, 30000]]' })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
  });

  it('returns null when base value is zero (avoids division by zero)', () => {
    const features = [makeFeature({ income_history: '[[2018, 0], [2020, 30000]]' })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
  });

  it('handles negative change correctly', () => {
    const features = [makeFeature({ income_history: '[[2018, 40000], [2020, 30000]]' })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(-25.0, 1);
  });

  it('uses first and last points (ignores intermediate)', () => {
    const features = [
      makeFeature({ income_history: '[[2018, 20000], [2019, 50000], [2020, 22000]]' }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // Change: (22000 - 20000) / 20000 * 100 = 10%
    expect(p.income_change_pct).toBeCloseTo(10.0, 1);
  });
});

describe('computeQuickWinMetrics — ratio calculations', () => {
  it('computes youth_ratio_pct from age cohorts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 80 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50 + 100 + 80) / 1000 * 100 = 23.0%
    expect(p.youth_ratio_pct).toBe(23.0);
  });

  it('computes gender_ratio as women/men', () => {
    const features = [makeFeature({ he_naiset: 520, he_miehet: 480 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // 520/480 = 1.0833... → rounded to 1.08
    expect(p.gender_ratio).toBe(1.08);
  });

  it('computes employment_rate from pt_tyoll / pt_vakiy', () => {
    const features = [makeFeature({ pt_tyoll: 600, pt_vakiy: 800 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // 600/800 * 100 = 75.0%
    expect(p.employment_rate).toBe(75.0);
  });

  it('computes elderly_ratio_pct from 65+ age groups', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50+40+30+20+10) / 1000 * 100 = 15.0%
    expect(p.elderly_ratio_pct).toBe(15.0);
  });

  it('computes avg_household_size as population / households', () => {
    const features = [makeFeature({ he_vakiy: 3000, te_taly: 1500 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.avg_household_size).toBe(2.0);
  });

  it('skips metrics when denominator is zero or null', () => {
    const features = [
      makeFeature({
        he_vakiy: 0,
        he_18_19: 10, he_20_24: 10, he_25_29: 10,
        he_naiset: 10, he_miehet: 0,
        pt_tyoll: 100, pt_vakiy: 0,
        te_taly: 0,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.gender_ratio).toBeUndefined();
    expect(p.employment_rate).toBeUndefined();
    expect(p.avg_household_size).toBeUndefined();
  });

  it('computes new_construction_pct from ra_raky / ra_asunn', () => {
    const features = [makeFeature({ ra_raky: 50, ra_asunn: 1000 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // 50/1000 * 100 = 5.0%
    expect(p.new_construction_pct).toBe(5.0);
  });
});
