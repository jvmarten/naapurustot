import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { Feature, Polygon } from 'geojson';

function makeFeature(cityId: string, pno: string, overrides: Record<string, unknown> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    properties: {
      pno, nimi: `N-${pno}`, namn: `N-${pno}`, city: cityId, kunta: '091', he_vakiy: 1000, hr_mtu: 30000,
      ...overrides,
    },
  };
}

beforeEach(() => { clearMetroAreaCache(); });

describe('buildMetroAreaFeatures — core behavior', () => {
  it('groups features by city', () => {
    const features = [
      makeFeature('helsinki_metro', '00100'), makeFeature('helsinki_metro', '00200'),
      makeFeature('turku', '20100'), makeFeature('turku', '20200'),
    ];
    const result = buildMetroAreaFeatures(features);
    const cities = result.features.map(f => f.properties?.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(result.features.length).toBe(2);
  });

  it('marks all features with _isMetroArea: true', () => {
    const result = buildMetroAreaFeatures([makeFeature('helsinki_metro', '00100')]);
    expect(result.features[0].properties?._isMetroArea).toBe(true);
  });

  it('attaches population-weighted averages', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', { he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature('helsinki_metro', '00200', { he_vakiy: 3000, hr_mtu: 40000 }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features[0].properties?.hr_mtu).toBe(37500);
  });

  it('ignores unknown city IDs', () => {
    const features = [
      makeFeature('unknown_city' as any, '99999'),
      makeFeature('helsinki_metro', '00100'),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result.features.map(f => f.properties?.city)).not.toContain('unknown_city');
  });

  it('returns empty for empty input', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.features).toHaveLength(0);
    expect(result.type).toBe('FeatureCollection');
  });
});

describe('buildMetroAreaFeatures — caching', () => {
  it('reuses geometry for same dataset', () => {
    const features = [makeFeature('helsinki_metro', '00100'), makeFeature('helsinki_metro', '00200')];
    const r1 = buildMetroAreaFeatures(features);
    const r2 = buildMetroAreaFeatures(features);
    expect(r1.features[0].geometry).toBe(r2.features[0].geometry);
  });

  it('recomputes averages after clearMetroAreaCache()', () => {
    const features = [makeFeature('helsinki_metro', '00100', { he_vakiy: 1000, hr_mtu: 30000 })];
    const r1 = buildMetroAreaFeatures(features);
    (features[0].properties as any).quality_index = 99;
    clearMetroAreaCache();
    const r2 = buildMetroAreaFeatures(features);
    expect(r2.features[0].geometry).toBe(r1.features[0].geometry);
  });

  it('invalidates cache when dataset reference changes', () => {
    buildMetroAreaFeatures([makeFeature('helsinki_metro', '00100', { hr_mtu: 30000 })]);
    const r2 = buildMetroAreaFeatures([makeFeature('helsinki_metro', '00100', { hr_mtu: 50000 })]);
    expect(r2.features[0].properties?.hr_mtu).toBe(50000);
  });
});

describe('buildMetroAreaFeatures — trend aggregation', () => {
  it('aggregates population history as sum', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', {
        he_vakiy: 1000, population_history: JSON.stringify([[2020, 900], [2021, 1000]]),
      }),
      makeFeature('helsinki_metro', '00200', {
        he_vakiy: 2000, population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const history = JSON.parse(result.features[0].properties?.population_history as string);
    expect(history).toEqual([[2020, 2700], [2021, 3000]]);
  });

  it('aggregates income history as weighted average', () => {
    const features = [
      makeFeature('helsinki_metro', '00100', {
        he_vakiy: 1000, income_history: JSON.stringify([[2020, 30000], [2021, 32000]]),
      }),
      makeFeature('helsinki_metro', '00200', {
        he_vakiy: 3000, income_history: JSON.stringify([[2020, 40000], [2021, 42000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const history = JSON.parse(result.features[0].properties?.income_history as string);
    expect(history[0][1]).toBe(37500);
    expect(history[1][1]).toBe(39500);
  });

  it('handles no trend data gracefully', () => {
    const result = buildMetroAreaFeatures([makeFeature('helsinki_metro', '00100', { he_vakiy: 1000 })]);
    expect(result.features[0].properties?.population_history).toBeUndefined();
  });
});
