/**
 * Geometry filter — critical path tests for degenerate polygons,
 * all-polygons-filtered-out scenario, MultiPolygon-to-Polygon conversion,
 * and getFeatureCenter with various geometry types.
 */
import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon, LineString } from 'geojson';

function makeMultiPolygonFeature(coordinates: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates },
    properties: { pno: '00100' },
  };
}

describe('filterSmallIslands — critical edge cases', () => {
  it('preserves single Polygon features unchanged', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // Same reference — no modification
  });

  it('preserves MultiPolygon with single polygon', () => {
    const feature = makeMultiPolygonFeature([
      [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
    ]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // Same reference
  });

  it('filters out tiny island but keeps large polygon', () => {
    // Large polygon: area ≈ 100
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // Tiny polygon: area ≈ 1 (1% of large → below 15% threshold)
    const tiny = [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]];

    const feature = makeMultiPolygonFeature([large, tiny]);
    const result = filterSmallIslands([feature]);

    // Should remove tiny island, convert to single Polygon
    expect(result[0].geometry.type).toBe('Polygon');
    expect((result[0].geometry as Polygon).coordinates).toEqual(large);
  });

  it('keeps both polygons when small one is above 15% threshold', () => {
    // Large polygon: area ≈ 100
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // Medium polygon: area ≈ 25 (25% of large → above 15% threshold)
    const medium = [[[20, 20], [25, 20], [25, 25], [20, 25], [20, 20]]];

    const feature = makeMultiPolygonFeature([large, medium]);
    const result = filterSmallIslands([feature]);

    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  it('converts to Polygon when only one polygon survives filtering', () => {
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tiny1 = [[[20, 20], [20.1, 20], [20.1, 20.1], [20, 20.1], [20, 20]]];
    const tiny2 = [[[30, 30], [30.1, 30], [30.1, 30.1], [30, 30.1], [30, 30]]];

    const feature = makeMultiPolygonFeature([large, tiny1, tiny2]);
    const result = filterSmallIslands([feature]);

    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('handles polygon with holes (hole area subtracted from outer ring)', () => {
    // Outer ring: area ≈ 100
    const outerRing = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    // Hole: area ≈ 4
    const hole = [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]];
    const withHole = [outerRing, hole];

    // Second polygon: area ≈ 16 (which is 16% of net 96 → above threshold)
    const second = [[[20, 20], [24, 20], [24, 24], [20, 24], [20, 20]]];

    const feature = makeMultiPolygonFeature([withHole, second]);
    const result = filterSmallIslands([feature]);

    // Both should survive since 16 >= (100-4)*0.15 = 14.4
    expect(result[0].geometry.type).toBe('MultiPolygon');
  });

  it('preserves non-geometry features', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as Polygon,
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles Point geometry (returns unchanged)', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('processes multiple features independently', () => {
    const features = [
      makeMultiPolygonFeature([
        [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
        [[[20, 20], [20.1, 20], [20.1, 20.1], [20, 20.1], [20, 20]]],
      ]),
      makeMultiPolygonFeature([
        [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
        [[[10, 10], [15, 10], [15, 15], [10, 15], [10, 10]]],
      ]),
    ];
    const result = filterSmallIslands(features);
    // First: tiny island removed → Polygon
    expect(result[0].geometry.type).toBe('Polygon');
    // Second: both similar size → stays MultiPolygon
    expect(result[1].geometry.type).toBe('MultiPolygon');
  });
});

describe('getFeatureCenter — geometry types', () => {
  it('returns coordinates for Point geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([24.9, 60.2]);
  });

  it('returns bbox midpoint for Polygon', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[20, 60], [30, 60], [30, 70], [20, 70], [20, 60]]],
      },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([25, 65]);
  });

  it('returns bbox midpoint for MultiPolygon', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
        ],
      },
      properties: {},
    };
    // Bbox: [0,0] to [30,30] → center [15, 15]
    expect(getFeatureCenter(feature)).toEqual([15, 15]);
  });

  it('returns bbox midpoint for LineString', () => {
    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[10, 20], [30, 40]],
      },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([20, 30]);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as Polygon,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles polygon with very small bounding box', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.9999, 60.0001], [25.0001, 60.0001], [25.0001, 60.0003], [24.9999, 60.0003], [24.9999, 60.0001]]],
      },
      properties: {},
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(25.0, 3);
    expect(center[1]).toBeCloseTo(60.0002, 3);
  });
});
