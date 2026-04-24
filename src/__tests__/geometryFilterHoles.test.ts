/**
 * Tests for geometryFilter edge cases: polygons with holes, MultiPolygon
 * downgrade to Polygon, and getFeatureCenter with various geometry types.
 *
 * filterSmallIslands is called on EVERY data load. If it incorrectly removes
 * polygons or miscalculates areas, entire neighborhoods disappear from the map.
 */
import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, MultiPolygon, Polygon } from 'geojson';

function makeMultiPolygon(polygons: number[][][][]): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100' },
    geometry: { type: 'MultiPolygon', coordinates: polygons },
  };
}

describe('filterSmallIslands — area calculation with holes', () => {
  const mainland: number[][][] = [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  ];
  const hole: number[][] = [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]];
  const mainlandWithHole: number[][][] = [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    hole,
  ];
  const tinyIsland: number[][][] = [
    [[20, 20], [20.1, 20], [20.1, 20.1], [20, 20.1], [20, 20]],
  ];

  it('removes tiny islands while keeping mainland', () => {
    const feature = makeMultiPolygon([mainland, tinyIsland]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as Polygon;
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates).toEqual(mainland);
  });

  it('polygon with holes: net area is outer minus inner', () => {
    // Mainland with hole has net area 100 - 36 = 64.
    // A small island with area 0.01 is < 15% of 64, so it should be removed.
    const feature = makeMultiPolygon([mainlandWithHole, tinyIsland]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as Polygon;
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates).toEqual(mainlandWithHole);
  });

  it('keeps all polygons when none are tiny', () => {
    const poly1: number[][][] = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    ];
    const poly2: number[][][] = [
      [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]],
    ];
    const feature = makeMultiPolygon([poly1, poly2]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry as MultiPolygon;
    expect(geom.type).toBe('MultiPolygon');
    expect(geom.coordinates).toHaveLength(2);
  });

  it('does not modify single Polygon features', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'Polygon',
        coordinates: mainland,
      },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('does not modify MultiPolygon with exactly 1 polygon', () => {
    const feature = makeMultiPolygon([mainland]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles features with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: null as unknown as Polygon,
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });
});

describe('getFeatureCenter — geometry types', () => {
  it('returns coordinates directly for Point geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    expect(getFeatureCenter(feature)).toEqual([24.94, 60.17]);
  });

  it('computes bbox midpoint for Polygon', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
      },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(24.5, 5);
    expect(center[1]).toBeCloseTo(60.5, 5);
  });

  it('computes bbox midpoint for MultiPolygon', () => {
    const feature: Feature = {
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
    expect(center[0]).toBeCloseTo(15, 5);
    expect(center[1]).toBeCloseTo(15, 5);
  });

  it('returns [0, 0] for feature with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as unknown as Polygon,
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('computes center for LineString', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[24, 60], [26, 62]],
      },
    };
    const center = getFeatureCenter(feature);
    expect(center[0]).toBeCloseTo(25, 5);
    expect(center[1]).toBeCloseTo(61, 5);
  });
});
