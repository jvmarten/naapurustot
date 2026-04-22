import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';

function makePolygon(coords: number[][][]): Feature<Polygon> {
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: {} };
}

function makeMultiPolygon(polys: number[][][][]): Feature<MultiPolygon> {
  return { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: polys }, properties: {} };
}

// A unit square: area = 1.0 (in coordinate units)
const LARGE_SQUARE = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
// A tiny square: area = 0.01 (1% of large)
const TINY_SQUARE = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];
// A medium square: area = 0.25 (25% of large — above 15% threshold)
const MEDIUM_SQUARE = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5], [0, 0]];

describe('filterSmallIslands', () => {
  it('keeps single-polygon features unchanged', () => {
    const feature = makePolygon([LARGE_SQUARE]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference
  });

  it('keeps MultiPolygon with single polygon unchanged', () => {
    const feature = makeMultiPolygon([[LARGE_SQUARE]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('removes polygons below 15% of largest area', () => {
    const feature = makeMultiPolygon([[LARGE_SQUARE], [TINY_SQUARE]]);
    const result = filterSmallIslands([feature]);
    // TINY_SQUARE is 1% of LARGE_SQUARE — below 15% threshold
    const geom = result[0].geometry as Polygon | MultiPolygon;
    if (geom.type === 'Polygon') {
      // Only large polygon remains, converted to Polygon
      expect(geom.coordinates).toEqual([LARGE_SQUARE]);
    } else {
      expect(geom.coordinates.length).toBe(1);
    }
  });

  it('keeps polygons at or above 15% of largest area', () => {
    const feature = makeMultiPolygon([[LARGE_SQUARE], [MEDIUM_SQUARE]]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as MultiPolygon;
    expect(geom.coordinates.length).toBe(2);
  });

  it('converts to Polygon when only one polygon survives filtering', () => {
    const feature = makeMultiPolygon([[LARGE_SQUARE], [TINY_SQUARE]]);
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('returns same reference when no polygons are filtered', () => {
    const feature = makeMultiPolygon([[LARGE_SQUARE], [MEDIUM_SQUARE]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles polygons with holes (net area)', () => {
    // Outer ring has area ~1.0, hole has area ~0.25
    // Net area ~0.75
    const outerWithHole = [
      [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
      [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]], // hole
    ];
    const feature = makeMultiPolygon([outerWithHole, [TINY_SQUARE]]);
    const result = filterSmallIslands([feature]);
    // Net area of polygon with hole is ~0.75, tiny square is 0.01 (1.3% — below 15%)
    const geom = result[0].geometry as Polygon;
    expect(geom.type).toBe('Polygon');
  });

  it('handles features with no geometry gracefully', () => {
    const feature: Feature = { type: 'Feature', geometry: null as any, properties: {} };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles Point geometry (not MultiPolygon)', () => {
    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    const result = filterSmallIslands([feature as Feature]);
    expect(result[0]).toBe(feature);
  });
});

describe('getFeatureCenter', () => {
  it('computes bbox midpoint for Polygon', () => {
    const feature = makePolygon([[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]]);
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(24.5, 5);
    expect(center[1]).toBeCloseTo(60.5, 5);
  });

  it('returns point coordinates directly for Point geometry', () => {
    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([24.9, 60.2]);
  });

  it('computes center for MultiPolygon', () => {
    const feature = makeMultiPolygon([
      [[[24.0, 60.0], [24.5, 60.0], [24.5, 60.5], [24.0, 60.5], [24.0, 60.0]]],
      [[[25.0, 61.0], [25.5, 61.0], [25.5, 61.5], [25.0, 61.5], [25.0, 61.0]]],
    ]);
    const center = getFeatureCenter(feature);
    // bbox: lng [24.0, 25.5], lat [60.0, 61.5]
    expect(center[0]).toBeCloseTo(24.75, 5);
    expect(center[1]).toBeCloseTo(60.75, 5);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = { type: 'Feature', geometry: null as any, properties: {} };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles LineString geometry', () => {
    const feature: Feature<LineString> = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[24.0, 60.0], [25.0, 61.0]] },
      properties: {},
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(24.5, 5);
    expect(center[1]).toBeCloseTo(60.5, 5);
  });

  it('returns [0, 0] for geometry without coordinates', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'GeometryCollection', geometries: [] } as any,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });
});
