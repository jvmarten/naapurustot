/**
 * Tests for getFeatureCenter edge cases not covered by existing tests:
 * - Empty coordinates arrays
 * - GeometryCollection type
 * - Feature with geometry but no coordinates key
 */
import { describe, it, expect } from 'vitest';
import { getFeatureCenter } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

describe('getFeatureCenter — degenerate inputs', () => {
  it('returns [0,0] for feature with null geometry', () => {
    const f: Feature = { type: 'Feature', geometry: null as unknown as Feature['geometry'], properties: {} };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('returns [0,0] for Polygon with empty coordinates', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] },
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('returns [0,0] for MultiPolygon with empty coordinates', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [] },
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('returns [0,0] for LineString with empty coordinates', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [] },
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('returns [0,0] for geometry type without coordinates property', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'GeometryCollection', geometries: [] } as unknown as Feature['geometry'],
      properties: {},
    };
    expect(getFeatureCenter(f)).toEqual([0, 0]);
  });

  it('handles single-point Polygon ring correctly', () => {
    // Degenerate polygon with a single point repeated
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.9, 60.2], [24.9, 60.2]]],
      },
      properties: {},
    };
    const center = getFeatureCenter(f);
    expect(center[0]).toBeCloseTo(24.9);
    expect(center[1]).toBeCloseTo(60.2);
  });

  it('computes correct center for rectangular Polygon', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]],
      },
      properties: {},
    };
    const center = getFeatureCenter(f);
    expect(center[0]).toBeCloseTo(24.5);
    expect(center[1]).toBeCloseTo(60.5);
  });

  it('computes center for MultiPolygon as bbox midpoint of all polygons', () => {
    // Two polygons: one at (0,0)-(1,1) and one at (10,10)-(11,11)
    const f: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
        ],
      },
      properties: {},
    };
    const center = getFeatureCenter(f);
    // Bbox: (0,0) to (11,11), midpoint = (5.5, 5.5)
    expect(center[0]).toBeCloseTo(5.5);
    expect(center[1]).toBeCloseTo(5.5);
  });

  it('handles Point geometry directly', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      properties: {},
    };
    const center = getFeatureCenter(f);
    expect(center[0]).toBeCloseTo(24.94);
    expect(center[1]).toBeCloseTo(60.17);
  });

  it('handles MultiPoint geometry', () => {
    const f: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPoint', coordinates: [[0, 0], [10, 10]] } as unknown as Feature['geometry'],
      properties: {},
    };
    const center = getFeatureCenter(f);
    expect(center[0]).toBeCloseTo(5);
    expect(center[1]).toBeCloseTo(5);
  });
});
