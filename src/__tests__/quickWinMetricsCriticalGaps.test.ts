import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeQuickWinMetrics — rounding precision', () => {
  it('youth_ratio_pct rounds to 1 decimal', () => {
    const features = [
      makeFeature({ he_vakiy: 3, he_18_19: 1, he_20_24: 0, he_25_29: 0 }),
    ];
    computeQuickWinMetrics(features);
    // 1/3 * 100 = 33.3333... → rounds to 33.3
    expect(features[0].properties!.youth_ratio_pct).toBe(33.3);
  });

  it('gender_ratio rounds to 2 decimals', () => {
    const features = [
      makeFeature({ he_naiset: 1, he_miehet: 3 }),
    ];
    computeQuickWinMetrics(features);
    // 1/3 = 0.3333... → rounds to 0.33
    expect(features[0].properties!.gender_ratio).toBe(0.33);
  });

  it('avg_household_size rounds to 2 decimals', () => {
    const features = [
      makeFeature({ he_vakiy: 10, te_taly: 3 }),
    ];
    computeQuickWinMetrics(features);
    // 10/3 = 3.3333... → rounds to 3.33
    expect(features[0].properties!.avg_household_size).toBe(3.33);
  });
});

describe('computeQuickWinMetrics — null propagation', () => {
  it('does not set youth_ratio_pct when population is null', () => {
    const features = [
      makeFeature({ he_vakiy: null, he_18_19: 10, he_20_24: 10, he_25_29: 10 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not set youth_ratio_pct when population is zero', () => {
    const features = [
      makeFeature({ he_vakiy: 0, he_18_19: 0, he_20_24: 0, he_25_29: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not set gender_ratio when he_miehet is zero', () => {
    const features = [
      makeFeature({ he_naiset: 100, he_miehet: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.gender_ratio).toBeUndefined();
  });

  it('does not set employment_rate when working-age pop is zero', () => {
    const features = [
      makeFeature({ pt_tyoll: 100, pt_vakiy: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.employment_rate).toBeUndefined();
  });

  it('does not set elderly_ratio_pct when any age group is null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: null, he_80_84: 20, he_85_: 10 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.elderly_ratio_pct).toBeUndefined();
  });

  it('sets elderly_ratio_pct when all age groups present', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10 }),
    ];
    computeQuickWinMetrics(features);
    // (50+40+30+20+10)/1000 * 100 = 15.0
    expect(features[0].properties!.elderly_ratio_pct).toBe(15);
  });
});

describe('computeQuickWinMetrics — job sector percentages', () => {
  it('tech_sector_pct correct with valid data', () => {
    const features = [
      makeFeature({ tp_j_info: 25, tp_tyopy: 100 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.tech_sector_pct).toBe(25);
  });

  it('does not set sector pcts when total jobs is zero', () => {
    const features = [
      makeFeature({ tp_j_info: 0, tp_q_terv: 0, tp_jalo_bf: 0, tp_o_julk: 0, tp_palv_gu: 0, tp_tyopy: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.tech_sector_pct).toBeUndefined();
    expect(features[0].properties!.healthcare_workers_pct).toBeUndefined();
    expect(features[0].properties!.manufacturing_jobs_pct).toBeUndefined();
    expect(features[0].properties!.public_sector_jobs_pct).toBeUndefined();
    expect(features[0].properties!.service_sector_jobs_pct).toBeUndefined();
  });

  it('new_construction_pct correct', () => {
    const features = [
      makeFeature({ ra_raky: 5, ra_asunn: 200 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.new_construction_pct).toBe(2.5);
  });
});

describe('computeQuickWinMetrics — micro-population edge cases', () => {
  it('handles population of 1 correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1, he_18_19: 1, he_20_24: 0, he_25_29: 0 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.youth_ratio_pct).toBe(100);
  });

  it('single-parent hh pct with 1 household', () => {
    const features = [
      makeFeature({ te_eil_np: 1, te_taly: 1 }),
    ];
    computeQuickWinMetrics(features);
    expect(features[0].properties!.single_parent_hh_pct).toBe(100);
  });
});
