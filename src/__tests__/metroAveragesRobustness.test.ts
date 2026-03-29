import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: null,
      city: null,
      he_vakiy: null,
      hr_mtu: null,
      hr_ktu: null,
      unemployment_rate: null,
      higher_education_rate: null,
      ko_yl_kork: null,
      ko_al_kork: null,
      ko_ika18y: null,
      pt_tyoll: null,
      pt_tyott: null,
      pt_vakiy: null,
      pt_opisk: null,
      pt_elakel: null,
      te_omis_as: null,
      te_taly: null,
      te_vuok_as: null,
      he_0_2: null,
      he_3_6: null,
      pinta_ala: null,
      ra_pt_as: null,
      ra_asunn: null,
      ra_as_kpa: null,
      quality_index: null,
      transit_stop_density: null,
      property_price_sqm: null,
      foreign_language_pct: null,
      single_person_hh_pct: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('computeMetroAverages', () => {
  it('returns all zeros for empty features array', () => {
    const result = computeMetroAverages([]);
    expect(result.he_vakiy).toBe(0);
    expect(result.unemployment_rate).toBe(0);
  });

  it('skips features with null population', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: null, hr_mtu: 30000 }),
    ]);
    expect(result.he_vakiy).toBe(0);
    expect(result.hr_mtu).toBe(0);
  });

  it('skips features with zero population', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 0, hr_mtu: 30000 }),
    ]);
    expect(result.he_vakiy).toBe(0);
  });

  it('computes population-weighted average for income', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 50000 }),
    ]);
    // Weighted: (30000*1000 + 50000*3000) / (1000+3000) = 180000000/4000 = 45000
    expect(result.hr_mtu).toBe(45000);
    expect(result.he_vakiy).toBe(4000);
  });

  it('computes unemployment rate from raw counts, not averaging percentages', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 500 }),
      makeFeature({ he_vakiy: 1000, pt_tyott: 50, pt_vakiy: 1000 }),
    ]);
    // Total unemployed: 150, total working-age: 1500
    // Rate: 150/1500 * 100 = 10.0%
    expect(result.unemployment_rate).toBe(10.0);
  });

  it('computes higher_education_rate from raw counts', () => {
    const result = computeMetroAverages([
      makeFeature({
        he_vakiy: 1000,
        ko_yl_kork: 200,  // university
        ko_al_kork: 100,  // polytechnic
        ko_ika18y: 800,   // adult population
      }),
    ]);
    // (200+100)/800 * 100 = 37.5%
    expect(result.higher_education_rate).toBe(37.5);
  });

  it('computes ownership_rate from household counts', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, te_omis_as: 300, te_taly: 500 }),
      makeFeature({ he_vakiy: 1000, te_omis_as: 400, te_taly: 500 }),
    ]);
    // Total owner: 700, total hh: 1000, rate: 70%
    expect(result.ownership_rate).toBe(70.0);
  });

  it('computes population_density correctly (per km²)', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 5000, pinta_ala: 1_000_000 }), // 1 km²
    ]);
    // 5000 / (1000000 / 1000000) = 5000 /km²
    expect(result.population_density).toBe(5000);
  });

  it('handles percentage-of-population metrics (pctOfPop) correctly', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 2000, foreign_language_pct: 10 }), // 200 people
      makeFeature({ he_vakiy: 8000, foreign_language_pct: 20 }), // 1600 people
    ]);
    // Total foreign: 200+1600=1800, total pop with data: 10000
    // Result: 1800/10000 * 100 = 18.0%
    expect(result.foreign_language_pct).toBe(18.0);
  });

  it('handles percentage-of-households metrics (pctOfHh) correctly', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, te_taly: 400, single_person_hh_pct: 25 }), // 100 single hh
      makeFeature({ he_vakiy: 1000, te_taly: 600, single_person_hh_pct: 50 }), // 300 single hh
    ]);
    // Total single: 100+300=400, total hh: 1000
    // Result: 400/1000 * 100 = 40.0%
    expect(result.single_person_hh_pct).toBe(40.0);
  });

  it('excludes income values <= 0 (requirePositive)', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
    ]);
    // Only the 40000 should count
    expect(result.hr_mtu).toBe(40000);
  });

  it('falls back to he_vakiy when pt_vakiy is null for unemployment calc', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 2000, pt_tyott: 100, pt_vakiy: null }),
    ]);
    // totalActPop falls back to pop (2000)
    // Rate: 100/2000 * 100 = 5.0%
    expect(result.unemployment_rate).toBe(5.0);
  });

  it('computes child_ratio correctly', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, he_0_2: 30, he_3_6: 50 }),
    ]);
    // children: 80, pop: 1000, ratio: 8.0%
    expect(result.child_ratio).toBe(8.0);
  });

  it('computes detached_house_share correctly', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, ra_pt_as: 200, ra_asunn: 500 }),
    ]);
    expect(result.detached_house_share).toBe(40.0);
  });

  it('computes pensioner_share correctly', () => {
    const result = computeMetroAverages([
      makeFeature({ he_vakiy: 1000, pt_elakel: 250 }),
    ]);
    expect(result.pensioner_share).toBe(25.0);
  });
});
