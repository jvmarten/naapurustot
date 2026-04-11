/**
 * Hardened tests for computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics,
 * and parseTrendSeries.
 *
 * Targets the highest-risk logic in metrics.ts:
 * - Population-weighted vs household-weighted aggregation
 * - pctOfPop/pctOfHh count ↔ percentage conversion roundtrip
 * - Special ratio metrics (unemployment, education, ownership, etc.)
 * - Division by zero in ratio computations
 * - Empty dataset handling
 * - parseTrendSeries validation and edge cases
 * - computeChangePct with zero first value, single data point
 * - computeQuickWinMetrics boundary conditions
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  computeMetroAverages,
  computeChangeMetrics,
  computeQuickWinMetrics,
  parseTrendSeries,
} from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function mkFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
  };
}

describe('computeMetroAverages', () => {
  it('computes population-weighted average for simple metric', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
      mkFeature({ pno: '00200', he_vakiy: 3000, hr_mtu: 20000 }),
    ];
    const avg = computeMetroAverages(features);
    // Weighted: (1000*40000 + 3000*20000) / (1000+3000) = 100_000_000 / 4000 = 25000
    expect(avg.hr_mtu).toBe(25000);
  });

  it('skips features with null or zero population', () => {
    const features = [
      mkFeature({ he_vakiy: null }),
      mkFeature({ pno: '00200', he_vakiy: 0 }),
      mkFeature({ pno: '00300', he_vakiy: 500, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(500);
  });

  it('returns 0 for all metrics when dataset is empty', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.higher_education_rate).toBe(0);
  });

  it('computes ratio-based unemployment_rate correctly', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 500 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // Total unemployed: 150, total active pop: 1000
    expect(avg.unemployment_rate).toBe(15); // (150/1000)*100 = 15%
  });

  it('computes higher_education_rate from raw counts', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 200, ko_ika18y: 800 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, ko_yl_kork: 50, ko_al_kork: 150, ko_ika18y: 700 }),
    ];
    const avg = computeMetroAverages(features);
    // Total higher ed: (100+200+50+150) = 500, total adult: 1500
    expect(avg.higher_education_rate).toBeCloseTo(33.3, 1);
  });

  it('computes ownership_rate from raw counts', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, te_omis_as: 300, te_taly: 500 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, te_omis_as: 200, te_taly: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // Total owner: 500, total HH: 1000 → 50%
    expect(avg.ownership_rate).toBe(50);
  });

  it('handles pctOfPop metric correctly (foreign_language_pct)', () => {
    const features = [
      mkFeature({ he_vakiy: 2000, foreign_language_pct: 10 }),
      mkFeature({ pno: '00200', he_vakiy: 2000, foreign_language_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // Pop-weighted: (2000 * 0.1 + 2000 * 0.3) / (2000 + 2000) * 100 = 800/4000*100 = 20%
    expect(avg.foreign_language_pct).toBe(20);
  });

  it('handles pctOfHh metric correctly (single_person_hh_pct)', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, te_taly: 400, single_person_hh_pct: 50 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, te_taly: 600, single_person_hh_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // HH-weighted: (400*0.5 + 600*0.3) / (400+600) * 100 = 380/1000*100 = 38%
    expect(avg.single_person_hh_pct).toBe(38);
  });

  it('skips requirePositive metrics with value <= 0', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, hr_mtu: -5000 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only feature 2 contributes to hr_mtu
    expect(avg.hr_mtu).toBe(30000);
  });

  it('computes population_density from area', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, pinta_ala: 1_000_000 }), // 1 km²
      mkFeature({ pno: '00200', he_vakiy: 2000, pinta_ala: 1_000_000 }), // 1 km²
    ];
    const avg = computeMetroAverages(features);
    // Total pop: 3000, total area: 2_000_000 m² = 2 km²
    expect(avg.population_density).toBe(1500); // 3000/2 = 1500/km²
  });

  it('avoids division by zero when totalArea is 0', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, pinta_ala: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(0);
  });

  it('avoids division by zero when totalHouseholds is 0', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, te_taly: null, te_omis_as: 100, te_vuok_as: 50 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.ownership_rate).toBe(0);
    expect(avg.rental_rate).toBe(0);
  });

  it('handles feature with population but missing specific metric', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, hr_mtu: null, crime_index: 10 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000, crime_index: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // Only feature 2 contributes to hr_mtu
    expect(avg.hr_mtu).toBe(30000);
    // Both contribute to crime_index
    expect(avg.crime_index).toBe(15);
  });

  it('applies precision rounding correctly', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, air_quality_index: 3.333 }),
      mkFeature({ pno: '00200', he_vakiy: 1000, air_quality_index: 4.666 }),
    ];
    const avg = computeMetroAverages(features);
    // Weighted avg: (3.333*1000 + 4.666*1000) / 2000 = 3.9995
    // air_quality_index has precision: 1, so rounds to 4.0
    expect(avg.air_quality_index).toBe(4);
  });
});

describe('parseTrendSeries', () => {
  it('parses valid trend series', () => {
    const result = parseTrendSeries('[[2019,100],[2020,200],[2021,300]]');
    expect(result).toEqual([[2019, 100], [2020, 200], [2021, 300]]);
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

  it('returns null for single data point (needs >= 2)', () => {
    expect(parseTrendSeries('[[2020,100]]')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('returns null for array with non-pair elements', () => {
    expect(parseTrendSeries('[[2020]]')).toBeNull();
  });

  it('returns null for array with NaN values', () => {
    expect(parseTrendSeries('[[2020, null]]')).toBeNull();
  });

  it('returns null for array with Infinity values', () => {
    // JSON doesn't encode Infinity, but a string could be malformed
    expect(parseTrendSeries('[[2020, "Infinity"]]')).toBeNull();
  });

  it('accepts already-parsed array input', () => {
    const arr = [[2019, 100], [2020, 200]] as [number, number][];
    // parseTrendSeries checks typeof raw === 'string' before JSON.parse
    const result = parseTrendSeries(arr as unknown as string);
    expect(result).toEqual([[2019, 100], [2020, 200]]);
  });
});

describe('computeChangeMetrics', () => {
  it('computes percentage change from first to last data point', () => {
    const features = [
      mkFeature({
        he_vakiy: 1000,
        income_history: '[[2019,20000],[2020,22000],[2021,24000]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (24000 - 20000) / 20000 * 100 = 20%
    expect(p.income_change_pct).toBe(20);
  });

  it('returns null when history is missing', () => {
    const features = [mkFeature({ he_vakiy: 1000 })];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null when first value is zero (prevents division by zero)', () => {
    const features = [
      mkFeature({
        he_vakiy: 1000,
        income_history: '[[2019,0],[2020,10000]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
  });

  it('handles negative first values correctly (uses abs(first))', () => {
    const features = [
      mkFeature({
        he_vakiy: 1000,
        // This is unusual but tests the Math.abs(first) denominator
        unemployment_history: '[[2019,-10],[2020,10]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (10 - (-10)) / abs(-10) * 100 = 20/10 * 100 = 200%
    expect(p.unemployment_change_pct).toBe(200);
  });

  it('computes negative change correctly', () => {
    const features = [
      mkFeature({
        he_vakiy: 1000,
        population_history: '[[2019,1000],[2020,800]]',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (800 - 1000) / 1000 * 100 = -20%
    expect(p.population_change_pct).toBe(-20);
  });
});

describe('computeQuickWinMetrics', () => {
  it('computes youth ratio correctly', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 100 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50+100+100) / 1000 * 100 = 25%
    expect(p.youth_ratio_pct).toBe(25);
  });

  it('computes gender ratio correctly', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, he_naiset: 520, he_miehet: 480 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.gender_ratio).toBeCloseTo(1.08, 2);
  });

  it('does not compute gender ratio when males is zero', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, he_naiset: 1000, he_miehet: 0 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.gender_ratio).toBeUndefined();
  });

  it('computes employment rate', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, pt_tyoll: 400, pt_vakiy: 600 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // 400/600 * 100 = 66.7%
    expect(p.employment_rate).toBeCloseTo(66.7, 1);
  });

  it('computes avg_household_size', () => {
    const features = [
      mkFeature({ he_vakiy: 2000, te_taly: 1000 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.avg_household_size).toBe(2);
  });

  it('does not overwrite with NaN when input fields are null', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, he_18_19: null, he_20_24: null, he_25_29: null }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // Should not be set at all (remains undefined)
    expect(p.youth_ratio_pct).toBeUndefined();
  });

  it('does not compute when population is zero', () => {
    const features = [
      mkFeature({ he_vakiy: 0, he_18_19: 10, he_20_24: 10, he_25_29: 10 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
  });

  it('computes elderly ratio from all elderly age groups', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50+40+30+20+10)/1000 * 100 = 15%
    expect(p.elderly_ratio_pct).toBe(15);
  });

  it('computes new_construction_pct', () => {
    const features = [
      mkFeature({ he_vakiy: 1000, ra_raky: 5, ra_asunn: 100 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // 5/100 * 100 = 5%
    expect(p.new_construction_pct).toBe(5);
  });
});
