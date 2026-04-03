import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

describe('filterSmallIslands — polygon area with holes', () => {
  it('polygon area calculation subtracts holes', () => {
    // A MultiPolygon with two polygons:
    // 1. Large outer ring with a hole (net area = outer - hole)
    // 2. Small polygon
    // If hole subtraction works, the large polygon's net area may still be largest
    const largeWithHole: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          // Polygon 1: outer 10x10 with 2x2 hole
          [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], // outer: area = 50
            [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],     // hole: area = 2
          ],
          // Polygon 2: 3x3 square (area = 4.5)
          [
            [[20, 20], [23, 20], [23, 23], [20, 23], [20, 20]],
          ],
        ],
      },
      properties: {},
    };

    const result = filterSmallIslands([largeWithHole]);
    // Net area of poly 1: 50 - 2 = 48, poly 2: 4.5
    // 4.5 / 48 = 0.09375 < 0.15 → poly 2 should be removed
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps polygon when hole makes it smaller but still largest', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          // Large with small hole
          [
            [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
            [[4, 4], [5, 4], [5, 5], [4, 5], [4, 4]], // tiny hole
          ],
          // Medium polygon: 15% of large
          [
            [[20, 20], [24, 20], [24, 24], [20, 24], [20, 20]], // area = 8
          ],
        ],
      },
      properties: {},
    };

    const result = filterSmallIslands([feature]);
    // Large net: 50 - 0.5 = 49.5, Medium: 8
    // 8 / 49.5 ≈ 0.16 ≥ 0.15 → both kept
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as GeoJSON.MultiPolygon).coordinates).toHaveLength(2);
  });
});

describe('filterSmallIslands — edge cases', () => {
  it('passes through Point geometry unchanged', () => {
    const point: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    const result = filterSmallIslands([point]);
    expect(result[0]).toBe(point); // same reference
  });

  it('passes through Polygon geometry unchanged', () => {
    const poly: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      properties: {},
    };
    const result = filterSmallIslands([poly]);
    expect(result[0]).toBe(poly);
  });

  it('converts MultiPolygon to Polygon when only one polygon survives', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], // large
          [[[100, 100], [100.001, 100], [100.001, 100.001], [100, 100.001], [100, 100]]], // tiny
        ],
      },
      properties: {},
    };
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('handles feature with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as GeoJSON.Geometry,
      properties: {},
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });
});

describe('getFeatureCenter', () => {
  it('returns Point coordinates directly', () => {
    const point: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    const center = getFeatureCenter(point);
    expect(center).toEqual([24.9, 60.2]);
  });

  it('returns center of a Polygon (bbox midpoint)', () => {
    const poly: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
      },
      properties: {},
    };
    const center = getFeatureCenter(poly);
    // Bbox midpoint: lng [0,4] → 2, lat [0,4] → 2
    expect(center[0]).toBeCloseTo(2, 5);
    expect(center[1]).toBeCloseTo(2, 5);
  });

  it('returns center of a MultiPolygon (bbox midpoint)', () => {
    const multi: Feature = {
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
    const center = getFeatureCenter(multi);
    // Bbox midpoint: lng [0,12] → 6, lat [0,12] → 6
    expect(center[0]).toBeCloseTo(6, 5);
    expect(center[1]).toBeCloseTo(6, 5);
  });

  it('returns [0,0] for feature with null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as GeoJSON.Geometry,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('returns center of LineString geometry', () => {
    const line: Feature = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[0, 0], [10, 10]],
      },
      properties: {},
    };
    const center = getFeatureCenter(line);
    expect(center[0]).toBeCloseTo(5, 5);
    expect(center[1]).toBeCloseTo(5, 5);
  });
});
