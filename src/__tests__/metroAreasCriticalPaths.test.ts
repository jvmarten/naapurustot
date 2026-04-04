/**
 * Metro areas — critical path tests for union fallback, cache invalidation,
 * trend aggregation weighted mode, and sparse data scenarios.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildMetroAreaFeatures,
  clearMetroAreaCache,
} from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

function makePolygonFeature(
  city: string,
  coords: number[][][],
  props: Partial<NeighborhoodProperties> = {},
): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: coords },
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city,
      he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
  };
}

const SIMPLE_POLYGON: number[][][] = [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]];
const SIMPLE_POLYGON2: number[][][] = [[[25.0, 60.1], [25.05, 60.1], [25.05, 60.15], [25.0, 60.15], [25.0, 60.1]]];

beforeEach(() => {
  clearMetroAreaCache();
});

describe('buildMetroAreaFeatures — union fallback path', () => {
  it('creates metro area features without @turf/union (MultiPolygon concat)', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100' }),
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON2, { pno: '00200' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(1);
    expect(result!.features[0].properties!._isMetroArea).toBe(true);
    expect(result!.features[0].properties!.city).toBe('helsinki_metro');
    // Geometry should be either Polygon or MultiPolygon
    const geom = result!.features[0].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });

  it('handles single-polygon city (no union needed)', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result!.features).toHaveLength(1);
    // Single polygon should keep its original geometry
    expect(result!.features[0].geometry.type).toBe('Polygon');
  });
});

describe('buildMetroAreaFeatures — cache behavior', () => {
  it('reuses cache when called with same features array', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100', hr_mtu: 30000 }),
    ];
    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Same geometry reference (cache hit)
    expect(result1!.features[0].geometry).toBe(result2!.features[0].geometry);
  });

  it('invalidates cache after clearMetroAreaCache()', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100', hr_mtu: 30000 }),
    ];
    const result1 = buildMetroAreaFeatures(features);

    // Mutate properties in-place (simulates quality index recomputation)
    (features[0].properties as NeighborhoodProperties).hr_mtu = 50000;
    clearMetroAreaCache();

    const result2 = buildMetroAreaFeatures(features);
    // After cache clear, averages should reflect updated data
    expect(result2!.features[0].properties!.hr_mtu).toBe(50000);
    expect(result1!.features[0].properties!.hr_mtu).toBe(30000);
  });

  it('invalidates cache when features array reference changes', () => {
    const features1 = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100', hr_mtu: 20000 }),
    ];
    const features2 = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100', hr_mtu: 40000 }),
    ];
    const r1 = buildMetroAreaFeatures(features1);
    const r2 = buildMetroAreaFeatures(features2);
    expect(r1!.features[0].properties!.hr_mtu).toBe(20000);
    expect(r2!.features[0].properties!.hr_mtu).toBe(40000);
  });
});

describe('buildMetroAreaFeatures — multiple cities', () => {
  it('creates separate features for each city', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100' }),
      makePolygonFeature('turku', SIMPLE_POLYGON2, { pno: '20100' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result!.features).toHaveLength(2);
    const cities = result!.features.map(f => f.properties!.city).sort();
    expect(cities).toEqual(['helsinki_metro', 'turku']);
  });

  it('excludes unknown city codes', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100' }),
      makePolygonFeature('fakecity', SIMPLE_POLYGON2, { pno: '99999' }),
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result!.features).toHaveLength(1);
    expect(result!.features[0].properties!.city).toBe('helsinki_metro');
  });
});

describe('buildMetroAreaFeatures — trend history aggregation', () => {
  it('aggregates population_history by summing per year', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, {
        pno: '00100',
        he_vakiy: 1000,
        population_history: JSON.stringify([[2020, 900], [2021, 1000]]),
      }),
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON2, {
        pno: '00200',
        he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;
    const popHistory = JSON.parse(props.population_history as string);
    // Summed: [2020, 2700], [2021, 3000]
    expect(popHistory).toEqual([[2020, 2700], [2021, 3000]]);
  });

  it('aggregates income_history as population-weighted average', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, {
        pno: '00100',
        he_vakiy: 1000,
        income_history: JSON.stringify([[2020, 30000], [2021, 32000]]),
      }),
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON2, {
        pno: '00200',
        he_vakiy: 3000,
        income_history: JSON.stringify([[2020, 40000], [2021, 42000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;
    const incHistory = JSON.parse(props.income_history as string);
    // Weighted: 2020: (30000*1000 + 40000*3000) / 4000 = 150000000/4000 = 37500
    // 2021: (32000*1000 + 42000*3000) / 4000 = 158000000/4000 = 39500
    expect(incHistory[0][1]).toBe(37500);
    expect(incHistory[1][1]).toBe(39500);
  });

  it('skips year in sum mode when fewer than 50% have data', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, {
        pno: '00100',
        he_vakiy: 1000,
        population_history: JSON.stringify([[2019, 800], [2020, 900], [2021, 1000]]),
      }),
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON2, {
        pno: '00200',
        he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
      makePolygonFeature('helsinki_metro', [[[25.1, 60.1], [25.15, 60.1], [25.15, 60.15], [25.1, 60.15], [25.1, 60.1]]], {
        pno: '00300',
        he_vakiy: 1500,
        population_history: JSON.stringify([[2020, 1400], [2021, 1500]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;
    const popHistory = JSON.parse(props.population_history as string);
    // 2019: only 1 of 3 (33%) has data — below 50% threshold → excluded
    // 2020: all 3 have data → included
    // 2021: all 3 have data → included
    const years = popHistory.map((p: [number, number]) => p[0]);
    expect(years).not.toContain(2019);
    expect(years).toContain(2020);
    expect(years).toContain(2021);
  });

  it('omits trend history when fewer than 2 aggregated data points', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, {
        pno: '00100',
        he_vakiy: 1000,
        population_history: JSON.stringify([[2021, 1000]]),
      }),
    ];
    // parseTrendSeries returns null for single-element array
    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;
    expect(props.population_history).toBeUndefined();
  });

  it('skips neighborhoods with zero population for trend aggregation', () => {
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, {
        pno: '00100',
        he_vakiy: 0,
        income_history: JSON.stringify([[2020, 99999], [2021, 99999]]),
      }),
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON2, {
        pno: '00200',
        he_vakiy: 1000,
        income_history: JSON.stringify([[2020, 30000], [2021, 35000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;
    const incHistory = JSON.parse(props.income_history as string);
    // Only the second feature contributes (pop=0 is skipped)
    expect(incHistory[0][1]).toBe(30000);
    expect(incHistory[1][1]).toBe(35000);
  });
});

describe('buildMetroAreaFeatures — geometry edge cases', () => {
  it('handles mixed Polygon and MultiPolygon in same city', () => {
    const multiPolyFeature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [SIMPLE_POLYGON, SIMPLE_POLYGON2],
      },
      properties: {
        pno: '00200', nimi: 'Test2', namn: 'Test2', kunta: '091',
        city: 'helsinki_metro', he_vakiy: 500,
      } as NeighborhoodProperties,
    };
    const features = [
      makePolygonFeature('helsinki_metro', SIMPLE_POLYGON, { pno: '00100' }),
      multiPolyFeature as Feature,
    ];
    const result = buildMetroAreaFeatures(features);
    expect(result!.features).toHaveLength(1);
    // Should produce valid geometry
    const geom = result!.features[0].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });

  it('skips city with only non-polygon features', () => {
    const pointFeature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {
        pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091',
        city: 'helsinki_metro', he_vakiy: 1000,
      } as NeighborhoodProperties,
    };
    const result = buildMetroAreaFeatures([pointFeature]);
    expect(result!.features).toHaveLength(0);
  });

  it('returns empty FeatureCollection for empty input', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(0);
  });
});
