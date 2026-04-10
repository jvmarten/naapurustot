/**
 * Tests for computeMetroAverages edge cases:
 * - Zero-division guards for all ratio metrics
 * - pctOfPop/pctOfHh conversion precision
 * - Features with partial data (some fields null, others populated)
 * - Large dataset aggregate accuracy
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city: 'helsinki_metro',
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('computeMetroAverages — zero-division guards', () => {
  it('returns 0 for all ratio metrics when no features have population', () => {
    const features = [
      makeFeature({ he_vakiy: 0 }),
      makeFeature({ he_vakiy: null }),
      makeFeature({ he_vakiy: -1 }),
    ];
    const result = computeMetroAverages(features);
    expect(result.unemployment_rate).toBe(0);
    expect(result.higher_education_rate).toBe(0);
    expect(result.ownership_rate).toBe(0);
    expect(result.rental_rate).toBe(0);
    expect(result.student_share).toBe(0);
    expect(result.population_density).toBe(0);
    expect(result.child_ratio).toBe(0);
    expect(result.detached_house_share).toBe(0);
    expect(result.pensioner_share).toBe(0);
    expect(result.he_vakiy).toBe(0);
  });

  it('returns 0 for empty feature array', () => {
    const result = computeMetroAverages([]);
    expect(result.unemployment_rate).toBe(0);
    expect(result.he_vakiy).toBe(0);
    expect(result.hr_mtu).toBe(0);
  });

  it('handles features with population but no other data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000 }),
      makeFeature({ he_vakiy: 2000 }),
    ];
    const result = computeMetroAverages(features);
    expect(result.he_vakiy).toBe(3000);
    // Ratio metrics should handle null numerators gracefully
    expect(result.unemployment_rate).toBe(0); // totalUnemployed = 0, totalActPop = 3000
  });
});

describe('computeMetroAverages — pctOfPop conversion accuracy', () => {
  it('correctly converts percentage metrics back to percentages', () => {
    // foreign_language_pct is pctOfPop: accumulates (value/100)*pop, divides by pop, *100
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }),  // 100 foreign speakers
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 20 }),  // 600 foreign speakers
    ];
    const result = computeMetroAverages(features);
    // Total: 700 foreign speakers out of 4000 = 17.5%
    expect(result.foreign_language_pct).toBeCloseTo(17.5, 1);
  });

  it('correctly computes population-weighted pct for youth_ratio_pct', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, youth_ratio_pct: 30 }),  // 300 youth
      makeFeature({ he_vakiy: 1000, youth_ratio_pct: 10 }),  // 100 youth
    ];
    const result = computeMetroAverages(features);
    // Total: 400 youth out of 2000 = 20%
    expect(result.youth_ratio_pct).toBeCloseTo(20, 1);
  });
});

describe('computeMetroAverages — pctOfHh conversion accuracy', () => {
  it('correctly converts household-based percentages', () => {
    // single_person_hh_pct is pctOfHh: accumulates (value/100)*households
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 40 }),  // 200 single HH
      makeFeature({ he_vakiy: 2000, te_taly: 1000, single_person_hh_pct: 60 }), // 600 single HH
    ];
    const result = computeMetroAverages(features);
    // Total: 800 single HH out of 1500 = 53.3%
    expect(result.single_person_hh_pct).toBeCloseTo(53.3, 1);
  });

  it('correctly computes families_with_children_pct', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 400, families_with_children_pct: 25 }), // 100 families
      makeFeature({ he_vakiy: 1000, te_taly: 600, families_with_children_pct: 50 }), // 300 families
    ];
    const result = computeMetroAverages(features);
    // Total: 400 families out of 1000 HH = 40%
    expect(result.families_with_children_pct).toBeCloseTo(40, 1);
  });
});

describe('computeMetroAverages — population-weighted averages', () => {
  it('correctly population-weights income', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 20000 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const result = computeMetroAverages(features);
    // Weighted: (20000*1000 + 40000*3000) / (1000+3000) = 35000
    expect(result.hr_mtu).toBe(35000);
  });

  it('excludes features with non-positive income (requirePositive)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),     // excluded
      makeFeature({ he_vakiy: 1000, hr_mtu: -5000 }),  // excluded
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),  // included
    ];
    const result = computeMetroAverages(features);
    // Only the third feature contributes
    expect(result.hr_mtu).toBe(30000);
  });

  it('skips NaN and Infinity values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: NaN }),
      makeFeature({ he_vakiy: 1000, hr_mtu: Infinity }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const result = computeMetroAverages(features);
    expect(result.hr_mtu).toBe(30000);
  });
});

describe('computeMetroAverages — special ratio metrics', () => {
  it('computes unemployment_rate from raw counts, not averaging percentages', () => {
    // This is critical: averaging percentages directly would give wrong results
    // when populations differ
    const features = [
      makeFeature({ he_vakiy: 100, pt_tyott: 10, pt_vakiy: 80 }),  // 12.5% unemployment
      makeFeature({ he_vakiy: 900, pt_tyott: 18, pt_vakiy: 720 }), // 2.5% unemployment
    ];
    const result = computeMetroAverages(features);
    // Correct: (10+18)/(80+720) = 28/800 = 3.5%
    // Wrong (averaging %s): (12.5+2.5)/2 = 7.5%
    expect(result.unemployment_rate).toBeCloseTo(3.5, 1);
  });

  it('computes higher_education_rate from raw counts', () => {
    const features = [
      makeFeature({ he_vakiy: 500, ko_yl_kork: 100, ko_al_kork: 50, ko_ika18y: 400 }),
      makeFeature({ he_vakiy: 500, ko_yl_kork: 200, ko_al_kork: 100, ko_ika18y: 400 }),
    ];
    const result = computeMetroAverages(features);
    // Total higher ed: (100+50+200+100) = 450, total adult: 800
    expect(result.higher_education_rate).toBeCloseTo(56.3, 1);
  });

  it('computes population_density from total pop / total area', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: 1000000 }), // 1 km²
      makeFeature({ he_vakiy: 4000, pinta_ala: 1000000 }), // 1 km²
    ];
    const result = computeMetroAverages(features);
    // Total: 5000 people / 2 km² = 2500 /km²
    expect(result.population_density).toBe(2500);
  });

  it('uses pt_vakiy for working-age pop, falls back to he_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_vakiy: null, pt_tyott: 50 }),
      makeFeature({ he_vakiy: 2000, pt_vakiy: 1500, pt_tyott: 75 }),
    ];
    const result = computeMetroAverages(features);
    // Feature 1: pt_vakiy null → fallback to he_vakiy=1000
    // Feature 2: pt_vakiy=1500
    // Total: (50+75) / (1000+1500) = 125/2500 = 5%
    expect(result.unemployment_rate).toBeCloseTo(5, 1);
  });
});

describe('computeMetroAverages — rounding precision', () => {
  it('rounds percentage metrics to 1 decimal place', () => {
    const features = [
      makeFeature({ he_vakiy: 3, pt_tyott: 1, pt_vakiy: 3 }),
    ];
    const result = computeMetroAverages(features);
    // 1/3 * 100 = 33.333...% → should round to 33.3
    expect(result.unemployment_rate).toBe(33.3);
  });

  it('rounds income to 0 decimal places', () => {
    const features = [
      makeFeature({ he_vakiy: 3, hr_mtu: 30001 }),
      makeFeature({ he_vakiy: 3, hr_mtu: 30002 }),
    ];
    const result = computeMetroAverages(features);
    // Weighted average: (30001*3 + 30002*3)/6 = 30001.5 → rounds to 30002
    expect(Number.isInteger(result.hr_mtu)).toBe(true);
  });
});
