import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { Feature } from 'geojson';

function makeFeature(city: string, pno: string, extraProps: Record<string, unknown> = {}): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: null,
      city,
      he_vakiy: 1000,
      ...extraProps,
    },
  };
}

function makeMultiPolygonFeature(city: string, pno: string): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
        [[[25.0, 60.2], [25.05, 60.2], [25.05, 60.25], [25.0, 60.25], [25.0, 60.2]]],
      ],
    },
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: null,
      city,
      he_vakiy: 500,
    },
  };
}

describe('buildMetroAreaFeatures - cache and fallback', () => {
  beforeEach(() => {
    clearMetroAreaCache();
  });

  it('clearMetroAreaCache forces re-computation', () => {
    const features = [makeFeature('helsinki_metro', '00100', { he_vakiy: 1000, hr_mtu: 30000 })];
    const result1 = buildMetroAreaFeatures(features)!;
    expect((result1.features[0].properties as any).hr_mtu).toBeDefined();

    clearMetroAreaCache();

    // Same reference, but cache was cleared — should still return valid data
    const result2 = buildMetroAreaFeatures(features)!;
    expect(result2.features).toHaveLength(1);
  });

  it('handles MultiPolygon input features', () => {
    const features = [makeMultiPolygonFeature('helsinki_metro', '00100')];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features).toHaveLength(1);
    expect((result.features[0].properties as any)._isMetroArea).toBe(true);
  });

  it('handles single polygon city (no union needed)', () => {
    const features = [makeFeature('helsinki_metro', '00100')];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features).toHaveLength(1);
    const geom = result.features[0].geometry;
    // Single feature → geometry is used directly without union
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });

  it('handles features with null city gracefully', () => {
    const features = [
      makeFeature('helsinki_metro', '00100'),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
        },
        properties: { pno: '99999', nimi: 'NullCity', namn: 'NullCity', kunta: null, city: null, he_vakiy: 500 },
      },
    ];
    const result = buildMetroAreaFeatures(features)!;
    // The null-city feature should be skipped
    expect(result.features).toHaveLength(1);
    expect((result.features[0].properties as any).city).toBe('helsinki_metro');
  });

  it('handles features with zero population in trend aggregation', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', {
        he_vakiy: 0,
        population_history: '[[2018, 100], [2020, 0]]',
        income_history: '[[2018, 25000], [2020, 28000]]',
      }),
      makeFeature('helsinki_metro', '00200', {
        he_vakiy: 1000,
        population_history: '[[2018, 500], [2020, 1000]]',
        income_history: '[[2018, 30000], [2020, 32000]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features).toHaveLength(1);
    // Zero-population feature should be skipped in trend aggregation
    const props = result.features[0].properties as any;
    if (props.income_history) {
      const incHistory = JSON.parse(props.income_history);
      // With only one valid feature (pop 1000), weighted average = plain values
      expect(incHistory[0][1]).toBe(30000);
    }
  });

  it('handles features missing trend data', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', { he_vakiy: 1000 }),
      makeFeature('helsinki_metro', '00200', { he_vakiy: 2000 }),
    ];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features).toHaveLength(1);
    const props = result.features[0].properties as any;
    // No trend data → no history properties
    expect(props.population_history).toBeUndefined();
  });

  it('handles mixed polygon and non-polygon geometry within same city', () => {
    const features = [
      makeFeature('helsinki_metro', '00100'),
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [24.95, 60.12] },
        properties: {
          pno: '00200', nimi: 'Point area', namn: 'Point area',
          kunta: null, city: 'helsinki_metro', he_vakiy: 500,
        },
      },
    ];
    const result = buildMetroAreaFeatures(features)!;
    expect(result.features).toHaveLength(1);
    // Should use only the polygon feature's geometry
  });

  it('aggregates unemployment_history with weighted average', () => {
    const features = [
      makeFeature('turku', '20100', {
        he_vakiy: 2000,
        unemployment_history: '[[2019, 10], [2021, 8]]',
      }),
      makeFeature('turku', '20200', {
        he_vakiy: 3000,
        unemployment_history: '[[2019, 15], [2021, 12]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features)!;
    const turku = result.features.find((f) => (f.properties as any).city === 'turku');
    expect(turku).toBeDefined();

    const uHistory = JSON.parse((turku!.properties as any).unemployment_history);
    expect(uHistory).toHaveLength(2);
    // 2019: (10*2000 + 15*3000) / 5000 = (20000+45000)/5000 = 13
    expect(uHistory[0][1]).toBe(13);
    // 2021: (8*2000 + 12*3000) / 5000 = (16000+36000)/5000 = 10.4
    expect(uHistory[1][1]).toBe(10.4);
  });

  it('trend aggregation requires at least 2 data points', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', {
        he_vakiy: 1000,
        population_history: '[[2020, 500]]', // Only 1 data point
      }),
    ];
    const result = buildMetroAreaFeatures(features)!;
    const props = result.features[0].properties as any;
    // Single data point → not enough for a trend, should not be included
    expect(props.population_history).toBeUndefined();
  });
});
