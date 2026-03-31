import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';

// Helper to create a polygon ring (closed square) at given position & size
function square(x: number, y: number, size: number): number[][] {
  return [
    [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
  ];
}

describe('filterSmallIslands', () => {
  it('removes polygons below 15% of largest area', () => {
    const big = square(0, 0, 10);   // area = 100
    const small = square(20, 0, 1); // area = 1 (< 15)
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[big], [small]] },
    };
    const result = filterSmallIslands([feature]);
    // Small polygon removed, single polygon left → type becomes Polygon
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps polygons at or above 15% threshold', () => {
    const big = square(0, 0, 10);   // area = 100
    const mid = square(20, 0, 4);   // area = 16 (>= 15)
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[big], [mid]] },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('passes through single Polygon features unchanged', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 5)] },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference
  });

  it('passes through MultiPolygon with single polygon unchanged', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0, 5)]] },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference, no filtering needed
  });

  it('returns original feature when no polygons are removed', () => {
    const a = square(0, 0, 10);  // area = 100
    const b = square(20, 0, 10); // area = 100
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[a], [b]] },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles features with null geometry', () => {
    const feature = {
      type: 'Feature' as const,
      properties: {},
      geometry: null,
    } as unknown as Feature;
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles polygon with holes (subtracts hole area)', () => {
    const outer = square(0, 0, 10); // area = 100
    // Hole inside (should reduce net area)
    const hole = square(2, 2, 3);   // area = 9
    const bigPoly = [outer, hole];   // net area = 91

    const tinyPoly = [square(20, 0, 1)]; // area = 1
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [bigPoly, tinyPoly] },
    };
    const result = filterSmallIslands([feature]);
    // 1 < 91 * 0.15 = 13.65 → tiny polygon removed
    expect(result[0].geometry.type).toBe('Polygon');
  });
});

describe('getFeatureCenter', () => {
  it('returns Point geometry coordinates directly', () => {
    const feature: Feature<Point> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    expect(getFeatureCenter(feature)).toEqual([24.94, 60.17]);
  });

  it('computes center of a Polygon', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [square(0, 0, 10)] },
    };
    const center = getFeatureCenter(feature);
    // Average of vertices: (0,0), (10,0), (10,10), (0,10), (0,0) = [4, 4]
    // (0+10+10+0+0)/5 = 4, (0+0+10+10+0)/5 = 4
    expect(center[0]).toBeCloseTo(4, 1);
    expect(center[1]).toBeCloseTo(4, 1);
  });

  it('computes center of a MultiPolygon', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[square(0, 0, 2)], [square(10, 10, 2)]],
      },
    };
    const center = getFeatureCenter(feature);
    // All 10 vertices from both polygons averaged
    expect(center[0]).toBeGreaterThan(0);
    expect(center[1]).toBeGreaterThan(0);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature = { type: 'Feature', properties: {}, geometry: null } as unknown as Feature;
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('returns [0, 0] for LineString (supported via generic extraction)', () => {
    const feature: Feature<LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
    };
    const center = getFeatureCenter(feature);
    // Should extract coordinates from LineString too
    expect(center[0]).toBeCloseTo(5, 1);
    expect(center[1]).toBeCloseTo(5, 1);
  });
});
