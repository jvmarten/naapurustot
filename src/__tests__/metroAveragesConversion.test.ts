import { describe, it, expect } from 'vitest';
import { computeMetroAverages } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('computeMetroAverages — pctOfPop conversion roundtrip', () => {
  it('computes population-weighted average for foreign_language_pct (pctOfPop)', () => {
    // Two neighborhoods: 10% foreign in pop 1000, 30% foreign in pop 3000
    // Expected: (0.10*1000 + 0.30*3000) / (1000+3000) = (100+900)/4000 = 25%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, foreign_language_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBe(25);
  });

  it('computes household-weighted average for single_person_hh_pct (pctOfHh)', () => {
    // Two neighborhoods: 50% single-person in 200 hh, 20% single-person in 800 hh
    // Expected: (0.50*200 + 0.20*800) / (200+800) = (100+160)/1000 = 26%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, te_taly: 200, single_person_hh_pct: 50 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, te_taly: 800, single_person_hh_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBe(26);
  });

  it('computes youth_ratio_pct weighted by population (pctOfPop)', () => {
    // 15% youth in pop 2000, 5% youth in pop 2000
    // Expected: (0.15*2000 + 0.05*2000) / (2000+2000) = (300+100)/4000 = 10%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 2000, youth_ratio_pct: 15 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, youth_ratio_pct: 5 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.youth_ratio_pct).toBe(10);
  });
});

describe('computeMetroAverages — ratio-based metrics', () => {
  it('computes unemployment_rate from raw counts (not weighted pct)', () => {
    // Neighborhood A: 50 unemployed, 500 working-age
    // Neighborhood B: 30 unemployed, 300 working-age
    // Expected: (50+30)/(500+300) = 80/800 = 10.0%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 600, pt_tyott: 50, pt_vakiy: 500 }),
      makeFeature({ pno: '00200', he_vakiy: 400, pt_tyott: 30, pt_vakiy: 300 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBe(10);
  });

  it('computes higher_education_rate from raw counts', () => {
    // Neighborhood A: 100 uni + 50 polytechnic out of 400 adults
    // Neighborhood B: 200 uni + 100 polytechnic out of 600 adults
    // Expected: (100+50+200+100)/(400+600) = 450/1000 = 45.0%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 500, ko_yl_kork: 100, ko_al_kork: 50, ko_ika18y: 400 }),
      makeFeature({ pno: '00200', he_vakiy: 700, ko_yl_kork: 200, ko_al_kork: 100, ko_ika18y: 600 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.higher_education_rate).toBe(45);
  });

  it('computes ownership_rate from raw dwelling counts', () => {
    // A: 80 owner-occupied out of 200 households
    // B: 120 owner-occupied out of 300 households
    // Expected: (80+120)/(200+300) = 200/500 = 40.0%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 500, te_omis_as: 80, te_taly: 200 }),
      makeFeature({ pno: '00200', he_vakiy: 700, te_omis_as: 120, te_taly: 300 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.ownership_rate).toBe(40);
  });

  it('computes population_density from total area and population', () => {
    // A: 2000 pop, 1_000_000 m² (= 1 km²)
    // B: 3000 pop, 2_000_000 m² (= 2 km²)
    // Expected: 5000 / 3 km² ≈ 1667 /km²
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 2000, pinta_ala: 1_000_000 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, pinta_ala: 2_000_000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(1667);
  });

  it('computes child_ratio from raw child counts', () => {
    // A: 50 (0-2) + 60 (3-6) in 1000 pop
    // B: 70 (0-2) + 80 (3-6) in 2000 pop
    // Expected: (50+60+70+80)/(1000+2000) = 260/3000 = 8.7%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, he_0_2: 50, he_3_6: 60 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, he_0_2: 70, he_3_6: 80 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.child_ratio).toBeCloseTo(8.7, 1);
  });

  it('computes employment_rate from raw counts', () => {
    // A: 400 employed, 500 working-age
    // B: 600 employed, 800 working-age
    // Expected: (400+600)/(500+800) = 1000/1300 ≈ 76.9%
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 600, pt_tyoll: 400, pt_vakiy: 500 }),
      makeFeature({ pno: '00200', he_vakiy: 900, pt_tyoll: 600, pt_vakiy: 800 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.employment_rate).toBeCloseTo(76.9, 1);
  });
});

describe('computeMetroAverages — edge cases', () => {
  it('returns 0 for all metrics when no features have positive population', () => {
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 0 }),
      makeFeature({ pno: '00200', he_vakiy: null }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
  });

  it('skips features with null population', () => {
    const features = [
      makeFeature({ pno: '00100', he_vakiy: null, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('excludes zero/negative income when requirePositive is set', () => {
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(40000);
  });

  it('returns empty result for empty features array', () => {
    const avg = computeMetroAverages([]);
    expect(avg.he_vakiy).toBe(0);
    expect(avg.unemployment_rate).toBe(0);
  });

  it('uses population as fallback when pt_vakiy is null for active population', () => {
    // When pt_vakiy is null, totalActPop falls back to he_vakiy
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, pt_vakiy: null, pt_tyott: 100 }),
    ];
    const avg = computeMetroAverages(features);
    // 100/1000 = 10%
    expect(avg.unemployment_rate).toBe(10);
  });
});
