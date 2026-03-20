import { describe, it, expect, vi } from 'vitest';
import { parseTrendSeries, computeChangeMetrics } from '../utils/metrics';
import type { Feature } from 'geojson';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

describe('parseTrendSeries', () => {
  it('returns null for null input', () => {
    expect(parseTrendSeries(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseTrendSeries(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseTrendSeries('')).toBeNull();
  });

  it('parses valid JSON-encoded trend series', () => {
    const json = JSON.stringify([[2020, 100], [2021, 110], [2022, 120]]);
    const result = parseTrendSeries(json);
    expect(result).toEqual([[2020, 100], [2021, 110], [2022, 120]]);
  });

  it('returns null for series with fewer than 2 data points', () => {
    const json = JSON.stringify([[2020, 100]]);
    expect(parseTrendSeries(json)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseTrendSeries('not json')).toBeNull();
  });

  it('returns null for array with wrong element structure', () => {
    // Elements are not [number, number] tuples
    expect(parseTrendSeries(JSON.stringify([[2020, 'abc'], [2021, 110]]))).toBeNull();
  });

  it('returns null for array with wrong tuple length', () => {
    expect(parseTrendSeries(JSON.stringify([[2020, 100, 999], [2021, 110, 888]]))).toBeNull();
  });

  it('returns null for non-array JSON', () => {
    expect(parseTrendSeries(JSON.stringify({ year: 2020, value: 100 }))).toBeNull();
  });

  it('accepts valid 2-element series (minimum)', () => {
    const json = JSON.stringify([[2020, 100], [2021, 150]]);
    const result = parseTrendSeries(json);
    expect(result).toEqual([[2020, 100], [2021, 150]]);
  });

  it('handles negative values in series', () => {
    const json = JSON.stringify([[2020, -5], [2021, -3]]);
    const result = parseTrendSeries(json);
    expect(result).toEqual([[2020, -5], [2021, -3]]);
  });
});

describe('computeChangeMetrics', () => {
  function makeFeature(props: Record<string, unknown>): Feature {
    return {
      type: 'Feature',
      properties: { pno: '00100', nimi: 'Test', ...props },
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
  }

  it('computes income change percentage from history', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, 20000], [2019, 22000], [2020, 24000]]),
    });
    computeChangeMetrics([f]);
    // Change from 20000 to 24000 = +20%
    expect(f.properties!.income_change_pct).toBeCloseTo(20, 1);
  });

  it('computes population change percentage', () => {
    const f = makeFeature({
      population_history: JSON.stringify([[2018, 1000], [2020, 900]]),
    });
    computeChangeMetrics([f]);
    // Change from 1000 to 900 = -10%
    expect(f.properties!.population_change_pct).toBeCloseTo(-10, 1);
  });

  it('computes unemployment change percentage', () => {
    const f = makeFeature({
      unemployment_history: JSON.stringify([[2018, 10], [2020, 15]]),
    });
    computeChangeMetrics([f]);
    // Change from 10 to 15 = +50%
    expect(f.properties!.unemployment_change_pct).toBeCloseTo(50, 1);
  });

  it('sets null when history is null', () => {
    const f = makeFeature({
      income_history: null,
      population_history: null,
      unemployment_history: null,
    });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeNull();
    expect(f.properties!.population_change_pct).toBeNull();
    expect(f.properties!.unemployment_change_pct).toBeNull();
  });

  it('sets null when first value in series is zero (division by zero)', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, 0], [2020, 5000]]),
    });
    computeChangeMetrics([f]);
    expect(f.properties!.income_change_pct).toBeNull();
  });

  it('handles negative starting values correctly', () => {
    const f = makeFeature({
      income_history: JSON.stringify([[2018, -100], [2020, -50]]),
    });
    computeChangeMetrics([f]);
    // (-50 - (-100)) / |-100| * 100 = 50%
    expect(f.properties!.income_change_pct).toBeCloseTo(50, 1);
  });

  it('processes multiple features independently', () => {
    const f1 = makeFeature({
      pno: '00100',
      income_history: JSON.stringify([[2018, 20000], [2020, 30000]]),
    });
    const f2 = makeFeature({
      pno: '00200',
      income_history: JSON.stringify([[2018, 40000], [2020, 36000]]),
    });
    computeChangeMetrics([f1, f2]);
    expect(f1.properties!.income_change_pct).toBeCloseTo(50, 1);
    expect(f2.properties!.income_change_pct).toBeCloseTo(-10, 1);
  });
});
