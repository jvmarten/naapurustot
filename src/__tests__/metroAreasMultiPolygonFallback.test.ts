import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use real region IDs since buildMetroAreaFeatures only includes cities in REGIONS config
describe('metroAreas — MultiPolygon fallback path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('aggregateTrendHistories produces valid JSON for population_history sum', async () => {
    const { parseTrendSeries } = await import('../utils/metrics');

    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          he_vakiy: 3000, city: 'turku',
          population_history: JSON.stringify([[2019, 2800], [2020, 2900], [2021, 3000]]),
          income_history: JSON.stringify([[2019, 28000], [2020, 30000], [2021, 32000]]),
          unemployment_history: JSON.stringify([[2019, 8.0], [2020, 7.5], [2021, 7.0]]),
        },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
      {
        type: 'Feature',
        properties: {
          he_vakiy: 7000, city: 'turku',
          population_history: JSON.stringify([[2019, 6500], [2020, 6800], [2021, 7000]]),
          income_history: JSON.stringify([[2019, 35000], [2020, 37000], [2021, 40000]]),
          unemployment_history: JSON.stringify([[2019, 5.0], [2020, 4.5], [2021, 4.0]]),
        },
        geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] },
      },
    ];

    const { buildMetroAreaFeatures, preloadUnion } = await import('../utils/metroAreas');
    await preloadUnion().catch(() => {});
    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBeGreaterThanOrEqual(1);
    const metro = result.features[0];
    const props = metro.properties!;

    if (props.population_history) {
      const popSeries = parseTrendSeries(props.population_history);
      expect(popSeries).not.toBeNull();
      if (popSeries) {
        const y2021 = popSeries.find(([y]) => y === 2021);
        expect(y2021).toBeDefined();
        if (y2021) {
          expect(y2021[1]).toBe(10000);
        }
      }
    }
  });

  it('buildMetroAreaFeatures handles features with MultiPolygon geometry', async () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { he_vakiy: 5000, city: 'oulu', hr_mtu: 30000 },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
            [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
          ],
        },
      },
    ];

    const { buildMetroAreaFeatures, preloadUnion } = await import('../utils/metroAreas');
    await preloadUnion().catch(() => {});
    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBeGreaterThanOrEqual(1);
    const geom = result.features[0].geometry;
    expect(geom.type === 'Polygon' || geom.type === 'MultiPolygon').toBe(true);
  });

  it('buildMetroAreaFeatures handles single feature per city', async () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { he_vakiy: 5000, city: 'tampere', hr_mtu: 30000 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      },
    ];

    const { buildMetroAreaFeatures, preloadUnion } = await import('../utils/metroAreas');
    await preloadUnion().catch(() => {});
    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBe(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
  });

  it('buildMetroAreaFeatures returns empty when no features', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');
    const result = buildMetroAreaFeatures([]);
    expect(result.features).toHaveLength(0);
  });

  it('buildMetroAreaFeatures groups features by city property', async () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { he_vakiy: 3000, city: 'turku', hr_mtu: 25000 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
      {
        type: 'Feature',
        properties: { he_vakiy: 4000, city: 'turku', hr_mtu: 35000 },
        geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 0]]] },
      },
      {
        type: 'Feature',
        properties: { he_vakiy: 2000, city: 'tampere', hr_mtu: 20000 },
        geometry: { type: 'Polygon', coordinates: [[[3, 0], [4, 0], [4, 1], [3, 0]]] },
      },
    ];

    const { buildMetroAreaFeatures, preloadUnion } = await import('../utils/metroAreas');
    await preloadUnion().catch(() => {});
    const result = buildMetroAreaFeatures(features);

    const cities = result.features.map(f => f.properties!.city);
    expect(cities).toContain('turku');
    expect(cities).toContain('tampere');
    expect(result.features.length).toBe(2);
  });

  it('buildMetroAreaFeatures excludes unknown city IDs', async () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { he_vakiy: 3000, city: 'unknown_city_xyz', hr_mtu: 25000 },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
    ];

    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');
    const result = buildMetroAreaFeatures(features);
    expect(result.features).toHaveLength(0);
  });
});
