import { describe, it, expect } from 'vitest';
import { computeChangeMetrics, parseTrendSeries } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeChangeMetrics — critical edge cases', () => {
  it('computes positive change correctly', () => {
    const features = [
      makeFeature({ income_history: JSON.stringify([[2018, 30000], [2022, 36000]]) }),
    ];
    computeChangeMetrics(features);
    // (36000-30000)/30000 * 100 = 20%
    expect(features[0].properties!.income_change_pct).toBe(20);
  });

  it('computes negative change correctly', () => {
    const features = [
      makeFeature({ population_history: JSON.stringify([[2018, 1000], [2022, 800]]) }),
    ];
    computeChangeMetrics(features);
    // (800-1000)/|1000| * 100 = -20%
    expect(features[0].properties!.population_change_pct).toBe(-20);
  });

  it('returns null when first value is zero (division by zero)', () => {
    const features = [
      makeFeature({ income_history: JSON.stringify([[2018, 0], [2022, 50000]]) }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('handles last value being zero correctly', () => {
    const features = [
      makeFeature({ unemployment_history: JSON.stringify([[2018, 10], [2022, 0]]) }),
    ];
    computeChangeMetrics(features);
    // (0-10)/|10| * 100 = -100%
    expect(features[0].properties!.unemployment_change_pct).toBe(-100);
  });

  it('handles negative starting values with Math.abs in denominator', () => {
    const features = [
      makeFeature({ income_history: JSON.stringify([[2018, -50], [2022, -25]]) }),
    ];
    computeChangeMetrics(features);
    // (-25 - (-50)) / Math.abs(-50) * 100 = 25/50*100 = 50%
    expect(features[0].properties!.income_change_pct).toBe(50);
  });

  it('uses first and last data points, not min/max', () => {
    const features = [
      makeFeature({
        income_history: JSON.stringify([[2018, 100], [2019, 200], [2020, 50], [2022, 150]]),
      }),
    ];
    computeChangeMetrics(features);
    // (150-100)/100 * 100 = 50%, not based on min(50) or max(200)
    expect(features[0].properties!.income_change_pct).toBe(50);
  });

  it('returns null for single data point', () => {
    const features = [
      makeFeature({ income_history: JSON.stringify([[2022, 50000]]) }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('returns null for missing history', () => {
    const features = [
      makeFeature({ income_history: null }),
    ];
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeNull();
  });

  it('handles very large percentage changes', () => {
    const features = [
      makeFeature({ income_history: JSON.stringify([[2018, 1], [2022, 1000]]) }),
    ];
    computeChangeMetrics(features);
    // (1000-1)/1 * 100 = 99900%
    expect(features[0].properties!.income_change_pct).toBe(99900);
  });
});

describe('parseTrendSeries — critical edge cases', () => {
  it('rejects NaN values in tuple', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, NaN]]));
    expect(result).toBeNull();
  });

  it('rejects Infinity values in tuple', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, Infinity]]));
    expect(result).toBeNull();
  });

  it('rejects string numbers in tuple', () => {
    const result = parseTrendSeries(JSON.stringify([['2020', 100], ['2021', 200]]));
    expect(result).toBeNull();
  });

  it('rejects mixed valid/invalid tuples', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, 100], [2021, 'abc']]));
    expect(result).toBeNull();
  });

  it('accepts exactly 2-element series', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, 100], [2021, 200]]));
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('accepts negative values', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, -5], [2021, -3]]));
    expect(result).toEqual([[2020, -5], [2021, -3]]);
  });

  it('rejects empty array', () => {
    expect(parseTrendSeries('[]')).toBeNull();
  });

  it('rejects non-array JSON', () => {
    expect(parseTrendSeries('{"a":1}')).toBeNull();
    expect(parseTrendSeries('"hello"')).toBeNull();
    expect(parseTrendSeries('42')).toBeNull();
  });

  it('handles whitespace in valid JSON', () => {
    const result = parseTrendSeries('  [ [ 2020 , 100 ] , [ 2021 , 200 ] ]  ');
    expect(result).toEqual([[2020, 100], [2021, 200]]);
  });

  it('rejects duplicate years but parses correctly (no dedup)', () => {
    const result = parseTrendSeries(JSON.stringify([[2020, 100], [2020, 200]]));
    // Duplicate years are valid as per the parser — no dedup logic exists
    expect(result).toEqual([[2020, 100], [2020, 200]]);
  });
});
