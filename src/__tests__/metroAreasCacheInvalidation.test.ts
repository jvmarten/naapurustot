import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, Polygon } from 'geojson';

vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

const POLYGON_A: Polygon = {
  type: 'Polygon',
  coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
};

const POLYGON_B: Polygon = {
  type: 'Polygon',
  coordinates: [[[25.0, 60.1], [25.1, 60.1], [25.1, 60.2], [25.0, 60.2], [25.0, 60.1]]],
};

function makeFeature(props: Partial<NeighborhoodProperties>, geom: Polygon = POLYGON_A): Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091',
      city: 'helsinki_metro', he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
    geometry: geom,
  };
}

describe('buildMetroAreaFeatures — selective cache invalidation', () => {
  beforeEach(() => {
    // Force cache clear by passing a fresh array
    buildMetroAreaFeatures([]);
  });

  it('recomputes averages after clearMetroAreaCache without re-running geometry union', () => {
    const features = [
      makeFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 30000 }, POLYGON_A),
      makeFeature({ pno: '00200', city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 40000 }, POLYGON_B),
    ];

    const result1 = buildMetroAreaFeatures(features);
    expect(result1.features.length).toBe(1);
    const avgIncome1 = (result1.features[0].properties as Record<string, unknown>).hr_mtu;

    // Mutate income on features (simulating quality recomputation)
    (features[0].properties as NeighborhoodProperties).hr_mtu = 50000;

    // Without clearing cache, averages should still be old
    const result2 = buildMetroAreaFeatures(features);
    const avgIncome2 = (result2.features[0].properties as Record<string, unknown>).hr_mtu;
    expect(avgIncome2).toBe(avgIncome1);

    // After clearing, averages should update
    clearMetroAreaCache();
    const result3 = buildMetroAreaFeatures(features);
    const avgIncome3 = (result3.features[0].properties as Record<string, unknown>).hr_mtu;
    expect(avgIncome3).not.toBe(avgIncome1);

    // Geometry should be preserved (same reference from cache)
    expect(result3.features[0].geometry).toBe(result2.features[0].geometry);
  });

  it('marks all features with _isMetroArea: true', () => {
    const features = [
      makeFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000 }),
      makeFeature({ pno: '00200', city: 'turku', he_vakiy: 500 }),
    ];

    const result = buildMetroAreaFeatures(features);
    for (const f of result.features) {
      expect((f.properties as Record<string, unknown>)._isMetroArea).toBe(true);
    }
  });

  it('uses city id as pno property', () => {
    const features = [
      makeFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000 }),
    ];

    const result = buildMetroAreaFeatures(features);
    expect((result.features[0].properties as Record<string, unknown>).pno).toBe('helsinki_metro');
  });

  it('invalidates geometry cache when features array reference changes', () => {
    const features1 = [
      makeFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const result1 = buildMetroAreaFeatures(features1);

    const features2 = [
      makeFeature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 2000, hr_mtu: 50000 }),
    ];
    const result2 = buildMetroAreaFeatures(features2);

    // Different features reference should produce different averages
    const hr1 = (result1.features[0].properties as Record<string, unknown>).hr_mtu;
    const hr2 = (result2.features[0].properties as Record<string, unknown>).hr_mtu;
    expect(hr2).not.toBe(hr1);
  });

  it('handles features with no known city gracefully', () => {
    const features = [
      makeFeature({ pno: '00100', city: 'unknown_city' as any, he_vakiy: 1000 }),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result.features.length).toBe(0);
  });

  it('skips features with Point geometry (only Polygon/MultiPolygon)', () => {
    const features: Feature[] = [
      {
        type: 'Feature',
        properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', he_vakiy: 1000 },
        geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      },
    ];

    const result = buildMetroAreaFeatures(features);
    // City with no polygon features should produce no metro feature
    expect(result.features.length).toBe(0);
  });
});

describe('buildMetroAreaFeatures — trend history aggregation', () => {
  it('aggregates population_history by summing values per year', () => {
    const features = [
      makeFeature({
        pno: '00100', city: 'helsinki_metro', he_vakiy: 1000,
        population_history: JSON.stringify([[2020, 900], [2021, 1000]]),
      }),
      makeFeature({
        pno: '00200', city: 'helsinki_metro', he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const historyStr = (result.features[0].properties as Record<string, unknown>).population_history;
    expect(typeof historyStr).toBe('string');

    const history = JSON.parse(historyStr as string);
    // Sum: 2020→900+1800=2700, 2021→1000+2000=3000
    expect(history).toEqual([[2020, 2700], [2021, 3000]]);
  });

  it('aggregates income_history using population-weighted average', () => {
    const features = [
      makeFeature({
        pno: '00100', city: 'helsinki_metro', he_vakiy: 1000,
        income_history: JSON.stringify([[2020, 30000], [2021, 32000]]),
      }),
      makeFeature({
        pno: '00200', city: 'helsinki_metro', he_vakiy: 3000,
        income_history: JSON.stringify([[2020, 40000], [2021, 42000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const historyStr = (result.features[0].properties as Record<string, unknown>).income_history;
    const history = JSON.parse(historyStr as string);

    // Weighted avg: 2020→(30000*1000 + 40000*3000)/(1000+3000) = 37500
    // 2021→(32000*1000 + 42000*3000)/4000 = 39500
    expect(history[0][1]).toBeCloseTo(37500, 0);
    expect(history[1][1]).toBeCloseTo(39500, 0);
  });
});
