import { describe, it, expect } from 'vitest';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { Feature, MultiPolygon } from 'geojson';

// Helper: create a rectangular polygon from (x1,y1) to (x2,y2)
function rect(x1: number, y1: number, x2: number, y2: number): number[][][] {
  return [[
    [x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1],
  ]];
}

function makeMultiPolygon(polygons: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: polygons },
    properties: {},
  };
}

describe('filterSmallIslands', () => {
  it('removes polygons smaller than 15% of the largest', () => {
    const large = rect(0, 0, 10, 10); // area = 100
    const tiny = rect(0, 0, 1, 1);    // area = 1 (1% of 100)
    const feature = makeMultiPolygon([large, tiny]);

    const result = filterSmallIslands([feature]);
    // Should convert to Polygon since only 1 polygon remains
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps polygons that are >= 15% of the largest', () => {
    const large = rect(0, 0, 10, 10);   // area = 100
    const medium = rect(0, 0, 5, 5);    // area = 25 (25% of 100)
    const feature = makeMultiPolygon([large, medium]);

    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('passes through single Polygon features unchanged', () => {
    const polyFeature: Feature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: rect(0, 0, 5, 5) },
      properties: {},
    };
    const result = filterSmallIslands([polyFeature]);
    expect(result[0]).toBe(polyFeature);
  });

  it('passes through MultiPolygon with single polygon unchanged', () => {
    const feature = makeMultiPolygon([rect(0, 0, 10, 10)]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('returns unchanged feature if all polygons are significant', () => {
    const a = rect(0, 0, 10, 10);  // area = 100
    const b = rect(0, 0, 8, 8);    // area = 64 (64%)
    const c = rect(0, 0, 6, 6);    // area = 36 (36%)
    const feature = makeMultiPolygon([a, b, c]);

    const result = filterSmallIslands([feature]);
    // All kept → same reference returned
    expect(result[0]).toBe(feature);
  });

  it('handles empty features array', () => {
    expect(filterSmallIslands([])).toEqual([]);
  });
});
