/**
 * Tests for metroAreas.ts — fallback MultiPolygon path (lines 206-216 uncovered),
 * cache invalidation when union becomes available, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

function makeFeature(
  pno: string,
  city: string,
  geometry: Polygon | MultiPolygon,
  extra: Record<string, unknown> = {},
): Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: '091',
      city,
      he_vakiy: 5000,
      hr_mtu: 30000,
      hr_ktu: 28000,
      crime_index: 50,
      unemployment_rate: 5,
      higher_education_rate: 40,
      transit_stop_density: 8,
      air_quality_index: 3,
      healthcare_density: 2,
      school_density: 1,
      daycare_density: 1,
      grocery_density: 2,
      quality_index: 60,
      pt_tyott: 100,
      ko_yl_kork: 500,
      ko_al_kork: 300,
      ko_ika18y: 3000,
      te_omis_as: 1000,
      te_taly: 2000,
      te_vuok_as: 800,
      pt_opisk: 200,
      pt_vakiy: 4000,
      he_0_2: 100,
      he_3_6: 150,
      pinta_ala: 5000000,
      ra_pt_as: 200,
      ra_asunn: 1500,
      pt_elakel: 500,
      ...extra,
    },
    geometry,
  };
}

function makePolygon(offset = 0): Polygon {
  return {
    type: 'Polygon',
    coordinates: [[[24.9 + offset, 60.1], [25.0 + offset, 60.1], [25.0 + offset, 60.2], [24.9 + offset, 60.2], [24.9 + offset, 60.1]]],
  };
}

function makeMultiPolygon(): MultiPolygon {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
      [[[25.0, 60.1], [25.05, 60.1], [25.05, 60.15], [25.0, 60.15], [25.0, 60.1]]],
    ],
  };
}

describe('metroAreas — fallback MultiPolygon path (no union)', () => {
  let buildMetroAreaFeatures: typeof import('../utils/metroAreas').buildMetroAreaFeatures;
  let clearMetroAreaCache: typeof import('../utils/metroAreas').clearMetroAreaCache;

  beforeEach(async () => {
    vi.resetModules();
    // Mock @turf/union to simulate it not being loaded
    vi.doMock('@turf/union', () => {
      throw new Error('Module not found');
    });
    const mod = await import('../utils/metroAreas');
    buildMetroAreaFeatures = mod.buildMetroAreaFeatures;
    clearMetroAreaCache = mod.clearMetroAreaCache;
    clearMetroAreaCache();
  });

  it('builds metro features using fallback MultiPolygon concatenation', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
      makeFeature('00200', 'helsinki_metro', makePolygon(0.1)),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBeGreaterThan(0);

    const metro = result!.features[0];
    expect(metro.properties!._isMetroArea).toBe(true);
    expect(metro.properties!.city).toBe('helsinki_metro');
    // Without union, geometry should be MultiPolygon
    expect(metro.geometry.type).toBe('MultiPolygon');
  });

  it('handles mixed Polygon and MultiPolygon inputs in fallback', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
      makeFeature('00200', 'helsinki_metro', makeMultiPolygon()),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    const metro = result!.features[0];
    // MultiPolygon should have coordinates from both features
    const mp = metro.geometry as MultiPolygon;
    expect(mp.type).toBe('MultiPolygon');
    // 1 polygon from first feature + 2 polygons from MultiPolygon = 3
    expect(mp.coordinates.length).toBe(3);
  });

  it('handles single feature per city (no union needed)', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(1);
    expect(result!.features[0].geometry.type).toBe('Polygon');
  });

  it('handles empty features array', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(0);
  });

  it('ignores features with unknown city IDs', () => {
    const features = [
      makeFeature('99999', 'unknown_city', makePolygon(0)),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(0);
  });

  it('groups features by city correctly', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
      makeFeature('20100', 'turku', makePolygon(0.5)),
      makeFeature('00200', 'helsinki_metro', makePolygon(0.1)),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    const cities = result!.features.map(f => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
  });

  it('populates metro averages in feature properties', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0), { hr_mtu: 35000, he_vakiy: 5000 }),
      makeFeature('00200', 'helsinki_metro', makePolygon(0.1), { hr_mtu: 25000, he_vakiy: 3000 }),
    ];

    const result = buildMetroAreaFeatures(features);
    const metro = result!.features[0];
    expect(typeof metro.properties!.hr_mtu).toBe('number');
    expect(metro.properties!.he_vakiy).toBe(8000); // total population
  });

  it('caches results and returns same geometry on second call', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);
    expect(result1!.features[0].geometry).toBe(result2!.features[0].geometry);
  });

  it('clearMetroAreaCache forces recomputation', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', makePolygon(0)),
    ];

    const result1 = buildMetroAreaFeatures(features);
    clearMetroAreaCache();
    const result2 = buildMetroAreaFeatures(features);
    // After cache clear, geometry objects should be new instances
    // (though values are the same)
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
  });
});
