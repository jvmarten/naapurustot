import { describe, it, expect } from 'vitest';
import { buildMetroAreaFeatures } from '../utils/metroAreas';
import type { Feature } from 'geojson';

function makeFeature(city: string, props: Record<string, unknown> = {}): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
    properties: {
      pno: props.pno ?? '00100',
      nimi: props.nimi ?? 'Test',
      namn: props.namn ?? 'Test',
      kunta: null,
      city,
      he_vakiy: 1000,
      ...props,
    },
  };
}

describe('buildMetroAreaFeatures', () => {
  it('returns empty features for empty input', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('creates one feature per city with data', () => {
    const features = [
      makeFeature('helsinki_metro', { pno: '00100' }),
      makeFeature('helsinki_metro', { pno: '00200' }),
      makeFeature('turku', { pno: '20100' }),
    ];
    const result = buildMetroAreaFeatures(features);
    // Should have helsinki_metro and turku, not tampere (no features)
    const cities = result.features.map((f) => (f.properties as any).city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(cities).not.toContain('tampere');
  });

  it('marks all features with _isMetroArea: true', () => {
    const features = [
      makeFeature('helsinki_metro', { pno: '00100' }),
      makeFeature('turku', { pno: '20100' }),
    ];
    const result = buildMetroAreaFeatures(features);
    for (const f of result.features) {
      expect((f.properties as any)._isMetroArea).toBe(true);
    }
  });

  it('uses city id as pno', () => {
    const features = [
      makeFeature('tampere', { pno: '33100' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features).toHaveLength(1);
    expect((result.features[0].properties as any).pno).toBe('tampere');
  });

  it('skips features with non-polygon geometry types', () => {
    const features = [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [24.9, 60.1] },
        properties: { pno: '00100', nimi: 'Test', city: 'helsinki_metro', he_vakiy: 1000 },
      },
    ];
    const result = buildMetroAreaFeatures(features);
    // Point geometry is not Polygon/MultiPolygon, so city has 0 poly features → no metro area
    expect(result.features).toHaveLength(0);
  });

  it('includes population-weighted averages in properties', () => {
    const features = [
      makeFeature('helsinki_metro', {
        pno: '00100', he_vakiy: 1000, hr_mtu: 30000,
      }),
      makeFeature('helsinki_metro', {
        pno: '00200', he_vakiy: 3000, hr_mtu: 40000,
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const hki = result.features.find((f) => (f.properties as any).city === 'helsinki_metro');
    expect(hki).toBeDefined();
    // (30000*1000 + 40000*3000) / 4000 = 37500
    expect((hki!.properties as any).hr_mtu).toBe(37500);
    expect((hki!.properties as any).he_vakiy).toBe(4000);
  });

  it('caches results and returns same geometry on subsequent calls', () => {
    const features = [
      makeFeature('helsinki_metro', { pno: '00100' }),
    ];
    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);
    // Same input array reference → cached
    expect(result2.features[0].geometry).toBe(result1.features[0].geometry);
  });

  it('invalidates cache when features array reference changes', () => {
    const features1 = [
      makeFeature('helsinki_metro', { pno: '00100', he_vakiy: 1000 }),
    ];
    const result1 = buildMetroAreaFeatures(features1);

    const features2 = [
      makeFeature('helsinki_metro', { pno: '00100', he_vakiy: 2000 }),
    ];
    const result2 = buildMetroAreaFeatures(features2);

    // Population should reflect the new data
    expect((result2.features[0].properties as any).he_vakiy).toBe(2000);
    // Old result should still have old value
    expect((result1.features[0].properties as any).he_vakiy).toBe(1000);
  });

  it('aggregates trend histories into metro features', () => {
    const features = [
      makeFeature('turku', {
        pno: '20100', he_vakiy: 1000,
        population_history: '[[2018, 900], [2020, 1000]]',
        income_history: '[[2018, 25000], [2020, 28000]]',
      }),
      makeFeature('turku', {
        pno: '20200', he_vakiy: 1000,
        population_history: '[[2018, 800], [2020, 1000]]',
        income_history: '[[2018, 30000], [2020, 32000]]',
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const turku = result.features.find((f) => (f.properties as any).city === 'turku');
    expect(turku).toBeDefined();

    // population_history should be summed
    const popHistory = JSON.parse((turku!.properties as any).population_history);
    expect(popHistory).toHaveLength(2);
    expect(popHistory[0][1]).toBe(1700); // 900+800
    expect(popHistory[1][1]).toBe(2000); // 1000+1000

    // income_history should be population-weighted average
    const incHistory = JSON.parse((turku!.properties as any).income_history);
    expect(incHistory).toHaveLength(2);
    // 2018: (25000*1000 + 30000*1000) / 2000 = 27500
    expect(incHistory[0][1]).toBe(27500);
  });

  it('skips features with unknown city', () => {
    const features = [
      makeFeature('unknown_city', { pno: '99999' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features).toHaveLength(0);
  });
});
