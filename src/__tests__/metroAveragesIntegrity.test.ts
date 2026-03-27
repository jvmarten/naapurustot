import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeChangeMetrics, parseTrendSeries } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

describe('computeMetroAverages — weighted averaging correctness', () => {
  it('population-weighted income gives more weight to larger areas', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, hr_mtu: 30000 }), // big area, low income
      makeFeature({ pno: '00200', he_vakiy: 100, hr_mtu: 80000 }), // tiny area, high income
    ];
    const avg = computeMetroAverages(features);
    // Should be close to 30000 (weighted heavily toward the 10k pop area)
    expect(avg.hr_mtu).toBeGreaterThan(30000);
    expect(avg.hr_mtu).toBeLessThan(35000);
  });

  it('unemployment_rate computed from raw counts, not averaged percentages', () => {
    // Area A: 1000 people, 10% unemployment → 100 unemployed from 1000 working-age
    // Area B: 100 people, 50% unemployment → 50 unemployed from 100 working-age
    const features = [
      makeFeature({ he_vakiy: 1000, pt_tyott: 100, pt_vakiy: 1000 }),
      makeFeature({ pno: '00200', he_vakiy: 100, pt_tyott: 50, pt_vakiy: 100 }),
    ];
    const avg = computeMetroAverages(features);
    // Correct: 150/1100 = 13.6%, NOT naive average (10+50)/2 = 30%
    expect(avg.unemployment_rate).toBeCloseTo(13.6, 1);
  });

  it('higher_education_rate sums both degree types', () => {
    const features = [
      makeFeature({ he_vakiy: 500, ko_ika18y: 400, ko_yl_kork: 100, ko_al_kork: 80 }),
      makeFeature({ pno: '00200', he_vakiy: 500, ko_ika18y: 400, ko_yl_kork: 50, ko_al_kork: 50 }),
    ];
    const avg = computeMetroAverages(features);
    // Total higher ed: 280, total adult: 800 → 35%
    expect(avg.higher_education_rate).toBeCloseTo(35, 1);
  });

  it('pctOfPop metrics avoid naive percentage averaging', () => {
    // foreign_language_pct: 10% in 10k pop area vs 50% in 100 pop area
    const features = [
      makeFeature({ he_vakiy: 10000, foreign_language_pct: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 100, foreign_language_pct: 50 }),
    ];
    const avg = computeMetroAverages(features);
    // Correct: (1000 + 50) / (10000 + 100) * 100 ≈ 10.4%
    // NOT naive (10 + 50) / 2 = 30%
    expect(avg.foreign_language_pct).toBeCloseTo(10.4, 0);
  });

  it('pctOfHh metrics use household weight, not population', () => {
    const features = [
      makeFeature({ he_vakiy: 5000, te_taly: 2000, single_person_hh_pct: 60 }),
      makeFeature({ pno: '00200', he_vakiy: 5000, te_taly: 500, single_person_hh_pct: 20 }),
    ];
    const avg = computeMetroAverages(features);
    // Correct: (1200 + 100) / (2000 + 500) * 100 = 52%
    expect(avg.single_person_hh_pct).toBeCloseTo(52, 0);
  });

  it('handles features where te_taly is null for pctOfHh metrics', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, te_taly: null, single_person_hh_pct: 40 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, te_taly: 500, single_person_hh_pct: 30 }),
    ];
    const avg = computeMetroAverages(features);
    // First feature's te_taly is null → w=0 → skipped for pctOfHh
    // Only second contributes: (150/500)*100 = 30%
    expect(avg.single_person_hh_pct).toBeCloseTo(30, 1);
  });

  it('requirePositive excludes zero and negative income values', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, hr_mtu: 0 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: -5000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const avg = computeMetroAverages(features);
    // Only the 30000 feature counts
    expect(avg.hr_mtu).toBe(30000);
  });

  it('population_density uses correct m² to km² conversion', () => {
    const features = [
      makeFeature({ he_vakiy: 10000, pinta_ala: 5_000_000 }), // 5 km²
    ];
    const avg = computeMetroAverages(features);
    expect(avg.population_density).toBe(2000); // 10000 / 5
  });

  it('all null population → all zeros', () => {
    const features = [
      makeFeature({ he_vakiy: null, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: null, hr_mtu: 40000 }),
    ];
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBe(0);
    expect(avg.he_vakiy).toBe(0);
  });
});

describe('computeChangeMetrics — trend percentage calculations', () => {
  it('computes positive change correctly', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2020, 30000], [2023, 36000]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(20, 1);
  });

  it('computes negative change correctly', () => {
    const f = makeFeature({
      population_history: JSON.stringify([[2018, 5000], [2023, 4000]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.population_change_pct).toBeCloseTo(-20, 1);
  });

  it('returns null when first value is 0 (division by zero)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2020, 0], [2023, 5000]]),
    });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('handles negative base value using Math.abs', () => {
    const f = makeFeature({
      unemployment_history: JSON.stringify([[2020, -10], [2023, -5]]),
    });
    computeChangeMetrics([f]);
    // Change: (-5 - (-10)) / abs(-10) * 100 = 50%
    expect((f.properties as NeighborhoodProperties).unemployment_change_pct).toBeCloseTo(50, 1);
  });

  it('returns null for single data point', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2023, 30000]]),
    });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('returns null for null history', () => {
    const f = makeFeature({ income_history: null });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    const f = makeFeature({ income_history: 'not json' });
    computeChangeMetrics([f]);
    expect((f.properties as NeighborhoodProperties).income_change_pct).toBeNull();
  });
});

describe('parseTrendSeries — validation', () => {
  it('rejects non-array JSON', () => {
    expect(parseTrendSeries('{"a": 1}')).toBeNull();
  });

  it('rejects array with non-pair elements', () => {
    expect(parseTrendSeries('[[2020, 100, "extra"]]')).toBeNull();
  });

  it('rejects array with string values', () => {
    expect(parseTrendSeries('[[2020, "abc"], [2021, 200]]')).toBeNull();
  });

  it('rejects single-element array (needs >= 2)', () => {
    expect(parseTrendSeries('[[2020, 100]]')).toBeNull();
  });

  it('accepts valid 2+ element array', () => {
    const result = parseTrendSeries('[[2020, 100], [2021, 200]]');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });
});
