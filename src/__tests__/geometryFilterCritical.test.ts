/**
 * Critical tests for geometryFilter.ts — getFeatureCenter() was previously untested.
 * Center calculation drives map pan-to and popup placement.
 */
import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

describe('getFeatureCenter', () => {
  it('returns Point coordinates directly', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([24.94, 60.17]);
  });

  it('computes bbox midpoint of a Polygon', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(f);
    // Bbox midpoint: lng [0,4] → 2, lat [0,4] → 2
    expect(lng).toBeCloseTo(2);
    expect(lat).toBeCloseTo(2);
  });

  it('computes bbox midpoint of a MultiPolygon', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
        ],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(f);
    // Bbox midpoint: lng [0,12] → 6, lat [0,12] → 6
    expect(lng).toBeCloseTo(6);
    expect(lat).toBeCloseTo(6);
  });

  it('returns [0,0] for null geometry', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: null as unknown as GeoJSON.Geometry,
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('handles Polygon with holes (includes hole vertices in average)', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // outer
          [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],     // hole
        ],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(f);
    // 10 vertices total, includes hole vertices
    expect(typeof lng).toBe('number');
    expect(typeof lat).toBe('number');
    expect(isFinite(lng)).toBe(true);
    expect(isFinite(lat)).toBe(true);
  });

  it('handles LineString geometry', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[0, 0], [10, 10]],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(f);
    expect(lng).toBeCloseTo(5);
    expect(lat).toBeCloseTo(5);
  });
});

describe('filterSmallIslands — threshold precision', () => {
  /** Create a square polygon ring: [[x,y],[x+s,y],[x+s,y+s],[x,y+s],[x,y]] */
  function square(x: number, y: number, size: number): number[][][] {
    return [[
      [x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y],
    ]];
  }

  it('keeps polygon at exactly 15% threshold', () => {
    // Large polygon: 100 area, small: 15 area (exactly 15%)
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [square(0, 0, 10), square(20, 20, Math.sqrt(15))],
      },
      properties: {},
    };
    const result = filterSmallIslands([f]);
    const geom = result[0].geometry;
    // Both should be kept (15% threshold is inclusive: >= 15%)
    expect(geom.type).toBe('MultiPolygon');
    expect((geom as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });

  it('removes polygon just below 15% threshold', () => {
    // Large: area 100, small: area ~14 (just under 15%)
    const largeSize = 10; // area = 50 (shoelace)
    const smallSize = 0.1; // very tiny
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [square(0, 0, largeSize), square(20, 20, smallSize)],
      },
      properties: {},
    };
    const result = filterSmallIslands([f]);
    const geom = result[0].geometry;
    // Tiny polygon should be removed, resulting in a single Polygon
    expect(geom.type).toBe('Polygon');
  });

  it('converts to Polygon type when only one polygon remains', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          square(0, 0, 10),
          square(20, 20, 0.01), // tiny island
        ],
      },
      properties: {},
    };
    const result = filterSmallIslands([f]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('preserves feature properties after filtering', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [square(0, 0, 10), square(20, 20, 0.01)],
      },
      properties: { pno: '00100', nimi: 'Test' },
    };
    const result = filterSmallIslands([f]);
    expect(result[0].properties).toEqual({ pno: '00100', nimi: 'Test' });
  });
});
