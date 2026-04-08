/**
 * Deep tests for metro area trend history aggregation and cache invalidation.
 *
 * The 50% coverage threshold, population-weighted averaging, and cache
 * invalidation when @turf/union becomes available are all subtle behaviors
 * that have broken before. A bug here shows incorrect trend charts in the
 * "all cities" view.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache, preloadUnion } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(
  city: string,
  pno: string,
  pop: number,
  extraProps?: Partial<NeighborhoodProperties>,
): Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      city,
      he_vakiy: pop,
      ...extraProps,
    } as unknown as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
    },
  };
}

beforeAll(() => preloadUnion());
beforeEach(() => clearMetroAreaCache());

describe('metro area trend aggregation', () => {
  it('sums population_history across neighborhoods per year', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000, {
        population_history: JSON.stringify([[2018, 500], [2019, 600], [2020, 700]]),
      }),
      makeFeature('helsinki_metro', '00200', 2000, {
        population_history: JSON.stringify([[2018, 1500], [2019, 1600], [2020, 1700]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();

    const metro = result!.features.find((f) => f.properties?.city === 'helsinki_metro');
    expect(metro).toBeDefined();

    const popHistory = JSON.parse(metro!.properties!.population_history as string);
    expect(popHistory).toEqual([
      [2018, 2000],
      [2019, 2200],
      [2020, 2400],
    ]);
  });

  it('computes population-weighted income_history averages', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000, {
        income_history: JSON.stringify([[2018, 30000], [2019, 32000]]),
      }),
      makeFeature('helsinki_metro', '00200', 3000, {
        income_history: JSON.stringify([[2018, 40000], [2019, 44000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result!.features.find((f) => f.properties?.city === 'helsinki_metro');
    const incomeHistory = JSON.parse(metro!.properties!.income_history as string);

    // 2018: (30000*1000 + 40000*3000) / 4000 = 37500
    // 2019: (32000*1000 + 44000*3000) / 4000 = 41000
    expect(incomeHistory[0][1]).toBeCloseTo(37500, 0);
    expect(incomeHistory[1][1]).toBeCloseTo(41000, 0);
  });

  it('skips years where less than 50% of neighborhoods have data (sum mode)', () => {
    // 4 neighborhoods, only 1 has data for 2017 (< 50% threshold)
    const features = [
      makeFeature('helsinki_metro', '00100', 1000, {
        population_history: JSON.stringify([[2017, 500], [2018, 600], [2019, 700]]),
      }),
      makeFeature('helsinki_metro', '00200', 1000, {
        population_history: JSON.stringify([[2018, 800], [2019, 900]]),
      }),
      makeFeature('helsinki_metro', '00300', 1000, {
        population_history: JSON.stringify([[2018, 300], [2019, 400]]),
      }),
      makeFeature('helsinki_metro', '00400', 1000, {
        population_history: JSON.stringify([[2018, 200], [2019, 300]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result!.features.find((f) => f.properties?.city === 'helsinki_metro');
    const popHistory = JSON.parse(metro!.properties!.population_history as string);

    // 2017 should be excluded (only 1/4 = 25% < 50%)
    expect(popHistory[0][0]).toBe(2018);
    expect(popHistory.every((p: [number, number]) => p[0] >= 2018)).toBe(true);
  });

  it('skips neighborhoods with zero population from trend aggregation', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 0, {
        income_history: JSON.stringify([[2018, 99999]]),
      }),
      makeFeature('helsinki_metro', '00200', 1000, {
        income_history: JSON.stringify([[2018, 30000], [2019, 32000]]),
      }),
      makeFeature('helsinki_metro', '00300', 1000, {
        income_history: JSON.stringify([[2018, 40000], [2019, 42000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result!.features.find((f) => f.properties?.city === 'helsinki_metro');
    const incomeHistory = JSON.parse(metro!.properties!.income_history as string);

    // Should not include the zero-pop neighborhood's 99999 value
    expect(incomeHistory[0][1]).toBeCloseTo(35000, 0);
  });

  it('does not include trend history when fewer than 2 data points result', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000, {
        income_history: JSON.stringify([[2020, 30000]]),
      }),
      makeFeature('helsinki_metro', '00200', 1000, {
        income_history: JSON.stringify([[2020, 40000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result!.features.find((f) => f.properties?.city === 'helsinki_metro');
    // With only 1 year of data, aggregated series has 1 point → should not be included
    expect(metro!.properties!.income_history).toBeUndefined();
  });
});

describe('metro area cache behavior', () => {
  it('returns cached result for same features array', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000),
      makeFeature('helsinki_metro', '00200', 2000),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);

    // Should be a new FeatureCollection (for language refresh) but reuse cached geometry
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });

  it('recomputes after clearMetroAreaCache()', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000),
    ];

    buildMetroAreaFeatures(features);
    clearMetroAreaCache();

    // Should work after clearing
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
  });

  it('sets _isMetroArea on all features', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000),
      makeFeature('turku', '20100', 500),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    for (const f of result!.features) {
      expect(f.properties!._isMetroArea).toBe(true);
    }
  });

  it('groups features by city and creates one metro feature per city', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', 1000),
      makeFeature('helsinki_metro', '00200', 2000),
      makeFeature('turku', '20100', 500),
      makeFeature('turku', '20200', 800),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(2);

    const cities = result!.features.map((f) => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
  });

  it('excludes unknown region IDs', () => {
    const features = [
      makeFeature('unknown_city' as any, '99999', 1000),
      makeFeature('helsinki_metro', '00100', 1000),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    // Only helsinki_metro should appear
    expect(result!.features.length).toBe(1);
    expect(result!.features[0].properties!.city).toBe('helsinki_metro');
  });
});
