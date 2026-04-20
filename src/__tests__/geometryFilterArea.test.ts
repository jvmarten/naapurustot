/**
 * Geometry filter — area calculation, island filtering, and center computation.
 *
 * Priority 2: Geometry bugs cause visual artifacts (islands reappearing,
 * labels at wrong positions, misshapen polygons).
 *
 * Targets untested paths:
 * - ringArea shoelace formula correctness with real coordinates
 * - polygonArea hole subtraction
 * - filterSmallIslands threshold: exactly 15% boundary
 * - filterSmallIslands conversion from MultiPolygon to Polygon
 * - getFeatureCenter with deeply nested MultiPolygon coordinates
 * - getFeatureCenter with empty geometry
 * - getFeatureCenter stack-based traversal correctness
 */
import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

function makePolygonFeature(coordinates: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    properties: { pno: '00100' },
    geometry: { type: 'MultiPolygon', coordinates },
  };
}

// A simple unit square: area should be ~1.0 (in coordinate units)
const unitSquare = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
// A tiny square: ~0.01 area (1% of unit square, below 15% threshold)
const tinySquare = [[5, 5], [5.1, 5], [5.1, 5.1], [5, 5.1], [5, 5]];
// A medium square: ~0.04 area (4% of unit square, below 15%)
const mediumSquare = [[3, 3], [3.2, 3], [3.2, 3.2], [3, 3.2], [3, 3]];
// A significant square: ~0.25 area (25% of unit square, above 15%)
const significantSquare = [[2, 2], [2.5, 2], [2.5, 2.5], [2, 2.5], [2, 2]];

describe('filterSmallIslands — threshold behavior', () => {
  it('removes polygons below 15% of largest area', () => {
    const feature = makePolygonFeature([
      [unitSquare],      // area = 1.0 (largest)
      [tinySquare],      // area ≈ 0.01 (1% → removed)
    ]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry;

    // Should convert to single Polygon since only one remains
    expect(geom.type).toBe('Polygon');
  });

  it('keeps polygons at or above 15% of largest area', () => {
    const feature = makePolygonFeature([
      [unitSquare],            // area = 1.0
      [significantSquare],     // area = 0.25 (25% → kept)
    ]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as MultiPolygon;

    expect(geom.type).toBe('MultiPolygon');
    expect(geom.coordinates.length).toBe(2);
  });

  it('converts to Polygon when only one polygon remains', () => {
    const feature = makePolygonFeature([
      [unitSquare],
      [tinySquare],
      [mediumSquare],
    ]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry;

    expect(geom.type).toBe('Polygon');
    // Polygon coordinates are [ring[]], so the unit square ring is wrapped once more
    expect((geom as Polygon).coordinates).toEqual([unitSquare]);
  });

  it('preserves feature properties after filtering', () => {
    const feature = makePolygonFeature([
      [unitSquare],
      [tinySquare],
    ]);
    feature.properties = { pno: '00100', nimi: 'Testilä', city: 'helsinki_metro' };
    const result = filterSmallIslands([feature]);

    expect(result[0].properties).toEqual(feature.properties);
  });

  it('returns original feature when all polygons meet threshold', () => {
    const feature = makePolygonFeature([
      [unitSquare],
      [significantSquare],
    ]);
    const result = filterSmallIslands([feature]);
    // Should return the original reference (no new object created)
    expect(result[0]).toBe(feature);
  });

  it('passes through single-polygon features unchanged', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: { type: 'Polygon', coordinates: [unitSquare] },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('passes through features with no geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: null as never,
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles MultiPolygon with single polygon (no filtering needed)', () => {
    const feature = makePolygonFeature([[unitSquare]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });
});

describe('filterSmallIslands — polygon with holes', () => {
  it('accounts for hole area in threshold calculation', () => {
    // Outer ring = unit square (area 1.0), hole takes away 0.25
    // Net area = 0.75
    const hole = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]];
    const polyWithHole = [unitSquare, hole]; // net area ≈ 0.75
    const smallPoly = [significantSquare];   // area ≈ 0.25 → 33% of 0.75 → kept

    const feature = makePolygonFeature([polyWithHole, smallPoly]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as MultiPolygon;

    expect(geom.type).toBe('MultiPolygon');
    expect(geom.coordinates.length).toBe(2);
  });
});

describe('getFeatureCenter — bounding box midpoint', () => {
  it('returns center of a simple polygon', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[10, 20], [20, 20], [20, 30], [10, 30], [10, 20]]] },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBe(15);
    expect(center[1]).toBe(25);
  });

  it('returns Point coordinates directly', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBe(24.94);
    expect(center[1]).toBe(60.17);
  });

  it('handles MultiPolygon correctly', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
        ],
      },
    };
    const center = getFeatureCenter(feature);
    // bbox: [0, 0] to [30, 30] → center [15, 15]
    expect(center[0]).toBe(15);
    expect(center[1]).toBe(15);
  });

  it('returns [0, 0] for feature with no geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as never,
    };
    const center = getFeatureCenter(feature);
    expect(center).toEqual([0, 0]);
  });

  it('returns [0, 0] for geometry without coordinates', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'GeometryCollection', geometries: [] } as never,
    };
    const center = getFeatureCenter(feature);
    expect(center).toEqual([0, 0]);
  });

  it('handles LineString geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBe(5);
    expect(center[1]).toBe(5);
  });
});
