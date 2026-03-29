import { describe, it, expect, beforeAll } from 'vitest';
import { buildMetroAreaFeatures, preloadUnion } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(overrides: Partial<NeighborhoodProperties>, coords: number[][][] = [[[0,0],[1,0],[1,1],[0,1],[0,0]]]): Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: null,
      city: 'helsinki_metro',
      he_vakiy: 1000,
      hr_mtu: 30000,
      income_history: null,
      population_history: null,
      unemployment_history: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

describe('buildMetroAreaFeatures — trend aggregation', () => {
  // @turf/union is lazy-loaded; pre-load it before tests run
  beforeAll(() => preloadUnion());

  it('aggregates population history by summing per year', () => {
    const features = [
      makeFeature({
        pno: '00100',
        population_history: JSON.stringify([[2020, 500], [2021, 520]]),
        he_vakiy: 500,
      }),
      makeFeature({
        pno: '00200',
        population_history: JSON.stringify([[2020, 300], [2021, 350]]),
        he_vakiy: 300,
      }, [[[2,0],[3,0],[3,1],[2,1],[2,0]]]),
    ];

    const result = buildMetroAreaFeatures(features)!;
    const helsinki = result.features.find((f) => f.properties?.pno === 'helsinki_metro');
    expect(helsinki).toBeDefined();

    const popHistory = JSON.parse(helsinki!.properties!.population_history as string);
    // 2020: 500+300=800, 2021: 520+350=870
    expect(popHistory).toEqual([[2020, 800], [2021, 870]]);
  });

  it('aggregates income history as population-weighted average', () => {
    const features = [
      makeFeature({
        pno: '00100',
        income_history: JSON.stringify([[2020, 30000], [2021, 32000]]),
        he_vakiy: 1000,
      }),
      makeFeature({
        pno: '00200',
        income_history: JSON.stringify([[2020, 50000], [2021, 52000]]),
        he_vakiy: 3000,
      }, [[[2,0],[3,0],[3,1],[2,1],[2,0]]]),
    ];

    const result = buildMetroAreaFeatures(features)!;
    const helsinki = result.features.find((f) => f.properties?.pno === 'helsinki_metro');
    const incomeHistory = JSON.parse(helsinki!.properties!.income_history as string);
    // 2020: (30000*1000 + 50000*3000) / 4000 = 45000
    // 2021: (32000*1000 + 52000*3000) / 4000 = 47000
    expect(incomeHistory[0]).toEqual([2020, 45000]);
    expect(incomeHistory[1]).toEqual([2021, 47000]);
  });

  it('marks metro area features with _isMetroArea: true', () => {
    const features = [makeFeature({ pno: '00100' })];
    const result = buildMetroAreaFeatures(features)!;
    for (const f of result.features) {
      expect(f.properties?._isMetroArea).toBe(true);
    }
  });

  it('produces features for each city that has neighborhoods', () => {
    const features = [
      makeFeature({ pno: '00100', city: 'helsinki_metro' }),
      makeFeature({ pno: '20100', city: 'turku' }, [[[4,0],[5,0],[5,1],[4,1],[4,0]]]),
    ];
    const result = buildMetroAreaFeatures(features)!;
    const cityIds = result.features.map((f) => f.properties?.pno);
    expect(cityIds).toContain('helsinki_metro');
    expect(cityIds).toContain('turku');
    // Tampere has no neighborhoods → no feature
    expect(cityIds).not.toContain('tampere');
  });

  it('returns empty collection when no features have a city property', () => {
    const features = [makeFeature({ city: null })];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features.length).toBe(0);
  });

  it('skips neighborhoods with zero population for trend aggregation', () => {
    const features = [
      makeFeature({
        pno: '00100',
        he_vakiy: 0,
        population_history: JSON.stringify([[2020, 0], [2021, 0]]),
      }),
      makeFeature({
        pno: '00200',
        he_vakiy: 500,
        population_history: JSON.stringify([[2020, 500], [2021, 600]]),
      }, [[[2,0],[3,0],[3,1],[2,1],[2,0]]]),
    ];
    const result = buildMetroAreaFeatures(features)!;
    const helsinki = result.features.find((f) => f.properties?.pno === 'helsinki_metro');
    // Only the second neighborhood should contribute
    const popHistory = JSON.parse(helsinki!.properties!.population_history as string);
    expect(popHistory).toEqual([[2020, 500], [2021, 600]]);
  });
});
