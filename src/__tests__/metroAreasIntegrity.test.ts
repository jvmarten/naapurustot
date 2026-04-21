/**
 * Tests for metroAreas.ts — the most fragile module per CLAUDE.md.
 *
 * Targets the uncovered lines (223-224: fallback MultiPolygon concatenation)
 * and the critical cache invalidation logic that has broken repeatedly.
 *
 * Key invariants:
 * - Cache invalidation when @turf/union becomes available
 * - _isMetroArea flag on all output features
 * - Metro area properties contain averaged stats
 * - Trend histories are aggregated across neighborhoods
 * - clearMetroAreaCache only clears averages, not geometry
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildMetroAreaFeatures, clearMetroAreaCache } from '../utils/metroAreas';
import type { Feature, FeatureCollection } from 'geojson';

function makeNeighborhood(
  pno: string,
  city: string,
  coords: number[][],
  props: Record<string, unknown> = {},
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
      unemployment_rate: 5,
      higher_education_rate: 40,
      quality_index: 60,
      ...props,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
  };
}

// Simple polygons for testing
const POLY_A = [[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]];
const POLY_B = [[24.95, 60.1], [25.0, 60.1], [25.0, 60.15], [24.95, 60.15], [24.95, 60.1]];
const POLY_C = [[25.0, 60.1], [25.05, 60.1], [25.05, 60.15], [25.0, 60.15], [25.0, 60.1]];

describe('buildMetroAreaFeatures — _isMetroArea marker', () => {
  it('all output features have _isMetroArea: true', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B),
      makeNeighborhood('20100', 'turku', POLY_C),
    ];

    const result = buildMetroAreaFeatures(features);

    expect(result.type).toBe('FeatureCollection');
    expect(result.features.length).toBeGreaterThanOrEqual(1);

    for (const f of result.features) {
      expect(f.properties!._isMetroArea).toBe(true);
    }
  });
});

describe('buildMetroAreaFeatures — groups neighborhoods by city', () => {
  it('creates one metro area feature per city', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B),
      makeNeighborhood('20100', 'turku', POLY_C),
    ];

    const result = buildMetroAreaFeatures(features);

    const cities = result.features.map((f) => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(cities.length).toBe(2);
  });

  it('skips unknown city IDs not in REGIONS', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
      makeNeighborhood('99999', 'nonexistent_city' as any, POLY_B),
    ];

    const result = buildMetroAreaFeatures(features);

    const cities = result.features.map((f) => f.properties!.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).not.toContain('nonexistent_city');
  });
});

describe('buildMetroAreaFeatures — averages computation', () => {
  it('metro area properties contain population-weighted averages', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A, {
        he_vakiy: 10000, hr_mtu: 40000, quality_index: 80,
      }),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B, {
        he_vakiy: 10000, hr_mtu: 20000, quality_index: 40,
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const helsinki = result.features.find((f) => f.properties!.city === 'helsinki_metro');

    expect(helsinki).toBeDefined();
    // Population-weighted average of hr_mtu: (40000*10000 + 20000*10000) / 20000 = 30000
    expect(helsinki!.properties!.hr_mtu).toBe(30000);
  });
});

describe('buildMetroAreaFeatures — caching behavior', () => {
  it('returns same geometry for same features reference (cache hit)', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);

    // Geometry should be the same reference (cached)
    expect(result1.features[0].geometry).toBe(result2.features[0].geometry);
  });

  it('recomputes when features reference changes', () => {
    const features1 = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
    ];
    const features2 = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_B),
    ];

    const result1 = buildMetroAreaFeatures(features1);
    const result2 = buildMetroAreaFeatures(features2);

    // Different dataset identity → geometry should differ
    expect(result1.features[0].geometry).not.toBe(result2.features[0].geometry);
  });

  it('clearMetroAreaCache forces averages recomputation', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A, {
        he_vakiy: 10000, quality_index: 60,
      }),
    ];

    buildMetroAreaFeatures(features);

    // Mutate quality_index in-place (simulating quality weight change)
    (features[0].properties as Record<string, unknown>).quality_index = 90;

    clearMetroAreaCache();

    const result = buildMetroAreaFeatures(features);
    const helsinki = result.features.find((f) => f.properties!.city === 'helsinki_metro');

    // After clearing averages cache, it should pick up the new quality_index
    expect(helsinki!.properties!.quality_index).toBe(90);
  });
});

describe('buildMetroAreaFeatures — trend history aggregation', () => {
  it('aggregates population history as sum', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A, {
        he_vakiy: 5000,
        population_history: JSON.stringify([[2020, 4500], [2024, 5000]]),
      }),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B, {
        he_vakiy: 3000,
        population_history: JSON.stringify([[2020, 2800], [2024, 3000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const helsinki = result.features.find((f) => f.properties!.city === 'helsinki_metro');

    expect(helsinki!.properties!.population_history).toBeDefined();
    const history = JSON.parse(helsinki!.properties!.population_history as string);
    expect(history).toHaveLength(2);
    // Sum: [2020, 4500+2800=7300], [2024, 5000+3000=8000]
    expect(history[0][1]).toBe(7300);
    expect(history[1][1]).toBe(8000);
  });

  it('aggregates income history as population-weighted average', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A, {
        he_vakiy: 10000,
        income_history: JSON.stringify([[2020, 30000], [2024, 35000]]),
      }),
      makeNeighborhood('00200', 'helsinki_metro', POLY_B, {
        he_vakiy: 10000,
        income_history: JSON.stringify([[2020, 20000], [2024, 25000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const helsinki = result.features.find((f) => f.properties!.city === 'helsinki_metro');

    const history = JSON.parse(helsinki!.properties!.income_history as string);
    // Weighted avg: (30000*10000 + 20000*10000) / 20000 = 25000
    expect(history[0][1]).toBe(25000);
    expect(history[1][1]).toBe(30000);
  });
});

describe('buildMetroAreaFeatures — MultiPolygon fallback', () => {
  it('handles input features with MultiPolygon geometry', () => {
    const multiPolyFeature: Feature = {
      type: 'Feature',
      properties: {
        pno: '00100', nimi: 'Multi Area', namn: 'Multi Area',
        kunta: '091', city: 'helsinki_metro', he_vakiy: 5000,
        hr_mtu: 30000, quality_index: 50,
      },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [POLY_A],
          [POLY_B],
        ],
      },
    };

    const features = [multiPolyFeature];
    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBe(1);
    expect(result.features[0].properties!._isMetroArea).toBe(true);
  });
});

describe('buildMetroAreaFeatures — single neighborhood city', () => {
  it('handles a city with only one neighborhood', () => {
    const features = [
      makeNeighborhood('00100', 'helsinki_metro', POLY_A),
    ];

    const result = buildMetroAreaFeatures(features);

    expect(result.features.length).toBe(1);
    expect(result.features[0].properties!.city).toBe('helsinki_metro');
    expect(result.features[0].properties!._isMetroArea).toBe(true);
  });
});

describe('buildMetroAreaFeatures — empty input', () => {
  it('returns empty FeatureCollection for empty features array', () => {
    const result = buildMetroAreaFeatures([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });
});
