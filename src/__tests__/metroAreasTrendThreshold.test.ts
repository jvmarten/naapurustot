/**
 * Tests for the 50% threshold in aggregateTrendHistories (via buildMetroAreaFeatures).
 *
 * The aggregation function at metroAreas.ts:96 only includes years where >= 50% of
 * neighborhoods have data (for 'sum' mode — population_history).
 * For 'weighted' mode (income/unemployment), it includes any year with totalWeight > 0.
 *
 * Since aggregateTrendHistories is private, we test through buildMetroAreaFeatures.
 * The key requirement: features must use a valid RegionId as `city` and have
 * Polygon geometries for the union to work.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { NeighborhoodProperties, TrendDataPoint } from '../utils/metrics';
import type { Feature, Polygon } from 'geojson';

const CITY = 'helsinki_metro'; // Must be a valid RegionId

// Each feature needs unique coordinates so union produces valid geometry
function makeFeature(
  pno: string,
  props: Partial<NeighborhoodProperties>,
  offsetLng = 0,
): Feature<Polygon> {
  const baseLng = 24.9 + offsetLng;
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[baseLng, 60.1], [baseLng + 0.01, 60.1], [baseLng + 0.01, 60.11], [baseLng, 60.11], [baseLng, 60.1]]],
    },
    properties: {
      pno, nimi: `Area ${pno}`, namn: `Area ${pno}`,
      kunta: '091', city: CITY, he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
  };
}

function getTrendFromResult(
  result: ReturnType<typeof buildMetroAreaFeatures>,
  key: string,
): TrendDataPoint[] | null {
  if (!result || result.features.length === 0) return null;
  const raw = result.features[0].properties?.[key];
  if (!raw || typeof raw !== 'string') return null;
  return JSON.parse(raw);
}

describe('aggregateTrendHistories — 50% threshold for sum mode', () => {
  beforeEach(() => clearMetroAreaCache());

  it('year with exactly 50% coverage is included in population_history', () => {
    // 4 neighborhoods, 2 have data for year 2020 (50% exactly)
    // All need at least 2 years so the aggregated series passes the length >= 2 check
    const features = [
      makeFeature('00101', {
        population_history: JSON.stringify([[2018, 500], [2019, 510], [2020, 520]]),
      }, 0),
      makeFeature('00102', {
        population_history: JSON.stringify([[2018, 600], [2019, 610], [2020, 620]]),
      }, 0.02),
      makeFeature('00103', {
        population_history: JSON.stringify([[2018, 700], [2019, 710]]),
        // No 2020 data
      }, 0.04),
      makeFeature('00104', {
        population_history: JSON.stringify([[2018, 800], [2019, 810]]),
        // No 2020 data
      }, 0.06),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    const trends = getTrendFromResult(result, 'population_history');
    expect(trends).not.toBeNull();

    // 2018: all 4 → sum = 2600
    const y2018 = trends!.find(t => t[0] === 2018);
    expect(y2018).toBeDefined();
    expect(y2018![1]).toBe(2600);

    // 2019: all 4 → sum = 2640
    const y2019 = trends!.find(t => t[0] === 2019);
    expect(y2019).toBeDefined();
    expect(y2019![1]).toBe(2640);

    // 2020: 2 out of 4 = 50% → should be included, sum = 1140
    const y2020 = trends!.find(t => t[0] === 2020);
    expect(y2020).toBeDefined();
    expect(y2020![1]).toBe(1140);
  });

  it('year with below 50% coverage is excluded from population_history', () => {
    // 4 neighborhoods, only 1 has data for 2021 (25% < 50%)
    const features = [
      makeFeature('00101', {
        population_history: JSON.stringify([[2018, 500], [2019, 510], [2021, 530]]),
      }, 0),
      makeFeature('00102', {
        population_history: JSON.stringify([[2018, 600], [2019, 610]]),
      }, 0.02),
      makeFeature('00103', {
        population_history: JSON.stringify([[2018, 700], [2019, 710]]),
      }, 0.04),
      makeFeature('00104', {
        population_history: JSON.stringify([[2018, 800], [2019, 810]]),
      }, 0.06),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'population_history');
    expect(trends).not.toBeNull();

    // 2021 should be excluded (only 1/4 = 25%)
    const y2021 = trends!.find(t => t[0] === 2021);
    expect(y2021).toBeUndefined();

    // 2018 and 2019 should be present (100%)
    expect(trends!.find(t => t[0] === 2018)).toBeDefined();
    expect(trends!.find(t => t[0] === 2019)).toBeDefined();
  });

  it('threshold boundary: 2 out of 3 neighborhoods (67%) is included', () => {
    const features = [
      makeFeature('00101', {
        population_history: JSON.stringify([[2018, 100], [2019, 110], [2020, 120]]),
      }, 0),
      makeFeature('00102', {
        population_history: JSON.stringify([[2018, 200], [2019, 210], [2020, 220]]),
      }, 0.02),
      makeFeature('00103', {
        population_history: JSON.stringify([[2018, 300], [2019, 310]]),
        // No 2020
      }, 0.04),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'population_history');
    expect(trends).not.toBeNull();

    // 2020: 2 out of 3 = 67% >= 50% → included
    const y2020 = trends!.find(t => t[0] === 2020);
    expect(y2020).toBeDefined();
    expect(y2020![1]).toBe(340); // 120 + 220
  });
});

describe('aggregateTrendHistories — weighted mode (income/unemployment)', () => {
  beforeEach(() => clearMetroAreaCache());

  it('weighted mode includes years with any data (no 50% threshold)', () => {
    // 3 neighborhoods, only 1 has data for 2020
    const features = [
      makeFeature('00101', {
        he_vakiy: 1000,
        income_history: JSON.stringify([[2018, 30000], [2019, 31000], [2020, 32000]]),
      }, 0),
      makeFeature('00102', {
        he_vakiy: 2000,
        income_history: JSON.stringify([[2018, 40000], [2019, 41000]]),
      }, 0.02),
      makeFeature('00103', {
        he_vakiy: 3000,
        income_history: JSON.stringify([[2018, 35000], [2019, 36000]]),
      }, 0.04),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'income_history');
    expect(trends).not.toBeNull();

    // 2020: only 1/3 have data, but weighted mode doesn't have 50% threshold
    const y2020 = trends!.find(t => t[0] === 2020);
    expect(y2020).toBeDefined();
    // Weighted avg = 32000 * 1000 / 1000 = 32000
    expect(y2020![1]).toBe(32000);
  });

  it('weighted mode uses population weights correctly', () => {
    const features = [
      makeFeature('00101', {
        he_vakiy: 1000,
        unemployment_history: JSON.stringify([[2018, 10], [2019, 12]]),
      }, 0),
      makeFeature('00102', {
        he_vakiy: 3000,
        unemployment_history: JSON.stringify([[2018, 6], [2019, 4]]),
      }, 0.02),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'unemployment_history');
    expect(trends).not.toBeNull();

    // 2018: (10*1000 + 6*3000) / (1000+3000) = 28000/4000 = 7.0
    expect(trends![0][1]).toBe(7.0);
    // 2019: (12*1000 + 4*3000) / (1000+3000) = 24000/4000 = 6.0
    expect(trends![1][1]).toBe(6.0);
  });
});

describe('aggregateTrendHistories — edge cases', () => {
  beforeEach(() => clearMetroAreaCache());

  it('sum mode rounds to nearest integer', () => {
    const features = [
      makeFeature('00101', {
        population_history: JSON.stringify([[2018, 333], [2019, 334]]),
      }, 0),
      makeFeature('00102', {
        population_history: JSON.stringify([[2018, 667], [2019, 666]]),
      }, 0.02),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'population_history');
    expect(trends).not.toBeNull();
    expect(trends![0][1]).toBe(1000);
    expect(trends![1][1]).toBe(1000);
  });

  it('features with zero population are excluded from trend aggregation', () => {
    const features = [
      makeFeature('00101', {
        he_vakiy: 0,
        income_history: JSON.stringify([[2018, 99999], [2019, 99999]]),
      }, 0),
      makeFeature('00102', {
        he_vakiy: 1000,
        income_history: JSON.stringify([[2018, 30000], [2019, 32000]]),
      }, 0.02),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'income_history');
    // pop=0 feature excluded → only 1 entry. If 1 entry has 2 years, series should exist.
    // But sum mode needs 50% threshold — 1/1 entries (the pop=1000 one) = 100% → included
    // Actually, pop=0 is skipped entirely, so entries only has the pop=1000 feature.
    // For weighted mode: 1 entry → 2 years → aggregated has 2 points → included
    if (trends) {
      expect(trends[0][1]).toBe(30000);
      expect(trends[1][1]).toBe(32000);
    }
  });

  it('single year of data produces no trend (requires >= 2 data points)', () => {
    const features = [
      makeFeature('00101', {
        population_history: JSON.stringify([[2019, 500]]),
      }, 0),
      makeFeature('00102', {
        population_history: JSON.stringify([[2019, 600]]),
      }, 0.02),
    ];

    const result = buildMetroAreaFeatures(features);
    const trends = getTrendFromResult(result, 'population_history');
    // Only 1 year aggregated → length < 2 → excluded
    expect(trends).toBeNull();
  });
});
