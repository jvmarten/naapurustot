import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

function makePolygon(coords: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { name: 'test' },
    geometry: { type: 'Polygon', coordinates: coords },
  };
}

function makeMultiPolygon(polys: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    properties: { name: 'test' },
    geometry: { type: 'MultiPolygon', coordinates: polys },
  };
}

// Simple square: area = 1 (unit square)
const unitSquare = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
// Large square: area = 100
const largeSquare = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
// Tiny square: area = 0.01 (< 15% of large = 15)
const tinySquare = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];

describe('filterSmallIslands — threshold precision', () => {
  it('removes polygons < 15% of largest area', () => {
    const feature = makeMultiPolygon([
      [largeSquare],  // area = 100
      [tinySquare],   // area = 0.01, which is 0.01% of 100
    ]);
    const [result] = filterSmallIslands([feature]);
    expect(result.geometry.type).toBe('Polygon'); // converted to Polygon
  });

  it('keeps polygons >= 15% of largest area', () => {
    // 15% of 100 = 15. So a polygon with area 16 should be kept.
    const keptSquare = [[0, 0], [4.1, 0], [4.1, 4.1], [0, 4.1], [0, 0]]; // area ≈ 16.81
    const feature = makeMultiPolygon([
      [largeSquare],   // area = 100
      [keptSquare],    // area ≈ 16.81 (> 15)
    ]);
    const [result] = filterSmallIslands([feature]);
    expect(result.geometry.type).toBe('MultiPolygon');
    expect((result.geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('exactly 15% threshold is inclusive', () => {
    // Large area = 100, threshold = 15. A polygon with area = 15 should be kept.
    // sqrt(15) ≈ 3.873
    const exactThresholdSquare = [[0, 0], [Math.sqrt(15), 0], [Math.sqrt(15), Math.sqrt(15)], [0, Math.sqrt(15)], [0, 0]];
    const feature = makeMultiPolygon([
      [largeSquare],
      [exactThresholdSquare],
    ]);
    const [result] = filterSmallIslands([feature]);
    expect(result.geometry.type).toBe('MultiPolygon');
  });

  it('passes through Polygon features unchanged', () => {
    const feature = makePolygon([unitSquare]);
    const [result] = filterSmallIslands([feature]);
    expect(result).toBe(feature); // same reference
  });

  it('passes through single-polygon MultiPolygon unchanged', () => {
    const feature = makeMultiPolygon([[unitSquare]]);
    const [result] = filterSmallIslands([feature]);
    expect(result).toBe(feature);
  });

  it('handles polygon with holes (net area excludes holes)', () => {
    // Outer ring: area = 100
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    // Hole: area = 64 → net area = 36
    const hole = [[1, 1], [9, 1], [9, 9], [1, 9], [1, 1]];

    const withHole = makeMultiPolygon([
      [outer, hole],   // net area = 36
      [unitSquare],    // area = 1 (2.8% of 36 → removed)
    ]);
    const [result] = filterSmallIslands([withHole]);
    expect(result.geometry.type).toBe('Polygon');
  });

  it('preserves feature properties during filtering', () => {
    const feature = makeMultiPolygon([[largeSquare], [tinySquare]]);
    feature.properties = { name: 'Helsinki', pno: '00100' };
    const [result] = filterSmallIslands([feature]);
    expect(result.properties).toEqual({ name: 'Helsinki', pno: '00100' });
  });

  it('returns same reference when no filtering occurs', () => {
    const feature = makeMultiPolygon([[largeSquare], [largeSquare]]);
    const [result] = filterSmallIslands([feature]);
    expect(result).toBe(feature); // no filtering needed
  });
});

describe('getFeatureCenter — geometry types', () => {
  it('returns Point coordinates directly', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.95, 60.17] },
    };
    expect(getFeatureCenter(feature)).toEqual([24.95, 60.17]);
  });

  it('averages all vertices for Polygon', () => {
    const feature = makePolygon([[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]);
    const [lng, lat] = getFeatureCenter(feature);
    // 5 vertices (including closing): avg of [0,4,4,0,0]/5 = 1.6, [0,0,4,4,0]/5 = 1.6
    expect(lng).toBeCloseTo(1.6, 5);
    expect(lat).toBeCloseTo(1.6, 5);
  });

  it('averages all vertices across MultiPolygon parts', () => {
    const feature = makeMultiPolygon([
      [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
    ]);
    const [lng, lat] = getFeatureCenter(feature);
    // Average of all 10 vertices
    expect(lng).toBeCloseTo(5.8, 1);
    expect(lat).toBeCloseTo(5.8, 1);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as unknown as GeoJSON.Geometry,
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles LineString geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
    };
    const [lng, lat] = getFeatureCenter(feature);
    expect(lng).toBeCloseTo(5, 5);
    expect(lat).toBeCloseTo(5, 5);
  });
});
