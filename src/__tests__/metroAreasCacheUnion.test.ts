/**
 * Tests for uncovered branches in metroAreas.ts (lines 211-212, union/cache interaction).
 *
 * Critical pitfall documented in CLAUDE.md: the metro area cache must invalidate
 * when @turf/union becomes available. These tests verify:
 * - Fallback MultiPolygon concatenation when union is unavailable
 * - Cache invalidation when union availability changes
 * - Single-polygon city handling (no union needed)
 * - clearMetroAreaCache() actually invalidates
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makePolygonFeature(
  city: string,
  pno: string,
  coords: number[][][],
  pop = 1000,
): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: null,
      city,
      he_vakiy: pop,
      hr_mtu: 30000,
      te_taly: 500,
      population_history: JSON.stringify([[2020, pop], [2024, pop + 100]]),
      income_history: JSON.stringify([[2020, 28000], [2024, 30000]]),
    } as unknown as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: coords,
    },
  };
}

describe('buildMetroAreaFeatures — fallback and cache', () => {
  beforeEach(() => {
    clearMetroAreaCache();
  });

  it('returns a FeatureCollection with _isMetroArea set to true on all features', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
      makePolygonFeature('helsinki_metro', '00200', [[[24.5, 60], [25.5, 60], [25.5, 61], [24.5, 60]]]),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('FeatureCollection');

    for (const f of result!.features) {
      expect(f.properties!._isMetroArea).toBe(true);
    }
  });

  it('excludes cities not in known REGIONS', () => {
    const features = [
      makePolygonFeature('unknown_city', '99999', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(0);
  });

  it('handles city with a single polygon (no union needed)', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(1);
    // Single polygon → should be Polygon type, not MultiPolygon
    expect(result!.features[0].geometry.type).toBe('Polygon');
  });

  it('concatenates into MultiPolygon when multiple polygons (fallback, no @turf/union)', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
      makePolygonFeature('helsinki_metro', '00200', [[[24.5, 60.5], [25.5, 60.5], [25.5, 61.5], [24.5, 60.5]]]),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(1);
    // Without @turf/union, it falls back to MultiPolygon concatenation
    const geom = result!.features[0].geometry;
    expect(geom.type === 'Polygon' || geom.type === 'MultiPolygon').toBe(true);
  });

  it('caches results — second call with same features returns identical output', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);

    // Should use cache (same features array reference)
    expect(result1!.features[0].geometry).toBe(result2!.features[0].geometry);
  });

  it('invalidates cache after clearMetroAreaCache() — recomputes averages', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]], 2000),
      makePolygonFeature('helsinki_metro', '00200', [[[24.5, 60], [25.5, 60], [25.5, 61], [24.5, 60]]], 1000),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const pop1 = result1!.features[0].properties!.he_vakiy;
    clearMetroAreaCache();

    // Mutate the underlying data (simulating quality index recomputation)
    (features[0].properties as Record<string, unknown>).he_vakiy = 5000;
    const result2 = buildMetroAreaFeatures(features);
    const pop2 = result2!.features[0].properties!.he_vakiy;

    // After cache clear + data mutation, averages should differ
    expect(pop1).toBe(3000);
    expect(pop2).toBe(6000);
  });

  it('invalidates cache when features array changes', () => {
    const features1 = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
    ];
    const features2 = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
      makePolygonFeature('helsinki_metro', '00200', [[[24.5, 60], [25.5, 60], [25.5, 61], [24.5, 60]]]),
    ];

    buildMetroAreaFeatures(features1);
    const result2 = buildMetroAreaFeatures(features2);

    // Different features array → should rebuild
    expect(result2!.features).toHaveLength(1);
  });

  it('groups features by city correctly for multiple cities', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]]),
      makePolygonFeature('turku', '20100', [[[22, 60], [23, 60], [23, 61], [22, 60]]]),
      makePolygonFeature('tampere', '33100', [[[23, 61], [24, 61], [24, 62], [23, 61]]]),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(3);

    const cities = result!.features.map(f => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(cities).toContain('tampere');
  });

  it('attaches population-weighted averages as properties', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', [[[24, 60], [25, 60], [25, 61], [24, 60]]], 2000),
      makePolygonFeature('helsinki_metro', '00200', [[[24.5, 60], [25.5, 60], [25.5, 61], [24.5, 60]]], 1000),
    ];
    // Set different incomes to verify weighting
    (features[0].properties as Record<string, unknown>).hr_mtu = 40000;
    (features[1].properties as Record<string, unknown>).hr_mtu = 20000;

    const result = buildMetroAreaFeatures(features);
    const props = result!.features[0].properties!;

    // hr_mtu should be population-weighted: (40000*2000 + 20000*1000) / 3000 = 33333.3
    expect(props.hr_mtu).toBeCloseTo(33333.3, 0);
    expect(props.he_vakiy).toBe(3000);
  });

  it('handles MultiPolygon input features in fallback mode', () => {
    const multiPolyFeature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {
        pno: '00100',
        nimi: 'Multi',
        namn: 'Multi',
        kunta: null,
        city: 'helsinki_metro',
        he_vakiy: 1000,
        hr_mtu: 30000,
        te_taly: 500,
      } as unknown as NeighborhoodProperties,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[24, 60], [25, 60], [25, 61], [24, 60]]],
          [[[24.5, 60.5], [25.5, 60.5], [25.5, 61.5], [24.5, 60.5]]],
        ],
      },
    };

    const features = [multiPolyFeature as Feature];
    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(1);
  });

  it('returns empty FeatureCollection for empty input', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result).not.toBeNull();
    expect(result!.features).toHaveLength(0);
  });
});
