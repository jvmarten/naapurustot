/**
 * Tests for metro area trend history aggregation.
 *
 * aggregateTrendHistories (internal to metroAreas.ts) combines per-neighborhood
 * trend series into city-level aggregates:
 * - population_history: summed per year
 * - income_history: population-weighted average per year
 * - unemployment_history: population-weighted average per year
 *
 * We test this via buildMetroAreaFeatures which exposes the aggregated trends
 * in the output feature properties.
 */
import { describe, it, expect } from 'vitest';
import { buildMetroAreaFeatures } from '../utils/metroAreas';
import type { Feature } from 'geojson';
import { parseTrendSeries } from '../utils/metrics';

function makeFeatureWithTrends(
  pno: string,
  city: string,
  pop: number,
  popHistory: [number, number][],
  incomeHistory: [number, number][],
  unempHistory: [number, number][],
): Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: '091',
      city,
      he_vakiy: pop,
      hr_mtu: 30000,
      population_history: JSON.stringify(popHistory),
      income_history: JSON.stringify(incomeHistory),
      unemployment_history: JSON.stringify(unempHistory),
    },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[24.9, 60.2], [24.91, 60.2], [24.91, 60.21], [24.9, 60.21], [24.9, 60.2]],
      ],
    },
  };
}

describe('metro area trend aggregation', () => {
  it('sums population histories across neighborhoods', () => {
    const features = [
      makeFeatureWithTrends('00100', 'helsinki_metro', 1000,
        [[2020, 900], [2021, 1000]],
        [[2020, 30000], [2021, 32000]],
        [[2020, 10], [2021, 8]],
      ),
      makeFeatureWithTrends('00200', 'helsinki_metro', 2000,
        [[2020, 1800], [2021, 2000]],
        [[2020, 40000], [2021, 42000]],
        [[2020, 5], [2021, 4]],
      ),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    const popHistory = parseTrendSeries(metro.properties!.population_history as string);

    expect(popHistory).not.toBeNull();
    expect(popHistory!.length).toBe(2);
    expect(popHistory![0][1]).toBe(2700);
    expect(popHistory![1][1]).toBe(3000);
  });

  it('computes population-weighted average for income history', () => {
    // aggregateTrendHistories requires >= 2 data points per series
    const features = [
      makeFeatureWithTrends('00100', 'helsinki_metro', 1000,
        [[2020, 900], [2021, 1000]],
        [[2020, 18000], [2021, 20000]],
        [[2020, 12], [2021, 10]],
      ),
      makeFeatureWithTrends('00200', 'helsinki_metro', 3000,
        [[2020, 2800], [2021, 3000]],
        [[2020, 38000], [2021, 40000]],
        [[2020, 7], [2021, 6]],
      ),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    const incHistory = parseTrendSeries(metro.properties!.income_history as string);

    expect(incHistory).not.toBeNull();
    expect(incHistory!.length).toBe(2);
    // 2021: weighted avg = (1000*20000 + 3000*40000) / 4000 = 35000
    expect(incHistory![1][1]).toBe(35000);
  });

  it('computes population-weighted average for unemployment history', () => {
    const features = [
      makeFeatureWithTrends('00100', 'helsinki_metro', 1000,
        [[2020, 900], [2021, 1000]],
        [[2020, 28000], [2021, 30000]],
        [[2020, 12], [2021, 10]],
      ),
      makeFeatureWithTrends('00200', 'helsinki_metro', 3000,
        [[2020, 2800], [2021, 3000]],
        [[2020, 28000], [2021, 30000]],
        [[2020, 7], [2021, 6]],
      ),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    const unempHistory = parseTrendSeries(metro.properties!.unemployment_history as string);

    expect(unempHistory).not.toBeNull();
    // 2021: weighted avg = (1000*10 + 3000*6) / 4000 = 7.0
    expect(unempHistory![1][1]).toBe(7);
  });

  it('skips features with zero or null population', () => {
    const features = [
      makeFeatureWithTrends('00100', 'helsinki_metro', 1000,
        [[2020, 900], [2021, 1000]],
        [[2020, 28000], [2021, 30000]],
        [[2020, 6], [2021, 5]],
      ),
      makeFeatureWithTrends('00200', 'helsinki_metro', 0,
        [[2020, 0], [2021, 0]],
        [[2020, 48000], [2021, 50000]],
        [[2020, 22], [2021, 20]],
      ),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    const incHistory = parseTrendSeries(metro.properties!.income_history as string);

    expect(incHistory).not.toBeNull();
    expect(incHistory![1][1]).toBe(30000);
  });

  it('handles neighborhoods with no trend data', () => {
    const features: Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'helsinki_metro',
          he_vakiy: 1000, hr_mtu: 30000,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[24.9, 60.2], [24.91, 60.2], [24.91, 60.21], [24.9, 60.21], [24.9, 60.2]]],
        },
      },
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result.features[0];
    expect(metro.properties!.population_history).toBeUndefined();
  });
});
