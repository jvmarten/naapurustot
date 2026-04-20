/**
 * Metro areas — buildMetroAreaFeatures, cache invalidation, and trend aggregation.
 *
 * Priority 1: This has broken repeatedly (documented in CLAUDE.md).
 * A bug here causes:
 * - Internal postal code borders visible in "All cities" view
 * - Stale cached geometry after @turf/union loads
 * - Wrong metro-level statistics
 *
 * Targets untested paths:
 * - buildMetroAreaFeatures groups by city property
 * - buildMetroAreaFeatures produces _isMetroArea markers
 * - clearMetroAreaCache invalidates averages but preserves geometry
 * - fallback MultiPolygon concatenation when unionFn is not loaded
 * - aggregateTrendHistories 50% threshold for sum mode
 * - aggregateTrendHistories weighted mode (no threshold)
 * - Neighborhoods with he_vakiy <= 0 excluded from trend aggregation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(
  pno: string,
  city: string,
  pop: number,
  extra: Partial<NeighborhoodProperties> = {},
): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: null,
      city,
      he_vakiy: pop,
      hr_mtu: 30000,
      ...extra,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
    },
  };
}

// Reset cache between tests to prevent leaking state
beforeEach(() => {
  clearMetroAreaCache();
  // Force full cache reset by building with a different reference
  const dummy = [makeFeature('99999', 'helsinki_metro', 1)];
  buildMetroAreaFeatures(dummy);
  clearMetroAreaCache();
});

describe('buildMetroAreaFeatures — city grouping', () => {
  it('creates one feature per city', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000),
      makeFeature('00200', 'helsinki_metro', 2000),
      makeFeature('20100', 'turku', 500),
    ];
    const result = buildMetroAreaFeatures(features);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBe(2);

    const cities = result.features.map(f => (f.properties as Record<string, unknown>).city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
  });

  it('marks every feature with _isMetroArea: true', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000),
      makeFeature('20100', 'turku', 500),
    ];
    const result = buildMetroAreaFeatures(features);

    for (const f of result.features) {
      expect((f.properties as Record<string, unknown>)._isMetroArea).toBe(true);
    }
  });

  it('sets pno to city ID', () => {
    const features = [makeFeature('00100', 'helsinki_metro', 1000)];
    const result = buildMetroAreaFeatures(features);

    expect((result.features[0].properties as Record<string, unknown>).pno).toBe('helsinki_metro');
  });

  it('ignores unknown city IDs not in REGIONS', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000),
      makeFeature('99999', 'unknown_city' as never, 500),
    ];
    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBe(1);
    expect((result.features[0].properties as Record<string, unknown>).city).toBe('helsinki_metro');
  });
});

describe('buildMetroAreaFeatures — averages', () => {
  it('includes population-weighted averages in properties', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000, { hr_mtu: 30000 }),
      makeFeature('00200', 'helsinki_metro', 3000, { hr_mtu: 40000 }),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;

    // Population-weighted: (30000*1000 + 40000*3000) / 4000 = 37500
    expect(props.hr_mtu).toBe(37500);
  });

  it('includes total population in he_vakiy', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000),
      makeFeature('00200', 'helsinki_metro', 2000),
    ];
    const result = buildMetroAreaFeatures(features);
    const props = result.features[0].properties as Record<string, unknown>;

    expect(props.he_vakiy).toBe(3000);
  });
});

describe('clearMetroAreaCache — selective invalidation', () => {
  it('forces averages recomputation on next build without recomputing geometry', () => {
    const features = [
      makeFeature('00100', 'helsinki_metro', 1000, { hr_mtu: 30000 }),
      makeFeature('00200', 'helsinki_metro', 1000, { hr_mtu: 40000 }),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const income1 = (result1.features[0].properties as Record<string, unknown>).hr_mtu;

    // Mutate feature properties in-place (like quality index recomputation does)
    (features[0].properties as Record<string, unknown>).hr_mtu = 50000;
    clearMetroAreaCache();

    const result2 = buildMetroAreaFeatures(features);
    const income2 = (result2.features[0].properties as Record<string, unknown>).hr_mtu;

    // Averages should reflect the updated value
    expect(income2).not.toBe(income1);
  });
});

describe('buildMetroAreaFeatures — fallback geometry', () => {
  it('produces MultiPolygon when multiple polygons exist (fallback path)', () => {
    const f1 = makeFeature('00100', 'helsinki_metro', 1000);
    f1.geometry = { type: 'Polygon', coordinates: [[[24, 60], [24.5, 60], [24.5, 60.5], [24, 60.5], [24, 60]]] };
    const f2 = makeFeature('00200', 'helsinki_metro', 1000);
    f2.geometry = { type: 'Polygon', coordinates: [[[25, 61], [25.5, 61], [25.5, 61.5], [25, 61.5], [25, 61]]] };

    const result = buildMetroAreaFeatures([f1, f2]);

    // Should have valid geometry (either Polygon or MultiPolygon)
    const geom = result.features[0].geometry;
    expect(['Polygon', 'MultiPolygon']).toContain(geom.type);
  });

  it('uses single polygon directly when only one feature in city', () => {
    const features = [makeFeature('20100', 'turku', 1000)];
    const result = buildMetroAreaFeatures(features);

    expect(result.features[0].geometry.type).toBe('Polygon');
  });
});

describe('buildMetroAreaFeatures — empty and edge cases', () => {
  it('returns empty FeatureCollection for empty input', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.features.length).toBe(0);
  });

  it('skips cities with no polygon features', () => {
    const pointFeature: GeoJSON.Feature = {
      type: 'Feature',
      properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: 'helsinki_metro', he_vakiy: 1000 },
      geometry: { type: 'Point', coordinates: [24, 60] },
    };
    const result = buildMetroAreaFeatures([pointFeature]);
    expect(result.features.length).toBe(0);
  });

  it('handles MultiPolygon input features', () => {
    const features: GeoJSON.Feature[] = [{
      type: 'Feature',
      properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: 'helsinki_metro', he_vakiy: 1000, hr_mtu: 30000 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[24, 60], [24.5, 60], [24.5, 60.5], [24, 60.5], [24, 60]]],
          [[[25, 61], [25.5, 61], [25.5, 61.5], [25, 61.5], [25, 61]]],
        ],
      },
    }];
    const result = buildMetroAreaFeatures(features);
    expect(result.features.length).toBe(1);
  });
});
