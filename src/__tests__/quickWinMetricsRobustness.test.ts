import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: null,
      he_vakiy: null,
      he_18_19: null, he_20_24: null, he_25_29: null,
      he_naiset: null, he_miehet: null,
      te_eil_np: null, te_taly: null, te_laps: null,
      tp_tyopy: null, tp_j_info: null, tp_q_terv: null,
      pt_tyoll: null, pt_vakiy: null,
      he_65_69: null, he_70_74: null, he_75_79: null, he_80_84: null, he_85_: null,
      tp_jalo_bf: null, tp_o_julk: null, tp_palv_gu: null,
      ra_raky: null, ra_asunn: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('computeQuickWinMetrics', () => {
  it('computes youth_ratio_pct correctly', () => {
    const f = makeFeature({
      he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 150,
    });
    computeQuickWinMetrics([f]);
    // (50+100+150)/1000 * 100 = 30%, rounded to 1 decimal
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBe(30.0);
  });

  it('skips youth_ratio when population is 0', () => {
    const f = makeFeature({
      he_vakiy: 0, he_18_19: 50, he_20_24: 100, he_25_29: 150,
    });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('computes gender_ratio correctly', () => {
    const f = makeFeature({ he_naiset: 520, he_miehet: 480 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).gender_ratio).toBe(1.08);
  });

  it('skips gender_ratio when miehet is 0', () => {
    const f = makeFeature({ he_naiset: 100, he_miehet: 0 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('computes single_parent_hh_pct correctly', () => {
    const f = makeFeature({ te_eil_np: 50, te_taly: 200 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).single_parent_hh_pct).toBe(25.0);
  });

  it('computes families_with_children_pct correctly', () => {
    const f = makeFeature({ te_laps: 80, te_taly: 400 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).families_with_children_pct).toBe(20.0);
  });

  it('computes tech_sector_pct correctly', () => {
    const f = makeFeature({ tp_j_info: 30, tp_tyopy: 300 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).tech_sector_pct).toBe(10.0);
  });

  it('computes employment_rate correctly', () => {
    const f = makeFeature({ pt_tyoll: 400, pt_vakiy: 500 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).employment_rate).toBe(80.0);
  });

  it('computes elderly_ratio_pct correctly (sum of all 65+ groups)', () => {
    const f = makeFeature({
      he_vakiy: 1000,
      he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
    });
    computeQuickWinMetrics([f]);
    // (50+40+30+20+10)/1000 = 15.0%
    expect((f.properties as NeighborhoodProperties).elderly_ratio_pct).toBe(15.0);
  });

  it('computes avg_household_size correctly', () => {
    const f = makeFeature({ he_vakiy: 2400, te_taly: 1000 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).avg_household_size).toBe(2.4);
  });

  it('computes manufacturing_jobs_pct correctly', () => {
    const f = makeFeature({ tp_jalo_bf: 75, tp_tyopy: 500 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).manufacturing_jobs_pct).toBe(15.0);
  });

  it('computes new_construction_pct correctly', () => {
    const f = makeFeature({ ra_raky: 5, ra_asunn: 200 });
    computeQuickWinMetrics([f]);
    expect((f.properties as NeighborhoodProperties).new_construction_pct).toBe(2.5);
  });

  it('skips all metrics when all source fields are null', () => {
    const f = makeFeature({});
    computeQuickWinMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.gender_ratio).toBeUndefined();
    expect(p.employment_rate).toBeUndefined();
    expect(p.elderly_ratio_pct).toBeUndefined();
  });

  it('handles multiple features independently', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 100, he_20_24: 100, he_25_29: 100 }),
      makeFeature({ he_vakiy: 2000, he_18_19: 50, he_20_24: 50, he_25_29: 50 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBe(30.0);
    expect((features[1].properties as NeighborhoodProperties).youth_ratio_pct).toBe(7.5);
  });
});
