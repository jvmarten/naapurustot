/**
 * Metro averages — weighted computation, ratio metrics, and edge cases.
 *
 * Priority 1: Core data transformation. Wrong metro averages affect all
 * comparison displays, score cards, and the entire "All cities" view.
 *
 * Targets untested paths:
 * - Ratio metrics computed from raw counts (unemployment, education, ownership, etc.)
 * - pctOfPop conversion: accumulate count then convert back to percentage
 * - pctOfHh weighting by household count
 * - population_density area conversion (m² to km²)
 * - requirePositive filtering for income
 * - Employment rate from pt_tyoll / pt_vakiy
 * - All zero-denominator branches
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: null, ...props },
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('computeMetroAverages — ratio metrics from raw counts', () => {
  it('computes unemployment_rate from raw pt_tyott / pt_vakiy counts', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 500 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, pt_tyott: 150, pt_vakiy: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // (50 + 150) / (500 + 500) * 100 = 20.0
    expect(avg.unemployment_rate).toBe(20.0);
  });

  it('computes higher_education_rate from ko_yl_kork + ko_al_kork / ko_ika18y', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 50, ko_ika18y: 800 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, ko_yl_kork: 200, ko_al_kork: 100, ko_ika18y: 800 }),
    ];
    const avg = computeMetroAverages(features);
    // (100+50 + 200+100) / (800+800) * 100 = 450/1600 * 100 = 28.125 → 28.1
    expect(avg.higher_education_rate).toBeCloseTo(28.1, 1);
  });

  it('computes ownership_rate from te_omis_as / te_taly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_omis_as: 200, te_taly: 500 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_omis_as: 300, te_taly: 500 }),
    ];
    const avg = computeMetroAverages(features);
    // (200+300)/(500+500) = 50%
    expect(avg.ownership_rate).toBe(50.0);
  });

  it('computes child_ratio from he_0_2 + he_3_6 / he_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 30, he_3_6: 20 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, he_0_2: 60, he_3_6: 40 }),
    ];
    const avg = computeMetroAverages(features);
    // (30+20 + 60+40) / (1000+2000) = 150/3000 = 5.0%
    expect(avg.child_ratio).toBe(5.0);
  });

  it('computes employment_rate from pt_tyoll / pt_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyoll: 400, pt_vakiy: 600 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, pt_tyoll: 500, pt_vakiy: 700 }),
    ];
    const avg = computeMetroAverages(features);
    // (400+500)/(600+700) * 100 = 69.2...
    expect(avg.employment_rate).toBeCloseTo(69.2, 1);
  });
});

describe('computeMetroAverages — population-weighted metrics', () => {
  it('weights hr_mtu (median income) by population', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    // (30000*1000 + 40000*3000) / (1000+3000) = 150M/4000 = 37500
    expect(avg.hr_mtu).toBe(37500);
  });

  it('skips hr_mtu <= 0 due to requirePositive', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('skips features with he_vakiy <= 0', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 25000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(25000);
  });

  it('skips features with null he_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: 500, hr_mtu: 20000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(20000);
  });
});

describe('computeMetroAverages — pctOfPop conversion', () => {
  it('converts foreign_language_pct to count, sums, then back to pct', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // Count: (10/100)*1000 + (20/100)*3000 = 100 + 600 = 700
    // Back to pct: 700/4000*100 = 17.5
    expect(avg.foreign_language_pct).toBe(17.5);
  });

  it('converts youth_ratio_pct via pctOfPop correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 500, youth_ratio_pct: 20 }),
      makeFeature({ pno: '00200', he_vakiy: 500, youth_ratio_pct: 10 }),
    ];
    const avg = computeMetroAverages(features);
    // Count: (20/100)*500 + (10/100)*500 = 100 + 50 = 150
    // Pct: 150/1000 * 100 = 15.0
    expect(avg.youth_ratio_pct).toBe(15.0);
  });
});

describe('computeMetroAverages — pctOfHh conversion', () => {
  it('weights single_person_hh_pct by household count (te_taly)', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: 200, single_person_hh_pct: 60 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_taly: 800, single_person_hh_pct: 40 }),
    ];
    const avg = computeMetroAverages(features);
    // Count: (60/100)*200 + (40/100)*800 = 120 + 320 = 440
    // Pct: 440/1000 * 100 = 44.0
    expect(avg.single_person_hh_pct).toBe(44.0);
  });
});

describe('computeMetroAverages — population_density area conversion', () => {
  it('computes density from total population / total area in km²', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km²
      makeFeature({ pno: '00200', he_vakiy: 10000, pinta_ala: 2_000_000 }), // 2 km²
    ];
    const avg = computeMetroAverages(features);
    // 15000 / (3 km²) = 5000
    expect(avg.population_density).toBe(5000);
  });
});

describe('computeMetroAverages — zero denominator safety', () => {
  it('returns 0 for unemployment_rate when totalActPop is 0', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: null, pt_vakiy: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBe(0);
  });

  it('returns 0 for ownership_rate when totalHouseholds is 0', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_omis_as: null, te_taly: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.ownership_rate).toBe(0);
  });

  it('returns 0 for population_density when totalArea is 0', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(0);
  });

  it('returns total population in he_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 1000 }),
      makeFeature({ pno: '00200', he_vakiy: 2000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(3000);
  });
});

describe('computeMetroAverages — empty dataset', () => {
  it('returns zero for all ratio metrics with empty features array', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
    expect(avg.higher_education_rate).toBe(0);
    expect(avg.ownership_rate).toBe(0);
    expect(avg.population_density).toBe(0);
  });
});
