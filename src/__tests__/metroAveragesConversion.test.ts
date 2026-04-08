/**
 * Tests for metro averages pctOfPop / pctOfHh conversion round-trip
 * and special ratio-based metric computation.
 *
 * This is high-risk because the data-driven metric system silently
 * converts percentages to counts and back. A bug here would produce
 * wildly incorrect averages shown prominently on the area summary panel.
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeQuickWinMetrics, computeChangeMetrics, parseTrendSeries } from '../utils/metrics';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city: 'helsinki_metro',
      he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('computeMetroAverages — pctOfPop conversion', () => {
  it('computes population-weighted average for pctOfPop metrics', () => {
    // Two areas: 10% foreign language (pop 1000) and 20% (pop 3000)
    // True average should be (100 + 600) / 4000 * 100 = 17.5%
    const features = [
      makeFeature({ he_vakiy: 1000, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 3000, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.foreign_language_pct).toBeCloseTo(17.5, 1);
  });

  it('does not naively average percentages (which would give wrong result)', () => {
    const features = [
      makeFeature({ he_vakiy: 100, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 900, foreign_language_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // Naive average would be (10 + 20) / 2 = 15
    // Correct is (10 + 180) / 1000 * 100 = 19
    expect(avg.foreign_language_pct).toBeCloseTo(19.0, 1);
    expect(avg.foreign_language_pct).not.toBeCloseTo(15.0, 0);
  });
});

describe('computeMetroAverages — pctOfHh conversion', () => {
  it('computes household-weighted average for pctOfHh metrics', () => {
    // single_person_hh_pct: 40% (100 hh) and 60% (300 hh)
    // True average = (40 + 180) / 400 * 100 = 55%
    const features = [
      makeFeature({ he_vakiy: 500, te_taly: 100, single_person_hh_pct: 40 }),
      makeFeature({ pno: '00200', he_vakiy: 800, te_taly: 300, single_person_hh_pct: 60 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.single_person_hh_pct).toBeCloseTo(55.0, 1);
  });
});

describe('computeMetroAverages — special ratio metrics', () => {
  it('computes unemployment_rate from raw counts not averaging rates', () => {
    // Area A: 10 unemployed out of 100 working-age = 10%
    // Area B: 5 unemployed out of 200 working-age = 2.5%
    // Metro: 15 / 300 = 5%
    const features = [
      makeFeature({ he_vakiy: 100, pt_tyott: 10, pt_vakiy: 100 }),
      makeFeature({ pno: '00200', he_vakiy: 200, pt_tyott: 5, pt_vakiy: 200 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.unemployment_rate).toBeCloseTo(5.0, 1);
  });

  it('computes higher_education_rate from raw counts', () => {
    // Area A: 30 university + 20 polytechnic out of 100 adults
    // Area B: 10 university + 5 polytechnic out of 50 adults
    // Metro: 65 / 150 = 43.3%
    const features = [
      makeFeature({ he_vakiy: 100, ko_yl_kork: 30, ko_al_kork: 20, ko_ika18y: 100 }),
      makeFeature({ pno: '00200', he_vakiy: 50, ko_yl_kork: 10, ko_al_kork: 5, ko_ika18y: 50 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.higher_education_rate).toBeCloseTo(43.3, 1);
  });

  it('computes population_density from total pop and area', () => {
    // Area A: 1000 people, 1_000_000 m² = 1 km²
    // Area B: 2000 people, 4_000_000 m² = 4 km²
    // Metro: 3000 / 5 = 600 /km²
    const features = [
      makeFeature({ he_vakiy: 1000, pinta_ala: 1_000_000 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, pinta_ala: 4_000_000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(600);
  });

  it('skips features with zero or null population', () => {
    const features = [
      makeFeature({ he_vakiy: 0, hr_mtu: 99999 }),
      makeFeature({ pno: '00200', he_vakiy: null as unknown as number, hr_mtu: 99999 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.he_vakiy).toBe(1000);
  });

  it('returns 0 for metrics with no valid data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000 }),
    ];
    const avg = computeMetroAverages(features);
    // hr_mtu requires positive, and we didn't set it
    expect(avg.hr_mtu).toBe(0);
  });
});

describe('computeChangeMetrics', () => {
  it('computes percentage change from first to last data point', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2018, 25000], [2019, 26000], [2020, 27500]]),
        population_history: JSON.stringify([[2018, 1000], [2020, 1100]]),
        unemployment_history: JSON.stringify([[2018, 10], [2020, 8]]),
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // Income: (27500 - 25000) / 25000 * 100 = 10%
    expect(p.income_change_pct).toBeCloseTo(10, 1);
    // Population: (1100 - 1000) / 1000 * 100 = 10%
    expect(p.population_change_pct).toBeCloseTo(10, 1);
    // Unemployment: (8 - 10) / 10 * 100 = -20%
    expect(p.unemployment_change_pct).toBeCloseTo(-20, 1);
  });

  it('returns null for missing or too-short series', () => {
    const features = [
      makeFeature({
        income_history: null,
        population_history: JSON.stringify([[2020, 1000]]), // Only 1 point
        unemployment_history: 'invalid json',
      }),
    ];
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2018, 0], [2020, 5000]]),
      }),
    ];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative first values correctly', () => {
    // Uses Math.abs(first) in denominator, so -100 → 0 should give 100%
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2018, -100], [2020, 0]]),
      }),
    ];
    computeChangeMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).income_change_pct).toBeCloseTo(100, 1);
  });
});

describe('parseTrendSeries', () => {
  it('parses valid JSON array of [year, value] pairs', () => {
    const result = parseTrendSeries('[[2018,100],[2019,200]]');
    expect(result).toEqual([[2018, 100], [2019, 200]]);
  });

  it('returns null for arrays with fewer than 2 points', () => {
    expect(parseTrendSeries('[[2018,100]]')).toBeNull();
    expect(parseTrendSeries('[]')).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseTrendSeries('{"year": 2020}')).toBeNull();
  });

  it('returns null for arrays with non-numeric values', () => {
    expect(parseTrendSeries('[["2018",100],["2019",200]]')).toBeNull();
  });

  it('returns null for arrays with Infinity or NaN', () => {
    expect(parseTrendSeries('[[2018,Infinity],[2019,200]]')).toBeNull();
  });

  it('returns null for null/undefined/empty input', () => {
    expect(parseTrendSeries(null)).toBeNull();
    expect(parseTrendSeries(undefined)).toBeNull();
    expect(parseTrendSeries('')).toBeNull();
  });

  it('handles already-parsed arrays (non-string input)', () => {
    // The function handles the case where raw is already parsed
    const arr = [[2018, 100], [2019, 200]];
    const result = parseTrendSeries(arr as unknown as string);
    expect(result).toEqual([[2018, 100], [2019, 200]]);
  });
});

describe('computeQuickWinMetrics', () => {
  it('computes youth_ratio_pct from age group fields', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: 50, he_20_24: 100, he_25_29: 100 }),
    ];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;
    // (50+100+100) / 1000 * 100 = 25.0
    expect(p.youth_ratio_pct).toBeCloseTo(25.0, 1);
  });

  it('computes gender_ratio correctly', () => {
    const features = [
      makeFeature({ he_naiset: 510, he_miehet: 490 }),
    ];
    computeQuickWinMetrics(features);
    // 510/490 = 1.04
    expect((features[0].properties as NeighborhoodProperties).gender_ratio).toBeCloseTo(1.04, 2);
  });

  it('computes employment_rate from working-age population', () => {
    const features = [
      makeFeature({ pt_tyoll: 400, pt_vakiy: 500 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).employment_rate).toBeCloseTo(80.0, 1);
  });

  it('computes elderly_ratio_pct from 65+ age groups', () => {
    const features = [
      makeFeature({
        he_vakiy: 1000,
        he_65_69: 50, he_70_74: 40, he_75_79: 30, he_80_84: 20, he_85_: 10,
      }),
    ];
    computeQuickWinMetrics(features);
    // (50+40+30+20+10) / 1000 * 100 = 15.0
    expect((features[0].properties as NeighborhoodProperties).elderly_ratio_pct).toBeCloseTo(15.0, 1);
  });

  it('skips computation when required fields are null', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, he_18_19: null as unknown as number }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('skips computation when population is zero', () => {
    const features = [
      makeFeature({ he_vakiy: 0, he_18_19: 50, he_20_24: 100, he_25_29: 100 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).youth_ratio_pct).toBeUndefined();
  });

  it('computes new_construction_pct from buildings', () => {
    const features = [
      makeFeature({ ra_raky: 5, ra_asunn: 100 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).new_construction_pct).toBeCloseTo(5.0, 1);
  });

  it('computes avg_household_size correctly', () => {
    const features = [
      makeFeature({ he_vakiy: 2400, te_taly: 1000 }),
    ];
    computeQuickWinMetrics(features);
    expect((features[0].properties as NeighborhoodProperties).avg_household_size).toBe(2.4);
  });
});
