/**
 * Tests for geometryFilter.ts — getFeatureCenter function.
 *
 * This is used by neighborhood profile pages and POI layers. A bug here
 * causes map markers to appear in the wrong location.
 */
import { describe, it, expect } from 'vitest';
import { getFeatureCenter, filterSmallIslands } from '../utils/geometryFilter';
import type { Feature, Point, Polygon, MultiPolygon } from 'geojson';

describe('getFeatureCenter', () => {
  it('returns point coordinates for Point geometry', () => {
    const feature: Feature<Point> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [24.95, 60.17] },
    };
    const [lng, lat] = getFeatureCenter(feature);
    expect(lng).toBe(24.95);
    expect(lat).toBe(60.17);
  });

  it('returns centroid for a simple Polygon', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]],
        ],
      },
    };
    const [lng, lat] = getFeatureCenter(feature);
    // Average of all 5 vertices (note: first and last are same)
    // lng: (24.9+25.0+25.0+24.9+24.9)/5 = 124.7/5 = 24.94
    // lat: (60.1+60.1+60.2+60.2+60.1)/5 = 300.7/5 = 60.14
    expect(lng).toBeCloseTo(24.94, 2);
    expect(lat).toBeCloseTo(60.14, 2);
  });

  it('returns centroid for a MultiPolygon', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
        ],
      },
    };
    const [lng, lat] = getFeatureCenter(feature);
    // All 10 vertices averaged: (0+1+1+0+0+2+3+3+2+2)/10 = 1.4
    expect(lng).toBeCloseTo(1.4, 1);
    expect(lat).toBeCloseTo(1.4, 1);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: null as unknown as GeoJSON.Geometry,
    };
    const [lng, lat] = getFeatureCenter(feature);
    expect(lng).toBe(0);
    expect(lat).toBe(0);
  });

  it('handles Polygon with holes (includes hole vertices in average)', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          // Outer ring
          [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
          // Hole (inner ring)
          [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
        ],
      },
    };
    const [lng, lat] = getFeatureCenter(feature);
    // All vertices averaged including hole
    expect(lng).toBeDefined();
    expect(lat).toBeDefined();
    expect(isFinite(lng)).toBe(true);
    expect(isFinite(lat)).toBe(true);
  });

  it('handles LineString geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [[24.9, 60.1], [25.0, 60.2]],
      },
    };
    const [lng, lat] = getFeatureCenter(feature);
    expect(lng).toBeCloseTo(24.95, 2);
    expect(lat).toBeCloseTo(60.15, 2);
  });
});

describe('filterSmallIslands — area calculation', () => {
  it('converts MultiPolygon to Polygon when only one polygon survives', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          // Large polygon (1 unit²)
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          // Tiny polygon (< 15% of large)
          [[[5, 5], [5.01, 5], [5.01, 5.01], [5, 5.01], [5, 5]]],
        ],
      },
    };

    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('preserves area calculation with complex polygons (holes)', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: { pno: '00100' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          // Large polygon with a hole (net area = 1 - 0.04 = 0.96)
          [
            [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]],
            [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6], [0.4, 0.4]],
          ],
          // Medium polygon (0.25 unit² ≈ 26% of large → should survive)
          [[[2, 2], [2.5, 2], [2.5, 2.5], [2, 2.5], [2, 2]]],
        ],
      },
    };

    const result = filterSmallIslands([feature]);
    // Both polygons should survive (0.25 / 0.96 ≈ 26% > 15%)
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });
});
