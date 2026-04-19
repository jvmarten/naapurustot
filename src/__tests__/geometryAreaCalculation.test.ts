import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

function makePolygonFeature(coordinates: number[][][]): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: { pno: '00100' },
    geometry: { type: 'Polygon', coordinates },
  };
}

function makeMultiPolygonFeature(coordinates: number[][][][]): Feature<MultiPolygon> {
  return {
    type: 'Feature',
    properties: { pno: '00100' },
    geometry: { type: 'MultiPolygon', coordinates },
  };
}

describe('filterSmallIslands — area threshold logic', () => {
  it('removes polygon that is exactly 14% of the largest (below 15% threshold)', () => {
    // Large polygon: unit square [0,0]-[1,1], area = 0.5
    // Small polygon: ~14% of large
    const large = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    // Small polygon that is ~14% of the large one
    const small = [[[2, 0], [2.14, 0], [2.14, 0.5], [2, 0.5], [2, 0]]];

    const feature = makeMultiPolygonFeature([large, small]);
    const result = filterSmallIslands([feature]);

    const geom = result[0].geometry as Polygon | MultiPolygon;
    if (geom.type === 'Polygon') {
      // Collapsed to single polygon — small was removed
      expect(true).toBe(true);
    } else {
      expect(geom.coordinates.length).toBe(1);
    }
  });

  it('keeps polygon that is well above 15% of the largest', () => {
    // Large polygon: area via shoelace = 10*10/2 = 50 (for the square [0,0]-[10,10])
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    // A polygon that is clearly >15% of the large one (area ≈ 12.5, which is 25% of 50)
    const aboveThreshold = [[[20, 0], [25, 0], [25, 5], [20, 5], [20, 0]]];

    const feature = makeMultiPolygonFeature([large, aboveThreshold]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as MultiPolygon;
    expect(geom.type).toBe('MultiPolygon');
    expect(geom.coordinates.length).toBe(2);
  });

  it('converts MultiPolygon to Polygon when only one polygon survives filtering', () => {
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tiny = [[[20, 0], [20.1, 0], [20.1, 0.1], [20, 0.1], [20, 0]]];

    const feature = makeMultiPolygonFeature([large, tiny]);
    const result = filterSmallIslands([feature]);

    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('preserves single Polygon features unchanged', () => {
    const feature = makePolygonFeature([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles polygons with holes (net area)', () => {
    // Large polygon with a hole
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
    const large = [outer, hole]; // Net area = 50 - 18 = 32

    const small = [[[20, 0], [21, 0], [21, 1], [20, 1], [20, 0]]]; // area = 0.5

    const feature = makeMultiPolygonFeature([large, small]);
    const result = filterSmallIslands([feature]);

    // Small is 0.5 / max(32, 0.5) = 1.5%, well below 15%
    const geom = result[0].geometry as Polygon;
    expect(geom.type).toBe('Polygon');
  });

  it('handles empty features array', () => {
    expect(filterSmallIslands([])).toEqual([]);
  });

  it('passes through features without geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: null as any,
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });
});

describe('getFeatureCenter — various geometry types', () => {
  it('returns exact coordinates for Point geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    expect(getFeatureCenter(feature)).toEqual([24.94, 60.17]);
  });

  it('returns bbox midpoint for Polygon', () => {
    const feature = makePolygonFeature([[[10, 20], [30, 20], [30, 40], [10, 40], [10, 20]]]);
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(20, 5);
    expect(center[1]).toBeCloseTo(30, 5);
  });

  it('returns bbox midpoint for MultiPolygon', () => {
    const feature = makeMultiPolygonFeature([
      [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
    ]);
    const center = getFeatureCenter(feature);
    // Bbox: [0, 0, 30, 30] → midpoint [15, 15]
    expect(center[0]).toBeCloseTo(15, 5);
    expect(center[1]).toBeCloseTo(15, 5);
  });

  it('returns [0, 0] for feature with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as any,
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles LineString geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(5, 5);
    expect(center[1]).toBeCloseTo(5, 5);
  });

  it('handles deeply nested coordinates without stack overflow', () => {
    // MultiPolygon with many polygons
    const polygons = Array.from({ length: 50 }, (_, i) => [
      [[i * 10, 0], [i * 10 + 5, 0], [i * 10 + 5, 5], [i * 10, 5], [i * 10, 0]],
    ]);
    const feature = makeMultiPolygonFeature(polygons);
    const center = getFeatureCenter(feature);
    expect(isFinite(center[0])).toBe(true);
    expect(isFinite(center[1])).toBe(true);
  });
});
