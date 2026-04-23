import { describe, it, expect } from 'vitest';
import {
  computeQuickWinMetrics,
  computeChangeMetrics,
  computeMetroAverages,
  parseTrendSeries,
} from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeQuickWinMetrics — divide-by-zero safety', () => {
  it('does not compute youth_ratio when pop is 0', () => {
    const f = [makeFeature({ he_vakiy: 0, he_18_19: 10, he_20_24: 20, he_25_29: 30 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.youth_ratio_pct).toBeUndefined();
  });

  it('does not compute gender_ratio when miehet is 0', () => {
    const f = [makeFeature({ he_naiset: 100, he_miehet: 0 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.gender_ratio).toBeUndefined();
  });

  it('does not compute tech_sector when tp_tyopy is 0', () => {
    const f = [makeFeature({ tp_j_info: 10, tp_tyopy: 0 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.tech_sector_pct).toBeUndefined();
  });

  it('does not compute employment_rate when pt_vakiy is 0', () => {
    const f = [makeFeature({ pt_tyoll: 100, pt_vakiy: 0 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.employment_rate).toBeUndefined();
  });

  it('does not compute new_construction when ra_asunn is 0', () => {
    const f = [makeFeature({ ra_raky: 5, ra_asunn: 0 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.new_construction_pct).toBeUndefined();
  });
});

describe('computeQuickWinMetrics — precision and correctness', () => {
  it('computes youth_ratio_pct with one decimal place', () => {
    const f = [makeFeature({ he_vakiy: 1000, he_18_19: 30, he_20_24: 40, he_25_29: 50 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.youth_ratio_pct).toBe(12);
  });

  it('computes gender_ratio with two decimal places', () => {
    const f = [makeFeature({ he_naiset: 523, he_miehet: 477 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.gender_ratio).toBe(1.10);
  });

  it('computes elderly_ratio_pct from all 65+ age groups', () => {
    const f = [makeFeature({
      he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
    })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.elderly_ratio_pct).toBe(15);
  });

  it('computes avg_household_size correctly', () => {
    const f = [makeFeature({ he_vakiy: 2500, te_taly: 1000 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.avg_household_size).toBe(2.5);
  });

  it('skips metrics when any required field is null', () => {
    const f = [makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: null, he_25_29: 50 })];
    computeQuickWinMetrics(f);
    expect(f[0].properties!.youth_ratio_pct).toBeUndefined();
  });
});

describe('computeChangeMetrics — integration', () => {
  it('computes all three change metrics independently', () => {
    const f = [makeFeature({
      income_history: JSON.stringify([[2018, 30000], [2022, 33000]]),
      population_history: JSON.stringify([[2018, 1000], [2022, 1100]]),
      unemployment_history: JSON.stringify([[2018, 10], [2022, 8]]),
    })];
    computeChangeMetrics(f);
    expect(f[0].properties!.income_change_pct).toBe(10);
    expect(f[0].properties!.population_change_pct).toBe(10);
    expect(f[0].properties!.unemployment_change_pct).toBe(-20);
  });

  it('handles mixed null and valid histories', () => {
    const f = [makeFeature({
      income_history: JSON.stringify([[2018, 30000], [2022, 36000]]),
      population_history: null,
      unemployment_history: 'invalid json',
    })];
    computeChangeMetrics(f);
    expect(f[0].properties!.income_change_pct).toBe(20);
    expect(f[0].properties!.population_change_pct).toBeNull();
    expect(f[0].properties!.unemployment_change_pct).toBeNull();
  });
});

describe('parseTrendSeries — validation', () => {
  it('parses valid 2-element tuples', () => {
    const result = parseTrendSeries(JSON.stringify([[2015, 77777], [2016, 88888]]));
    expect(result).toEqual([[2015, 77777], [2016, 88888]]);
  });

  it('rejects tuples with more than 2 elements', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100, 200], [2021, 300, 400]]))).toBeNull();
  });

  it('handles undefined and empty string', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
    expect(parseTrendSeries('')).toBeNull();
  });
});

describe('computeMetroAverages — ratio metric correctness', () => {
  it('unemployment_rate from raw counts, not average of rates', () => {
    const f = [
      makeFeature({ he_vakiy: 100, pt_tyott: 5, pt_vakiy: 80 }),
      makeFeature({ he_vakiy: 900, pt_tyott: 45, pt_vakiy: 720 }),
    ];
    const avg = computeMetroAverages(f);
    expect(avg.unemployment_rate).toBe(6.3);
  });

  it('pctOfPop metrics weighted by population count', () => {
    const f = [
      makeFeature({ he_vakiy: 100, foreign_language_pct: 50 }),
      makeFeature({ he_vakiy: 900, foreign_language_pct: 10 }),
    ];
    const avg = computeMetroAverages(f);
    expect(avg.foreign_language_pct).toBe(14);
  });

  it('pctOfHh metrics weighted by household count', () => {
    const f = [
      makeFeature({ he_vakiy: 500, te_taly: 200, single_person_hh_pct: 60 }),
      makeFeature({ he_vakiy: 500, te_taly: 800, single_person_hh_pct: 40 }),
    ];
    const avg = computeMetroAverages(f);
    expect(avg.single_person_hh_pct).toBe(44);
  });

  it('requirePositive skips zero and negative values', () => {
    const f = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: -5000 }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(f);
    expect(avg.hr_mtu).toBe(40000);
  });
});
