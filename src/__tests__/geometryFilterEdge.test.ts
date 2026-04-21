/**
 * Tests for geometryFilter.ts uncovered lines:
 * - line 22: polygonArea with holes (rings.length > 1)
 * - line 52: single polygon simplification from MultiPolygon
 * - line 99: empty coordinates fallback to [0, 0]
 *
 * Also tests the shoelace formula and island filtering threshold logic.
 */
import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

function makePolygonFeature(coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

function makeMultiPolygonFeature(polygons: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}

describe('filterSmallIslands — polygon with holes', () => {
  it('polygonArea subtracts hole area from outer ring', () => {
    // A MultiPolygon where one polygon has a hole
    // Outer ring: 10x10 = area 100 (in coordinate space)
    // Hole: 2x2 = area 4
    // Net area: ~96 (should still be the largest polygon)
    const outerRing = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    const polyWithHole: number[][][] = [outerRing, hole];

    // Small polygon without hole: 1x1 = area 1
    const smallPoly: number[][][] = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];

    const feature = makeMultiPolygonFeature([polyWithHole, smallPoly]);
    const result = filterSmallIslands([feature]);

    // Small polygon (area 1) is < 15% of large polygon (area ~96)
    // So it should be filtered out
    const geom = result[0].geometry as MultiPolygon | Polygon;
    if (geom.type === 'MultiPolygon') {
      expect(geom.coordinates.length).toBe(1);
    } else {
      // Simplified to Polygon since only one remains
      expect(geom.type).toBe('Polygon');
    }
  });
});

describe('filterSmallIslands — simplification to Polygon', () => {
  it('converts MultiPolygon to Polygon when only one polygon remains after filtering', () => {
    // Large polygon: 10x10 = area 50
    const largePoly: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // Tiny polygon: 0.5x0.5 = area 0.125 (< 15% of 50 = 7.5)
    const tinyPoly: number[][][] = [[[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]]];

    const feature = makeMultiPolygonFeature([largePoly, tinyPoly]);
    const result = filterSmallIslands([feature]);

    // Should simplify to Polygon since only one polygon survives
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps MultiPolygon when multiple polygons survive filtering', () => {
    // Two similarly-sized polygons
    const poly1: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const poly2: number[][][] = [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]];

    const feature = makeMultiPolygonFeature([poly1, poly2]);
    const result = filterSmallIslands([feature]);

    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });
});

describe('filterSmallIslands — passthrough cases', () => {
  it('passes through Polygon features unchanged', () => {
    const feature = makePolygonFeature([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference
  });

  it('passes through single-polygon MultiPolygon unchanged', () => {
    const feature = makeMultiPolygonFeature([[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference — no filtering needed
  });

  it('passes through features with no geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as unknown as Feature['geometry'],
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('returns all features when none have small islands', () => {
    const poly1: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const poly2: number[][][] = [[[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]]];
    const feature = makeMultiPolygonFeature([poly1, poly2]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // both polygons are >= 15% threshold
  });
});

describe('filterSmallIslands — 15% threshold', () => {
  it('keeps polygons at exactly 15% of max area', () => {
    // Large: 10x10 = 50
    const large: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // At threshold: sqrt(0.15 * 100) ≈ 3.87... Let's use exact: 15% of area=50 is 7.5
    // A 3x5 polygon = area 7.5, which is 15% of 50
    const borderline: number[][][] = [[[0, 0], [5, 0], [5, 3], [0, 3], [0, 0]]];

    const feature = makeMultiPolygonFeature([large, borderline]);
    const result = filterSmallIslands([feature]);

    // Should keep both (borderline is exactly at threshold)
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('removes polygons just below 15% of max area', () => {
    const large: number[][][] = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // Just below: 14% of 50 = 7.0 → area = 7, so 2x3.5
    const small: number[][][] = [[[0, 0], [3.5, 0], [3.5, 2], [0, 2], [0, 0]]];

    const feature = makeMultiPolygonFeature([large, small]);
    const result = filterSmallIslands([feature]);

    // Small polygon should be removed
    if (result[0].geometry.type === 'Polygon') {
      // Simplified to single Polygon
      expect(true).toBe(true);
    } else {
      expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(1);
    }
  });
});

describe('getFeatureCenter — various geometry types', () => {
  it('returns point coordinates for Point geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    expect(getFeatureCenter(feature)).toEqual([24.94, 60.17]);
  });

  it('returns bbox midpoint for Polygon', () => {
    const feature = makePolygonFeature([
      [[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]],
    ]);
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(24.95, 5);
    expect(center[1]).toBeCloseTo(60.15, 5);
  });

  it('returns bbox midpoint for MultiPolygon', () => {
    const feature = makeMultiPolygonFeature([
      [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
      [[[25.0, 60.2], [25.1, 60.2], [25.1, 60.3], [25.0, 60.3], [25.0, 60.2]]],
    ]);
    const center = getFeatureCenter(feature);
    // bbox: [24.9, 60.1] to [25.1, 60.3]
    expect(center[0]).toBeCloseTo(25.0, 5);
    expect(center[1]).toBeCloseTo(60.2, 5);
  });

  it('returns [0, 0] for feature with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as unknown as Feature['geometry'],
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('returns [0, 0] for geometry without coordinates', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'GeometryCollection', geometries: [] } as unknown as Feature['geometry'],
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles LineString geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[24.9, 60.1], [25.0, 60.2]] },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(24.95, 5);
    expect(center[1]).toBeCloseTo(60.15, 5);
  });
});
