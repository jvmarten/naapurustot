import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

function makePolygonFeature(coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: coords },
    properties: { name: 'test' },
  };
}

function makeMultiPolygonFeature(coords: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: coords },
    properties: { name: 'test' },
  };
}

// Unit square: area ~= 1.0
const unitSquare = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
// Small square: area ~= 0.01 (1% of unit square → below 15% threshold)
const tinySquare = [[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]];

describe('filterSmallIslands — threshold behavior', () => {
  it('keeps all polygons when only one exists in MultiPolygon', () => {
    const feature = makeMultiPolygonFeature([[unitSquare]]);
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
  });

  it('removes tiny polygon below 15% threshold', () => {
    const feature = makeMultiPolygonFeature([[unitSquare], [tinySquare]]);
    const result = filterSmallIslands([feature]);
    // tinySquare is ~1% of unitSquare → removed
    // Only 1 polygon remains → converted to Polygon
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps polygon at exactly 15% threshold', () => {
    // Create a polygon that is clearly above 15% of the main polygon's area
    // Main area (unitSquare) = 0.5 (shoelace formula), 15% of 0.5 = 0.075
    // Use a square with area > 0.075, side = sqrt(0.15) ≈ 0.39 → area = 0.5*0.39^2 ≈ 0.076
    // To be safe, use side=0.4 → area = 0.5*0.4^2 = 0.08 > 0.075
    const above15 = [[40, 40], [40.4, 40], [40.4, 40.4], [40, 40.4], [40, 40]];
    const feature = makeMultiPolygonFeature([[unitSquare], [above15]]);
    const result = filterSmallIslands([feature]);
    // Should keep both (>= 15%)
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('preserves properties after filtering', () => {
    const feature = makeMultiPolygonFeature([[unitSquare], [tinySquare]]);
    feature.properties = { name: 'Kallio', pno: '00530' };
    const result = filterSmallIslands([feature]);
    expect(result[0].properties).toEqual({ name: 'Kallio', pno: '00530' });
  });

  it('does not modify plain Polygon features', () => {
    const feature = makePolygonFeature([unitSquare]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference
  });

  it('handles polygon with holes (area calculation subtracts holes)', () => {
    // Polygon with a hole — the hole should reduce the net area
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]; // area = 50
    const hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]; // area = 18
    // Net area = 50 - 18 = 32
    // Tiny polygon area = 0.01
    const feature = makeMultiPolygonFeature([[outer, hole], [tinySquare]]);
    const result = filterSmallIslands([feature]);
    // tinySquare is way below 15% of 32 → removed
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('processes multiple features independently', () => {
    const features = [
      makeMultiPolygonFeature([[unitSquare], [tinySquare]]),
      makePolygonFeature([unitSquare]),
    ];
    const result = filterSmallIslands(features);
    // First feature gets filtered, second stays as-is
    expect(result[0].geometry.type).toBe('Polygon');
    expect(result[1].geometry.type).toBe('Polygon');
  });
});

describe('getFeatureCenter — edge cases', () => {
  it('returns Point coordinates directly', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([24.94, 60.17]);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as any,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('computes bbox midpoint of Polygon', () => {
    const feature = makePolygonFeature([[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]);
    const center = getFeatureCenter(feature);
    // Bbox midpoint: lng [0,4] → 2, lat [0,4] → 2
    expect(center[0]).toBeCloseTo(2, 5);
    expect(center[1]).toBeCloseTo(2, 5);
  });

  it('computes bbox midpoint for MultiPolygon', () => {
    const feature = makeMultiPolygonFeature([
      [[[0, 0], [2, 0], [2, 2], [0, 0]]],   // 4 vertices in ring
      [[[10, 10], [12, 10], [12, 12], [10, 10]]], // 4 vertices in ring
    ]);
    const center = getFeatureCenter(feature);
    // Bbox midpoint: lng [0,12] → 6, lat [0,12] → 6
    expect(center[0]).toBeCloseTo(6, 5);
    expect(center[1]).toBeCloseTo(6, 5);
  });
});
