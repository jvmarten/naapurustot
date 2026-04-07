/**
 * Priority 2: Metro averages computation — data transformation integrity
 *
 * Tests the most complex aggregation logic: population-weighted averages,
 * pctOfPop/pctOfHh conversions, and special ratio-based metrics.
 * A bug here silently corrupts every stat shown in the "All cities" view.
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics, parseTrendSeries } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', ...props } as NeighborhoodProperties,
  };
}

describe('computeMetroAverages — weighted aggregation', () => {
  it('population-weighted average income is correct', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000, pno: '00100' }),
      makeFeature({ he_vakiy: 3000, hr_mtu: 50000, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    // Weighted: (1000*30000 + 3000*50000) / 4000 = 45000
    expect(avg.hr_mtu).toBe(45000);
  });

  it('skips features with null or zero population', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 100000, pno: '00100' }),
      makeFeature({ he_vakiy: 0, hr_mtu: 100000, pno: '00200' }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 30000, pno: '00300' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('unemployment rate is computed from summed counts, not averaged percentages', () => {
    // Area A: 100 unemployed out of 1000 working-age = 10%
    // Area B: 50 unemployed out of 5000 working-age = 1%
    // Correct metro average: 150/6000 = 2.5%, NOT (10+1)/2 = 5.5%
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 1000, pno: '00100' }),
      makeFeature({ he_vakiy: 5000, pt_tyott: 50, pt_vakiy: 5000, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBe(2.5);
  });

  it('higher education rate uses degree holders / adult pop, not average of percentages', () => {
    // Area A: 200 higher ed out of 500 adults = 40%
    // Area B: 100 higher ed out of 1000 adults = 10%
    // Correct: 300/1500 = 20%, NOT (40+10)/2 = 25%
    const features = [
      makeFeature({ he_vakiy: 1000, ko_yl_kork: 100, ko_al_kork: 100, ko_ika18y: 500, pno: '00100' }),
      makeFeature({ he_vakiy: 2000, ko_yl_kork: 50, ko_al_kork: 50, ko_ika18y: 1000, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.higher_education_rate).toBe(20);
  });

  it('ownership rate uses counts / total households', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_omis_as: 400, te_taly: 500, pno: '00100' }),
      makeFeature({ he_vakiy: 1000, te_omis_as: 100, te_taly: 500, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    // 500/1000 = 50%
    expect(avg.ownership_rate).toBe(50);
  });

  it('pctOfPop metrics convert from pct to count and back correctly', () => {
    // foreign_language_pct is pctOfPop: accumulate (pct/100)*pop, divide by total pop, *100
    // Area A: pop=1000, foreign=10% → 100 people
    // Area B: pop=3000, foreign=20% → 600 people
    // Metro: 700/4000 = 17.5%
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10, pno: '00100' }),
      makeFeature({ he_vakiy: 3000, foreign_language_pct: 20, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBe(17.5);
  });

  it('pctOfHh metrics use household count as weight', () => {
    // single_person_hh_pct is pctOfHh
    // Area A: 200 households, 50% single = 100 single-person hh
    // Area B: 800 households, 25% single = 200 single-person hh
    // Metro: 300/1000 = 30%
    const features = [
      makeFeature({ he_vakiy: 500, te_taly: 200, single_person_hh_pct: 50, pno: '00100' }),
      makeFeature({ he_vakiy: 2000, te_taly: 800, single_person_hh_pct: 25, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBe(30);
  });

  it('population density uses total pop / total area', () => {
    // Area A: pop=1000, area=500000 m² = 0.5 km² → density 2000
    // Area B: pop=3000, area=1500000 m² = 1.5 km² → density 2000
    // Metro: 4000/2.0 = 2000
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: 500000, pno: '00100' }),
      makeFeature({ he_vakiy: 3000, pinta_ala: 1500000, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(2000);
  });

  it('requirePositive skips hr_mtu <= 0', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: -1, pno: '00100' }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 0, pno: '00200' }),
      makeFeature({ he_vakiy: 1000, hr_mtu: 40000, pno: '00300' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(40000);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, pno: '00100' }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
  });

  it('child_ratio sums he_0_2 and he_3_6 correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_0_2: 30, he_3_6: 50, pno: '00100' }),
      makeFeature({ he_vakiy: 1000, he_0_2: 20, he_3_6: 40, pno: '00200' }),
    ];
    const avg = computeMetroAverages(features);
    // (30+50+20+40) / 2000 * 100 = 7%
    expect(avg.child_ratio).toBe(7);
  });
});

describe('parseTrendSeries — input validation', () => {
  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2020,100],[2021,110],[2022,120]]');
    expect(result).toEqual([[2020, 100], [2021, 110], [2022, 120]]);
  });

  it('rejects arrays with fewer than 2 data points', () => {
    expect(parseTrendSeries('[[2020,100]]')).toBeNull();
  });

  it('rejects invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('rejects null/undefined/empty', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
    expect(parseTrendSeries('')).toBeNull();
  });

  it('rejects entries with non-numeric values', () => {
    expect(parseTrendSeries('[[2020,"abc"],[2021,110]]')).toBeNull();
  });

  it('rejects entries with NaN or Infinity', () => {
    expect(parseTrendSeries('[[2020,null],[2021,110]]')).toBeNull();
  });

  it('rejects entries with wrong tuple length', () => {
    expect(parseTrendSeries('[[2020,100,1],[2021,110,2]]')).toBeNull();
  });
});

describe('computeChangeMetrics — year-over-year changes', () => {
  it('computes percentage change from first to last data point', () => {
    const features = [
      makeFeature({
        pno: '00100',
        income_history: '[[2018,30000],[2019,31000],[2020,33000]]',
        population_history: '[[2018,1000],[2020,1100]]',
        unemployment_history: '[[2018,10],[2020,8]]',
      }),
    ];

    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    // Income: (33000-30000)/30000 * 100 = 10%
    expect(p.income_change_pct).toBeCloseTo(10, 1);
    // Population: (1100-1000)/1000 * 100 = 10%
    expect(p.population_change_pct).toBeCloseTo(10, 1);
    // Unemployment: (8-10)/10 * 100 = -20%
    expect(p.unemployment_change_pct).toBeCloseTo(-20, 1);
  });

  it('returns null when history is missing or too short', () => {
    const features = [
      makeFeature({ pno: '00100', income_history: null, population_history: '[[2020,1000]]' }),
    ];

    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [
      makeFeature({ pno: '00100', income_history: '[[2018,0],[2020,1000]]' }),
    ];

    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });
});

describe('computeQuickWinMetrics — derived demographic metrics', () => {
  it('computes youth ratio correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 80, pno: '00100' }),
    ];

    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50+100+80)/1000 * 100 = 23.0%
    expect(p.youth_ratio_pct).toBe(23.0);
  });

  it('computes gender ratio correctly', () => {
    const features = [
      makeFeature({ he_naiset: 520, he_miehet: 480, pno: '00100', he_vakiy: 1000 }),
    ];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBe(1.08);
  });

  it('handles division by zero (miehet=0) by not computing', () => {
    const features = [
      makeFeature({ he_naiset: 100, he_miehet: 0, pno: '00100', he_vakiy: 100 }),
    ];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeUndefined();
  });

  it('computes employment rate from employed/working-age', () => {
    const features = [
      makeFeature({ pt_tyoll: 700, pt_vakiy: 1000, he_vakiy: 1200, pno: '00100' }),
    ];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBe(70);
  });

  it('computes elderly ratio from sum of 65+ age groups', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10, pno: '00100' }),
    ];

    computeQuickWinMetrics(features);
    // (50+40+30+20+10)/1000 = 15%
    expect((features[0].properties as NeighborhoodProperties).elderly_ratio_pct).toBe(15);
  });

  it('skips metrics when required fields are null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: null, he_20_24: 100, he_25_29: 80, pno: '00100' }),
    ];

    computeQuickWinMetrics(features);
    // Missing he_18_19 should prevent youth_ratio computation
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('computes avg_household_size correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 2500, te_taly: 1000, pno: '00100' }),
    ];

    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBe(2.5);
  });
});
