/**
 * Tests for metrics.ts — parseTrendSeries, computeChangePct, and
 * computeMetroAverages edge cases that aren't covered elsewhere.
 *
 * These are high-risk: trend parsing bugs silently corrupt all trend
 * charts and change metrics across the entire app.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTrendSeries,
  computeChangeMetrics,
  computeQuickWinMetrics,
  computeMetroAverages,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

describe('parseTrendSeries — validation', () => {
  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2019,28000],[2020,29000],[2021,30000]]');
    expect(result).toEqual([[2019, 28000], [2020, 29000], [2021, 30000]]);
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

  it('returns null for array with fewer than 2 data points', () => {
    expect(parseTrendSeries('[[2021,30000]]')).toBeNull();
  });

  it('returns null for array with non-number elements', () => {
    expect(parseTrendSeries('[["2019",28000],["2020",29000]]')).toBeNull();
  });

  it('returns null for array with wrong tuple length', () => {
    expect(parseTrendSeries('[[2019,28000,1],[2020,29000,2]]')).toBeNull();
  });

  it('returns null for array containing Infinity', () => {
    // JSON doesn't support Infinity, but test the validation logic
    expect(parseTrendSeries('[[2019,null],[2020,29000]]')).toBeNull();
  });

  it('returns null for nested arrays (not tuples)', () => {
    expect(parseTrendSeries('[[1,2],[3,[4,5]]]')).toBeNull();
  });

  it('parses array with exactly 2 data points', () => {
    const result = parseTrendSeries('[[2020,28000],[2021,30000]]');
    expect(result).toEqual([[2020, 28000], [2021, 30000]]);
  });

  it('handles negative values correctly', () => {
    const result = parseTrendSeries('[[2019,-5.2],[2020,-3.1]]');
    expect(result).toEqual([[2019, -5.2], [2020, -3.1]]);
  });

  it('handles decimal years and values', () => {
    const result = parseTrendSeries('[[2019.5,28000.5],[2020.5,29000.5]]');
    expect(result).toEqual([[2019.5, 28000.5], [2020.5, 29000.5]]);
  });
});

describe('computeChangeMetrics — percentage change calculation', () => {
  function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
    return {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Test',
        namn: 'Test',
        income_history: null,
        population_history: null,
        unemployment_history: null,
        income_change_pct: null,
        population_change_pct: null,
        unemployment_change_pct: null,
        ...overrides,
      } as NeighborhoodProperties,
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
  }

  it('computes correct percentage change from trend history', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2019, 20000], [2021, 24000]]),
        population_history: JSON.stringify([[2019, 5000], [2021, 5500]]),
        unemployment_history: JSON.stringify([[2019, 10.0], [2021, 8.0]]),
      }),
    ];

    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    // (24000-20000)/20000 * 100 = 20%
    expect(p.income_change_pct).toBeCloseTo(20.0, 1);
    // (5500-5000)/5000 * 100 = 10%
    expect(p.population_change_pct).toBeCloseTo(10.0, 1);
    // (8.0-10.0)/10.0 * 100 = -20%
    expect(p.unemployment_change_pct).toBeCloseTo(-20.0, 1);
  });

  it('returns null when history is null', () => {
    const features = [makeFeature({})];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null when first value is 0 (division by zero)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2019, 0], [2021, 24000]]),
      }),
    ];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative starting values correctly with abs(first)', () => {
    const features = [
      makeFeature({
        // This tests the Math.abs(first) in the denominator
        unemployment_history: JSON.stringify([[2019, -5], [2021, -3]]),
      }),
    ];
    computeChangeMetrics(features);
    const change = (features[0].properties as NeighborhoodProperties).unemployment_change_pct;
    // (-3 - (-5)) / abs(-5) * 100 = 2/5 * 100 = 40%
    expect(change).toBeCloseTo(40.0, 1);
  });

  it('uses first and last data points (ignores intermediate)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2019, 20000], [2020, 50000], [2021, 24000]]),
      }),
    ];
    computeChangeMetrics(features);
    // Should use 2019 and 2021, ignoring the 2020 spike
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeCloseTo(20.0, 1);
  });
});

describe('computeQuickWinMetrics — edge cases', () => {
  function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
    return {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Test',
        namn: 'Test',
        he_vakiy: 5000,
        youth_ratio_pct: null,
        gender_ratio: null,
        single_parent_hh_pct: null,
        families_with_children_pct: null,
        employment_rate: null,
        elderly_ratio_pct: null,
        avg_household_size: null,
        ...overrides,
      } as NeighborhoodProperties,
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
  }

  it('skips computation when population is 0', () => {
    const features = [
      makeFeature({
        he_vakiy: 0,
        he_18_19: 100,
        he_20_24: 200,
        he_25_29: 250,
      }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeNull();
  });

  it('skips computation when population is null', () => {
    const features = [
      makeFeature({
        he_vakiy: null,
        he_18_19: 100,
        he_20_24: 200,
        he_25_29: 250,
      }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeNull();
  });

  it('handles gender_ratio when male population is 0', () => {
    const features = [
      makeFeature({
        he_naiset: 5000,
        he_miehet: 0,
      }),
    ];
    computeQuickWinMetrics(features);
    // Division by zero protection: miehet > 0 check
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeNull();
  });

  it('computes employment_rate correctly', () => {
    const features = [
      makeFeature({
        pt_tyoll: 3000,
        pt_vakiy: 4000,
      }),
    ];
    computeQuickWinMetrics(features);
    // 3000/4000 * 100 = 75.0%
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBe(75.0);
  });

  it('rounds to 1 decimal for percentages', () => {
    const features = [
      makeFeature({
        he_vakiy: 3,
        he_18_19: 1,
        he_20_24: 0,
        he_25_29: 0,
      }),
    ];
    computeQuickWinMetrics(features);
    // 1/3 * 100 = 33.333... → rounded to 33.3
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBe(33.3);
  });

  it('rounds gender_ratio to 2 decimals', () => {
    const features = [
      makeFeature({
        he_naiset: 1000,
        he_miehet: 3000,
      }),
    ];
    computeQuickWinMetrics(features);
    // 1000/3000 = 0.333... → 0.33
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBe(0.33);
  });
});

describe('computeMetroAverages — special ratio metrics', () => {
  function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
    return {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Test',
        namn: 'Test',
        he_vakiy: 5000,
        pt_tyott: 300,
        pt_vakiy: 4000,
        ko_ika18y: 4000,
        ko_yl_kork: 800,
        ko_al_kork: 600,
        te_taly: 2500,
        te_omis_as: 1200,
        te_vuok_as: 1100,
        pinta_ala: 2_000_000,
        he_0_2: 100,
        he_3_6: 150,
        ra_asunn: 2000,
        ra_pt_as: 300,
        pt_opisk: 400,
        pt_elakel: 500,
        ...overrides,
      } as NeighborhoodProperties,
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
  }

  it('unemployment_rate is count-based (not averaged)', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pt_tyott: 500, pt_vakiy: 5000 }),
      makeFeature({ he_vakiy: 5000, pt_tyott: 100, pt_vakiy: 2000 }),
    ];

    const avg = computeMetroAverages(features);

    // Total unemployed: 600, Total active pop: 7000
    // Rate: 600/7000 * 100 = 8.57%
    expect(avg.unemployment_rate).toBeCloseTo(8.6, 0);
  });

  it('higher_education_rate sums both university and polytechnic', () => {
    const features = [
      makeFeature({
        he_vakiy: 5000,
        ko_ika18y: 4000,
        ko_yl_kork: 1000, // university
        ko_al_kork: 500,  // polytechnic
      }),
    ];

    const avg = computeMetroAverages(features);
    // (1000+500)/4000 * 100 = 37.5%
    expect(avg.higher_education_rate).toBeCloseTo(37.5, 0);
  });

  it('population_density uses correct m² to km² conversion', () => {
    const features = [
      makeFeature({
        he_vakiy: 10000,
        pinta_ala: 1_000_000, // 1 km²
      }),
    ];

    const avg = computeMetroAverages(features);
    // 10000 / (1_000_000 / 1_000_000) = 10000 /km²
    expect(avg.population_density).toBe(10000);
  });

  it('skips features with population <= 0', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 99999 }),
      makeFeature({ he_vakiy: 5000, hr_mtu: 30000 }),
    ];

    const avg = computeMetroAverages(features);
    // Should only consider the second feature
    expect(avg.he_vakiy).toBe(5000);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('pctOfPop metrics convert percentage to count before averaging', () => {
    // Test foreign_language_pct (pctOfPop = true)
    const features = [
      makeFeature({ he_vakiy: 10000, foreign_language_pct: 20 }),
      makeFeature({ he_vakiy: 5000, foreign_language_pct: 10 }),
    ];

    const avg = computeMetroAverages(features);
    // Count: 10000*0.20 + 5000*0.10 = 2500
    // Weight: 15000
    // Result: (2500/15000)*100 = 16.67%
    // Naive average would give 15%
    expect(avg.foreign_language_pct).toBeCloseTo(16.7, 0);
  });

  it('pctOfHh metrics use household count as weight', () => {
    // Test single_person_hh_pct (pctOfHh = true)
    const features = [
      makeFeature({ he_vakiy: 5000, te_taly: 3000, single_person_hh_pct: 50 }),
      makeFeature({ he_vakiy: 5000, te_taly: 1000, single_person_hh_pct: 10 }),
    ];

    const avg = computeMetroAverages(features);
    // Count: 3000*0.50 + 1000*0.10 = 1600
    // Weight: 4000
    // Result: (1600/4000)*100 = 40%
    expect(avg.single_person_hh_pct).toBeCloseTo(40.0, 0);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, hr_mtu: null }),
    ];

    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });
});
