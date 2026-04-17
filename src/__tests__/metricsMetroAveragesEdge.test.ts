import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics, parseTrendSeries } from '../utils/metrics';

function makeFeature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('computeMetroAverages — ratio-based metrics', () => {
  it('computes unemployment_rate from raw counts, not averaging percentages', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 500, pt_tyoll: 400, hr_mtu: 30000, ko_ika18y: 800, ko_yl_kork: 200, ko_al_kork: 100, te_taly: 400, te_omis_as: 200, te_vuok_as: 150, pinta_ala: 1_000_000, he_0_2: 10, he_3_6: 15, ra_asunn: 500, ra_pt_as: 50, pt_opisk: 50, pt_elakel: 100 }),
      makeFeature({ he_vakiy: 3000, pt_tyott: 600, pt_vakiy: 2000, pt_tyoll: 1400, hr_mtu: 40000, ko_ika18y: 2400, ko_yl_kork: 600, ko_al_kork: 400, te_taly: 1200, te_omis_as: 600, te_vuok_as: 500, pinta_ala: 3_000_000, he_0_2: 50, he_3_6: 70, ra_asunn: 1500, ra_pt_as: 200, pt_opisk: 200, pt_elakel: 400 }),
    ];
    const avg = computeMetroAverages(features);

    expect(avg.unemployment_rate).toBeCloseTo((700 / 2500) * 100, 0);
  });

  it('computes population-weighted income average', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 20000, pt_vakiy: 800, pt_tyoll: 600, pt_tyott: 100, ko_ika18y: 800, ko_yl_kork: 200, ko_al_kork: 100, te_taly: 400, te_omis_as: 200, te_vuok_as: 150, pinta_ala: 1_000_000, he_0_2: 10, he_3_6: 15, ra_asunn: 500, ra_pt_as: 50, pt_opisk: 50, pt_elakel: 100 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 40000, pt_vakiy: 2000, pt_tyoll: 1400, pt_tyott: 200, ko_ika18y: 2400, ko_yl_kork: 800, ko_al_kork: 400, te_taly: 1200, te_omis_as: 600, te_vuok_as: 500, pinta_ala: 3_000_000, he_0_2: 50, he_3_6: 70, ra_asunn: 1500, ra_pt_as: 200, pt_opisk: 200, pt_elakel: 400 }),
    ];
    const avg = computeMetroAverages(features);

    expect(avg.hr_mtu).toBe(35000);
  });

  it('handles all-zero denominators gracefully', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 30000, pt_vakiy: 0, pt_tyoll: 0, pt_tyott: 0, ko_ika18y: 0, ko_yl_kork: 0, ko_al_kork: 0, te_taly: 0, te_omis_as: 0, te_vuok_as: 0, pinta_ala: 0, he_0_2: 0, he_3_6: 0, ra_asunn: 0, ra_pt_as: 0, pt_opisk: 0, pt_elakel: 0 }),
    ];
    const avg = computeMetroAverages(features);

    expect(avg.unemployment_rate).toBe(0);
    expect(avg.population_density).toBe(0);
    expect(avg.child_ratio).toBe(0);
    expect(avg.ownership_rate).toBe(0);
  });

  it('computes total population as sum', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, hr_mtu: 30000, pt_vakiy: 3000, pt_tyoll: 2000, pt_tyott: 200, ko_ika18y: 4000, ko_yl_kork: 1000, ko_al_kork: 500, te_taly: 2500, te_omis_as: 1000, te_vuok_as: 1200, pinta_ala: 2_000_000, he_0_2: 100, he_3_6: 150, ra_asunn: 2000, ra_pt_as: 300, pt_opisk: 300, pt_elakel: 500 }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 25000, pt_vakiy: 2000, pt_tyoll: 1500, pt_tyott: 150, ko_ika18y: 2400, ko_yl_kork: 600, ko_al_kork: 400, te_taly: 1200, te_omis_as: 600, te_vuok_as: 500, pinta_ala: 1_500_000, he_0_2: 80, he_3_6: 100, ra_asunn: 1200, ra_pt_as: 150, pt_opisk: 150, pt_elakel: 300 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(8000);
  });

  it('skips features with null population for weighted metrics', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 50000, pt_vakiy: 1000, pt_tyoll: 800, pt_tyott: 100, ko_ika18y: 800, ko_yl_kork: 300, ko_al_kork: 200, te_taly: 400, te_omis_as: 200, te_vuok_as: 150, pinta_ala: 1_000_000, he_0_2: 10, he_3_6: 15, ra_asunn: 500, ra_pt_as: 50, pt_opisk: 50, pt_elakel: 100 }),
      makeFeature({ he_vakiy: 4000, hr_mtu: 30000, pt_vakiy: 3000, pt_tyoll: 2000, pt_tyott: 300, ko_ika18y: 3200, ko_yl_kork: 800, ko_al_kork: 500, te_taly: 1600, te_omis_as: 800, te_vuok_as: 600, pinta_ala: 2_000_000, he_0_2: 80, he_3_6: 120, ra_asunn: 1600, ra_pt_as: 200, pt_opisk: 200, pt_elakel: 400 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(4000);
  });
});

describe('computeChangeMetrics — trend parsing', () => {
  it('computes change from first to last year in series', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2019, 30000], [2020, 33000], [2021, 36000]]),
        population_history: JSON.stringify([[2019, 4000], [2020, 4200], [2021, 4400]]),
        unemployment_history: JSON.stringify([[2019, 10], [2020, 9], [2021, 8]]),
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as Record<string, unknown>;

    expect(p.income_change_pct).toBeCloseTo(20, 0);
    expect(p.population_change_pct).toBeCloseTo(10, 0);
    expect(p.unemployment_change_pct).toBeCloseTo(-20, 0);
  });

  it('handles null history gracefully', () => {
    const features = [
      makeFeature({
        income_history: null,
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as Record<string, unknown>;

    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('handles single-entry series (no change computable)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2021, 30000]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as Record<string, unknown>;
    expect(p.income_change_pct).toBeNull();
  });

  it('handles zero base value in change calculation', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2019, 0], [2021, 10000]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as Record<string, unknown>;
    expect(p.income_change_pct).toBeNull();
  });
});

describe('parseTrendSeries', () => {
  it('parses valid JSON array of [year, value] tuples', () => {
    const result = parseTrendSeries('[[2019,100],[2020,200]]');
    expect(result).toEqual([[2019, 100], [2020, 200]]);
  });

  it('returns null for null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('{invalid}')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseTrendSeries('{"key": "value"}')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(parseTrendSeries('[]')).toBeNull();
  });

  it('handles series that is already parsed (array input)', () => {
    const input = [[2019, 100], [2020, 200]] as [number, number][];
    const result = parseTrendSeries(input as unknown as string);
    expect(result).toEqual([[2019, 100], [2020, 200]]);
  });
});

describe('computeQuickWinMetrics — edge cases', () => {
  it('handles zero population (avoids division by zero)', () => {
    const features = [
      makeFeature({
        he_vakiy: 0, he_naiset: 0, he_miehet: 0,
        he_18_19: 0, he_20_24: 0, he_25_29: 0,
        he_65_69: 0, he_70_74: 0, he_75_79: 0, he_80_84: 0, he_85_: 0,
        te_eil_np: 0, te_laps: 0, te_taly: 0,
        pt_tyoll: 0, pt_vakiy: 0,
        tp_tyopy: 0, tp_j_info: 0, tp_q_terv: 0,
        tp_jalo_bf: 0, tp_o_julk: 0, tp_palv_gu: 0,
        ra_raky: 0, ra_asunn: 0, ra_pt_as: 0,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as Record<string, unknown>;

    // When population is 0, the guard conditions (pop > 0) prevent the computation,
    // so properties remain undefined (never assigned)
    expect(p.youth_ratio_pct).toBeUndefined();
    expect(p.gender_ratio).toBeUndefined();
    expect(p.elderly_ratio_pct).toBeUndefined();
  });

  it('computes avg_household_size correctly', () => {
    const features = [
      makeFeature({
        he_vakiy: 10000, te_taly: 5000,
        he_naiset: 5200, he_miehet: 4800,
        he_18_19: 200, he_20_24: 400, he_25_29: 500,
        he_65_69: 300, he_70_74: 200, he_75_79: 100, he_80_84: 50, he_85_: 30,
        te_eil_np: 100, te_laps: 800,
        pt_tyoll: 4000, pt_vakiy: 6000,
        tp_tyopy: 2000, tp_j_info: 200, tp_q_terv: 300,
        tp_jalo_bf: 400, tp_o_julk: 100, tp_palv_gu: 500,
        ra_raky: 100, ra_asunn: 5500, ra_pt_as: 500,
      }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as Record<string, unknown>;
    expect(p.avg_household_size).toBeCloseTo(2.0, 1);
  });
});
