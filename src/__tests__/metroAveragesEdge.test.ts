/**
 * Tests for computeMetroAverages edge cases and correctness.
 *
 * This function is the single source of metro-wide averages displayed in the
 * comparison panel and neighborhood panel. Getting the weighting wrong means
 * every "+/- vs metro" indicator in the UI is wrong.
 *
 * Focus areas:
 * - Population vs household weighting
 * - pctOfPop and pctOfHh conversion (accumulate count, not pct)
 * - Zero/null population features are excluded
 * - Special ratio-based metrics (unemployment_rate, ownership_rate, etc.)
 * - employment_rate special handling
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeQuickWinMetrics, computeChangeMetrics } from '../utils/metrics';

function makeFeature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', ...props },
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('computeMetroAverages — population weighting', () => {
  it('weights income by population correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, hr_mtu: 40000 }),
      makeFeature({ pno: '00200', he_vakiy: 10000, hr_mtu: 20000 }),
    ];

    const avg = computeMetroAverages(features);
    // (40000*10000 + 20000*10000) / 20000 = 30000
    expect(avg.hr_mtu).toBe(30000);
  });

  it('population-weighted average skews toward larger neighborhoods', () => {
    const features = [
      makeFeature({ he_vakiy: 90000, hr_mtu: 40000 }),
      makeFeature({ pno: '00200', he_vakiy: 10000, hr_mtu: 20000 }),
    ];

    const avg = computeMetroAverages(features);
    // (40000*90000 + 20000*10000) / 100000 = 38000
    expect(avg.hr_mtu).toBe(38000);
  });
});

describe('computeMetroAverages — pctOfPop conversion', () => {
  it('foreign_language_pct is converted from pct to count then back to pct', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, foreign_language_pct: 20 }), // 2000 foreign speakers
      makeFeature({ pno: '00200', he_vakiy: 10000, foreign_language_pct: 10 }), // 1000 foreign speakers
    ];

    const avg = computeMetroAverages(features);
    // Total foreign: 2000 + 1000 = 3000 out of 20000 = 15%
    expect(avg.foreign_language_pct).toBe(15);
  });

  it('pctOfPop handles unequal populations correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 50 }), // 500 speakers
      makeFeature({ pno: '00200', he_vakiy: 9000, foreign_language_pct: 10 }), // 900 speakers
    ];

    const avg = computeMetroAverages(features);
    // Total: (500 + 900) / 10000 = 14%
    expect(avg.foreign_language_pct).toBe(14);
  });
});

describe('computeMetroAverages — pctOfHh conversion', () => {
  it('single_person_hh_pct is weighted by household count', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, te_taly: 3000, single_person_hh_pct: 60 }), // 1800 single
      makeFeature({ pno: '00200', he_vakiy: 5000, te_taly: 2000, single_person_hh_pct: 20 }), // 400 single
    ];

    const avg = computeMetroAverages(features);
    // Total: (1800 + 400) / 5000 = 44%
    expect(avg.single_person_hh_pct).toBe(44);
  });
});

describe('computeMetroAverages — special ratio metrics', () => {
  it('unemployment_rate computed from raw counts, not averaged pcts', () => {
    const features = [
      makeFeature({
        he_vakiy: 10000, pt_vakiy: 8000, pt_tyott: 400, // 5%
      }),
      makeFeature({
        pno: '00200', he_vakiy: 10000, pt_vakiy: 8000, pt_tyott: 800, // 10%
      }),
    ];

    const avg = computeMetroAverages(features);
    // Total: 1200 / 16000 = 7.5%
    expect(avg.unemployment_rate).toBe(7.5);
  });

  it('higher_education_rate uses ko_yl_kork + ko_al_kork over ko_ika18y', () => {
    const features = [
      makeFeature({
        he_vakiy: 10000, ko_ika18y: 8000, ko_yl_kork: 2000, ko_al_kork: 1000,
      }),
      makeFeature({
        pno: '00200', he_vakiy: 10000, ko_ika18y: 8000, ko_yl_kork: 1000, ko_al_kork: 500,
      }),
    ];

    const avg = computeMetroAverages(features);
    // Total: (2000+1000+1000+500) / 16000 = 4500/16000 = 28.1%
    expect(avg.higher_education_rate).toBeCloseTo(28.1, 1);
  });

  it('ownership_rate uses te_omis_as over te_taly', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, te_taly: 3000, te_omis_as: 1500 }),
      makeFeature({ pno: '00200', he_vakiy: 5000, te_taly: 2000, te_omis_as: 1000 }),
    ];

    const avg = computeMetroAverages(features);
    // Total: 2500 / 5000 = 50%
    expect(avg.ownership_rate).toBe(50);
  });

  it('population_density uses total pop / total area in km²', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pinta_ala: 2_000_000 }), // 2 km²
      makeFeature({ pno: '00200', he_vakiy: 10000, pinta_ala: 3_000_000 }), // 3 km²
    ];

    const avg = computeMetroAverages(features);
    // 20000 pop / 5 km² = 4000/km²
    expect(avg.population_density).toBe(4000);
  });

  it('employment_rate uses pt_tyoll over pt_vakiy', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pt_vakiy: 8000, pt_tyoll: 6000 }),
      makeFeature({ pno: '00200', he_vakiy: 10000, pt_vakiy: 8000, pt_tyoll: 4000 }),
    ];

    const avg = computeMetroAverages(features);
    // Total: 10000/16000 = 62.5%
    expect(avg.employment_rate).toBe(62.5);
  });
});

describe('computeMetroAverages — exclusion conditions', () => {
  it('skips features with null population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: 5000, hr_mtu: 30000 }),
    ];

    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000); // only the valid feature counts
  });

  it('skips features with zero population', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: 5000, hr_mtu: 30000 }),
    ];

    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
  });

  it('skips requirePositive metrics when value <= 0', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, hr_mtu: -5000 }), // negative income
      makeFeature({ pno: '00200', he_vakiy: 5000, hr_mtu: 30000 }),
    ];

    const avg = computeMetroAverages(features);
    // Only the positive value counts
    expect(avg.hr_mtu).toBe(30000);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, hr_mtu: null }),
    ];

    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });
});

describe('computeMetroAverages — returns total population', () => {
  it('he_vakiy in averages is total population, not average', () => {
    const features = [
      makeFeature({ he_vakiy: 5000 }),
      makeFeature({ pno: '00200', he_vakiy: 3000 }),
    ];

    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(8000);
  });
});

describe('computeMetroAverages — child_ratio uses he_0_2 + he_3_6', () => {
  it('computes child ratio from age buckets', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, he_0_2: 300, he_3_6: 200 }), // 500 children
      makeFeature({ pno: '00200', he_vakiy: 10000, he_0_2: 500, he_3_6: 500 }), // 1000 children
    ];

    const avg = computeMetroAverages(features);
    // 1500 / 20000 = 7.5%
    expect(avg.child_ratio).toBe(7.5);
  });
});

describe('computeMetroAverages — pensioner_share', () => {
  it('computes from pt_elakel / total pop', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pt_elakel: 2000 }),
      makeFeature({ pno: '00200', he_vakiy: 10000, pt_elakel: 3000 }),
    ];

    const avg = computeMetroAverages(features);
    // 5000/20000 = 25%
    expect(avg.pensioner_share).toBe(25);
  });
});
