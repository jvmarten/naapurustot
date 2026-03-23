/**
 * Tests for the weighted averaging logic in computeMetroAverages.
 *
 * The most dangerous bugs here involve:
 * - Averaging percentages directly instead of converting to counts first
 * - Using wrong weight type (population vs household)
 * - pctOfPop/pctOfHh conversion: accumulating counts then dividing back to %
 *
 * These tests use hand-calculable inputs to verify exact output.
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00000', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [25, 60] },
  };
}

describe('computeMetroAverages — population-weighted metrics', () => {
  it('computes population-weighted average for hr_mtu correctly', () => {
    // Area A: pop 1000, income 20000
    // Area B: pop 3000, income 40000
    // Weighted avg = (1000*20000 + 3000*40000) / (1000+3000) = 140_000_000 / 4000 = 35000
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 20000 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(35000);
  });

  it('excludes areas with zero or negative income (requirePositive)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ he_vakiy: 2000, hr_mtu: 0 }), // should be excluded
      makeFeature({ he_vakiy: 1000, hr_mtu: -5000 }), // should be excluded
    ];
    const avg = computeMetroAverages(features);
    // Only area A contributes: 30000
    expect(avg.hr_mtu).toBe(30000);
  });

  it('computes property_price_sqm weighted by population', () => {
    const features = [
      makeFeature({ he_vakiy: 2000, property_price_sqm: 5000 }),
      makeFeature({ he_vakiy: 2000, property_price_sqm: 3000 }),
    ];
    const avg = computeMetroAverages(features);
    // Equal populations: simple average = 4000
    expect(avg.property_price_sqm).toBe(4000);
  });
});

describe('computeMetroAverages — pctOfPop conversion', () => {
  it('correctly converts foreign_language_pct through count accumulation', () => {
    // Area A: pop 1000, foreign_language_pct 20% → 200 people
    // Area B: pop 3000, foreign_language_pct 10% → 300 people
    // Total foreign: 500, total pop: 4000
    // Metro avg = (500/4000) * 100 = 12.5%
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 20 }),
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBe(12.5);
  });

  it('does NOT naively average percentages (would give wrong answer)', () => {
    // Naive average of 20% and 10% = 15%, but population-weighted should give 12.5%
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 20 }),
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    // If the code naively averaged, it would be 15.0
    expect(avg.foreign_language_pct).not.toBe(15.0);
    expect(avg.foreign_language_pct).toBe(12.5);
  });

  it('handles employment_rate as pctOfPop', () => {
    // Area A: pop 2000, employment_rate 80% → 1600
    // Area B: pop 2000, employment_rate 60% → 1200
    // Total: 2800 / 4000 = 70%
    const features = [
      makeFeature({ he_vakiy: 2000, employment_rate: 80 }),
      makeFeature({ he_vakiy: 2000, employment_rate: 60 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.employment_rate).toBe(70.0);
  });
});

describe('computeMetroAverages — pctOfHh conversion', () => {
  it('correctly converts single_person_hh_pct through household count', () => {
    // Area A: pop 1000, te_taly 500, single_person_hh_pct 60% → 300 single hh
    // Area B: pop 2000, te_taly 1000, single_person_hh_pct 40% → 400 single hh
    // Total single: 700, total hh: 1500
    // Metro avg = (700/1500) * 100 = 46.67%
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 60 }),
      makeFeature({ he_vakiy: 2000, te_taly: 1000, single_person_hh_pct: 40 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBeCloseTo(46.7, 1);
  });

  it('correctly converts families_with_children_pct through household count', () => {
    // Area A: te_taly 400, families_with_children_pct 50% → 200
    // Area B: te_taly 600, families_with_children_pct 30% → 180
    // Total: 380 / 1000 = 38%
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 400, families_with_children_pct: 50 }),
      makeFeature({ he_vakiy: 2000, te_taly: 600, families_with_children_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.families_with_children_pct).toBe(38.0);
  });

  it('skips areas with zero households for pctOfHh metrics', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 0, single_person_hh_pct: 60 }),
      makeFeature({ he_vakiy: 2000, te_taly: 800, single_person_hh_pct: 50 }),
    ];
    const avg = computeMetroAverages(features);
    // Only area B contributes
    expect(avg.single_person_hh_pct).toBe(50.0);
  });
});

describe('computeMetroAverages — ratio-based special metrics', () => {
  it('computes unemployment_rate from raw counts, not averaging percentages', () => {
    // Area A: pt_tyott=100, pt_vakiy=1000 → 10%
    // Area B: pt_tyott=50, pt_vakiy=2000 → 2.5%
    // Metro: 150/3000 = 5%
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 1000 }),
      makeFeature({ he_vakiy: 2000, pt_tyott: 50, pt_vakiy: 2000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBe(5.0);
  });

  it('computes higher_education_rate from raw counts', () => {
    // Area A: ko_yl_kork=300, ko_al_kork=200, ko_ika18y=1000 → 50%
    // Area B: ko_yl_kork=100, ko_al_kork=100, ko_ika18y=1000 → 20%
    // Metro: 700/2000 = 35%
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 300, ko_al_kork: 200, ko_ika18y: 1000 }),
      makeFeature({ he_vakiy: 2000, ko_yl_kork: 100, ko_al_kork: 100, ko_ika18y: 1000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.higher_education_rate).toBe(35.0);
  });

  it('computes population_density from total pop and total area', () => {
    // Area A: pop 1000, area 1_000_000 m² (1 km²)
    // Area B: pop 3000, area 1_000_000 m² (1 km²)
    // Total: 4000 pop / 2 km² = 2000 /km²
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: 1_000_000 }),
      makeFeature({ he_vakiy: 3000, pinta_ala: 1_000_000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(2000);
  });

  it('computes child_ratio from summed children over total pop', () => {
    // Area A: pop 1000, he_0_2=50, he_3_6=50 → 100 children
    // Area B: pop 3000, he_0_2=100, he_3_6=200 → 300 children
    // Total: 400/4000 = 10%
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 50, he_3_6: 50 }),
      makeFeature({ he_vakiy: 3000, he_0_2: 100, he_3_6: 200 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.child_ratio).toBe(10.0);
  });
});

describe('computeMetroAverages — null handling', () => {
  it('skips features with null population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 50000 }),
      makeFeature({ he_vakiy: 2000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(2000);
  });

  it('handles all-null metric values gracefully', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: null }),
      makeFeature({ he_vakiy: 2000, hr_mtu: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('handles mix of null and valid values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, transit_stop_density: null }),
      makeFeature({ he_vakiy: 1000, transit_stop_density: 50 }),
      makeFeature({ he_vakiy: 1000, transit_stop_density: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // Only the two non-null areas contribute: (1000*50 + 1000*30) / 2000 = 40
    expect(avg.transit_stop_density).toBe(40.0);
  });

  it('returns zero for everything when given empty array', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.hr_mtu).toBe(0);
  });
});
