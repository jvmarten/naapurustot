import { describe, it, expect } from 'vitest';
import { parseTrendSeries, computeChangeMetrics } from '../utils/metrics';
import type { NeighborhoodProperties } from '../utils/metrics';

describe('parseTrendSeries — edge cases', () => {
  it('returns null for null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not-json')).toBeNull();
  });

  it('returns null for valid JSON that is not an array', () => {
    expect(parseTrendSeries('{"a":1}')).toBeNull();
  });

  it('returns null for array with fewer than 2 points', () => {
    expect(parseTrendSeries('[[2020, 100]]')).toBeNull();
  });

  it('returns null for array with invalid point structure', () => {
    expect(parseTrendSeries('[[2020, "abc"], [2021, 200]]')).toBeNull();
  });

  it('returns null for array of non-arrays', () => {
    expect(parseTrendSeries('[1, 2, 3]')).toBeNull();
  });

  it('returns null for points with wrong length', () => {
    expect(parseTrendSeries('[[2020, 100, 999], [2021, 200, 888]]')).toBeNull();
  });

  it('parses valid 2-point series', () => {
    const result = parseTrendSeries('[[2020, 100], [2021, 200]]');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('parses valid multi-point series', () => {
    const result = parseTrendSeries('[[2018, 50], [2019, 60], [2020, 70], [2021, 80]]');
    expect(result).toEqual([[2018, 50], [2019, 60], [2020, 70], [2021, 80]]);
  });

  it('handles already-parsed array (non-string input)', () => {
    const arr = [[2020, 100], [2021, 200]];
    const result = parseTrendSeries(arr as unknown as string);
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });
});

describe('computeChangeMetrics', () => {
  function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
    return {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Test',
        namn: 'Test',
        kunta: null,
        city: null,
        he_vakiy: 1000,
        income_history: null,
        population_history: null,
        unemployment_history: null,
        income_change_pct: null,
        population_change_pct: null,
        unemployment_change_pct: null,
        ...overrides,
      } as NeighborhoodProperties,
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
  }

  it('computes positive change percentage from income history', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, 30000], [2022, 36000]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (36000 - 30000) / 30000 * 100 = 20%
    expect(p.income_change_pct).toBeCloseTo(20.0);
  });

  it('computes negative change percentage', () => {
    const f = makeFeature({
      population_history: JSON.stringify([[2018, 1000], [2022, 800]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (800 - 1000) / 1000 * 100 = -20%
    expect(p.population_change_pct).toBeCloseTo(-20.0);
  });

  it('returns null change for missing history', () => {
    const f = makeFeature({});
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
    expect(p.population_change_pct).toBeNull();
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('returns null change when first value is zero (division by zero)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, 0], [2022, 5000]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeNull();
  });

  it('returns null for series with only one data point', () => {
    const f = makeFeature({
      unemployment_history: JSON.stringify([[2020, 5.5]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.unemployment_change_pct).toBeNull();
  });

  it('handles negative first value correctly (using abs)', () => {
    // computeChangePct uses Math.abs(first) in denominator
    const f = makeFeature({
      income_history: JSON.stringify([[2018, -100], [2022, 100]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    // (100 - (-100)) / abs(-100) * 100 = 200%
    expect(p.income_change_pct).toBeCloseTo(200.0);
  });

  it('computes all three change metrics independently', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, 20000], [2022, 24000]]),
      population_history: JSON.stringify([[2018, 500], [2022, 600]]),
      unemployment_history: JSON.stringify([[2018, 10], [2022, 8]]),
    });
    computeChangeMetrics([f]);
    const p = f.properties as NeighborhoodProperties;
    expect(p.income_change_pct).toBeCloseTo(20.0);
    expect(p.population_change_pct).toBeCloseTo(20.0);
    expect(p.unemployment_change_pct).toBeCloseTo(-20.0);
  });
});
