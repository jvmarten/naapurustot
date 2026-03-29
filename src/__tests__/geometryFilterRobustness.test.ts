import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

describe('getFeatureCenter', () => {
  it('returns [0,0] for feature with no geometry', () => {
    const f = { type: 'Feature', properties: {}, geometry: null } as unknown as Feature;
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('returns Point coordinates directly', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    };
    expect(getFeatureCenter(f)).toEqual([24.9, 60.2]);
  });

  it('computes center of a simple Polygon (average of vertices)', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    };
    const center = getFeatureCenter(f);
    // Average of 5 points: (0+10+10+0+0)/5=4, (0+0+10+10+0)/5=4
    expect(center[0]).toBeCloseTo(4);
    expect(center[1]).toBeCloseTo(4);
  });

  it('computes center of MultiPolygon', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
        ],
      },
    };
    const center = getFeatureCenter(f);
    // Average of all 10 vertices: (0+2+2+0+0+10+12+12+10+10)/10=5.8, (0+0+2+2+0+10+10+12+12+10)/10=5.8
    expect(center[0]).toBeCloseTo(5.8);
    expect(center[1]).toBeCloseTo(5.8);
  });

  it('handles LineString geometry', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] },
    };
    const center = getFeatureCenter(f);
    expect(center[0]).toBeCloseTo(5);
    expect(center[1]).toBeCloseTo(5);
  });

  it('returns [0,0] for geometry with no coordinates property', () => {
    const f = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'GeometryCollection', geometries: [] },
    } as unknown as Feature;
    const center = getFeatureCenter(f);
    expect(center).toEqual([0, 0]);
  });
});

describe('filterSmallIslands — additional edge cases', () => {
  it('converts single-remaining polygon from MultiPolygon to Polygon', () => {
    // One big polygon and one tiny polygon
    const bigPoly = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
    const tinyPoly = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]];

    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[bigPoly], [tinyPoly]],
      },
    };

    const result = filterSmallIslands([f]);
    // The tiny polygon is < 15% of the big one → removed
    // Only 1 polygon left → should be converted to Polygon type
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps all polygons when they are close in size', () => {
    const poly1 = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const poly2 = [[20, 20], [28, 20], [28, 28], [20, 28], [20, 20]]; // ~64% of poly1's area

    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[poly1], [poly2]],
      },
    };

    const result = filterSmallIslands([f]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as GeoJSON.MultiPolygon).coordinates.length).toBe(2);
  });

  it('handles polygon with holes (net area = outer - holes)', () => {
    // Outer ring
    const outer = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
    // Hole that consumes most of the area
    const hole = [[10, 10], [90, 10], [90, 90], [10, 90], [10, 10]];
    // Small separate polygon (area = 4, net area of first = 100*100 - 80*80 = 3600)
    const small = [[200, 200], [202, 200], [202, 202], [200, 202], [200, 200]];

    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[outer, hole], [small]],
      },
    };

    const result = filterSmallIslands([f]);
    // small polygon area (4) < 15% of large net area (3600), should be removed
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('handles feature with non-MultiPolygon geometry (passes through)', () => {
    const f: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [0, 0] },
    };
    const result = filterSmallIslands([f]);
    expect(result[0]).toBe(f); // same reference
  });
});
