import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      ...props,
    } as NeighborhoodProperties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

describe('computeQuickWinMetrics — rounding and edge cases', () => {
  it('youth_ratio_pct rounds to 1 decimal place', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_18_19: 33,
      he_20_24: 44,
      he_25_29: 55,
    });
    computeQuickWinMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (33+44+55)/1000 * 100 = 13.2
    expect(p.youth_ratio_pct).toBe(13.2);
  });

  it('gender_ratio rounds to 2 decimal places', () => {
    const f = makeFeature({
      he_naiset: 333,
      he_miehet: 667,
    });
    computeQuickWinMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // 333/667 = 0.49925... → 0.50
    expect(p.gender_ratio).toBe(0.5);
  });

  it('skips youth_ratio when population is zero', () => {
    const f = makeFeature({
      he_vakiy: 0,
      he_18_19: 10, he_20_24: 20, he_25_29: 30,
    });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('skips gender_ratio when men is zero', () => {
    const f = makeFeature({ he_naiset: 500, he_miehet: 0 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('skips metrics when required fields are null', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_18_19: null, he_20_24: 50, he_25_29: 50,
    });
    computeQuickWinMetrics([f]);
    // youth_ratio requires ALL three age groups to be non-null
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('employment_rate uses pt_vakiy denominator, not he_vakiy', () => {
    const f = makeFeature({
      he_vakiy: 5000,
      pt_tyoll: 300,
      pt_vakiy: 400, // working-age population
    });
    computeQuickWinMetrics([f]);
    // 300/400 * 100 = 75%
    expect((f.properties as NeighborhoodProperties).employment_rate).toBe(75);
  });

  it('elderly_ratio sums all 65+ age groups', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_65_69: 50,
      he_70_74: 40,
      he_75_79: 30,
      he_80_84: 20,
      he_85_: 10,
    });
    computeQuickWinMetrics([f]);
    // (50+40+30+20+10)/1000 * 100 = 15%
    expect((f.properties as NeighborhoodProperties).elderly_ratio_pct).toBe(15);
  });

  it('avg_household_size rounds to 2 decimal places', () => {
    const f = makeFeature({ he_vakiy: 1000, te_taly: 333 });
    computeQuickWinMetrics([f]);
    // 1000/333 = 3.003003... → 3
    expect((f.properties as NeighborhoodProperties).avg_household_size).toBe(3);
  });

  it('single_parent_hh_pct uses te_taly denominator', () => {
    const f = makeFeature({
      he_vakiy: 5000,
      te_eil_np: 50,
      te_taly: 200,
    });
    computeQuickWinMetrics([f]);
    // 50/200 * 100 = 25%
    expect((f.properties as NeighborhoodProperties).single_parent_hh_pct).toBe(25);
  });

  it('tech_sector_pct and healthcare_workers_pct use tp_tyopy denominator', () => {
    const f = makeFeature({
      he_vakiy: 5000,
      tp_tyopy: 1000,
      tp_j_info: 150,
      tp_q_terv: 200,
    });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).tech_sector_pct).toBe(15);
    expect((f.properties as NeighborhoodProperties).healthcare_workers_pct).toBe(20);
  });

  it('new_construction_pct uses ra_asunn denominator', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      ra_raky: 5,
      ra_asunn: 500,
    });
    computeQuickWinMetrics([f]);
    // 5/500 * 100 = 1%
    expect((f.properties as NeighborhoodProperties).new_construction_pct).toBe(1);
  });

  it('processes multiple features independently', () => {
    const f1 = makeFeature({
      he_vakiy: 1000, he_naiset: 600, he_miehet: 400,
    });
    const f2 = makeFeature({
      pno: '00200', he_vakiy: 2000, he_naiset: 800, he_miehet: 1200,
    });
    computeQuickWinMetrics([f1, f2]);
    expect((f1.properties as NeighborhoodProperties).gender_ratio).toBe(1.5);
    expect((f2.properties as NeighborhoodProperties).gender_ratio).toBeCloseTo(0.67, 2);
  });
});
