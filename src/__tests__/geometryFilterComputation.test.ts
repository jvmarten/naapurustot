import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature } from 'geojson';

describe('filterSmallIslands', () => {
  it('returns feature unchanged for Polygon geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // Same reference — no modification
  });

  it('returns MultiPolygon unchanged when only one polygon', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]],
      },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('removes tiny islands below 15% threshold', () => {
    // Large polygon: 1x1 square (area ~0.5)
    const large = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    // Tiny polygon: 0.1x0.1 square (area ~0.005, which is 1% of large)
    const tiny = [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]];

    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [large, tiny] },
      properties: { pno: '00100' },
    };

    const result = filterSmallIslands([feature]);
    // Tiny island should be filtered out, leaving just the large polygon
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('keeps all polygons when all are similar size', () => {
    const poly1 = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
    const poly2 = [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]];

    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [poly1, poly2] },
      properties: { pno: '00100' },
    };

    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as any).coordinates).toHaveLength(2);
  });

  it('converts to Polygon when filtering leaves one polygon', () => {
    const large = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tiny1 = [[[20, 20], [20.01, 20], [20.01, 20.01], [20, 20.01], [20, 20]]];
    const tiny2 = [[[30, 30], [30.01, 30], [30.01, 30.01], [30, 30.01], [30, 30]]];

    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [large, tiny1, tiny2] },
      properties: { pno: '00100' },
    };

    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('handles polygons with holes correctly', () => {
    // Outer ring: 4x4 square, inner hole: 1x1 square
    const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    const hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
    const large = [outer, hole];
    // Tiny island
    const tiny = [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10.1], [10, 10]]];

    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [large, tiny] },
      properties: { pno: '00100' },
    };

    const result = filterSmallIslands([feature]);
    // Net area of large polygon (16 - 1 = 15) vs tiny (~0.005) → tiny should be filtered
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('handles null geometry gracefully', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as any,
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('handles Point geometry (non-polygon)', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.1] },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature);
  });

  it('processes multiple features independently', () => {
    const feature1: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
          [[[20, 20], [20.01, 20], [20.01, 20.01], [20, 20.01], [20, 20]]],
        ],
      },
      properties: { pno: '00100' },
    };
    const feature2: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      properties: { pno: '00200' },
    };

    const result = filterSmallIslands([feature1, feature2]);
    expect(result).toHaveLength(2);
    expect(result[0].geometry.type).toBe('Polygon'); // tiny island removed
    expect(result[1]).toBe(feature2); // unchanged
  });
});

describe('getFeatureCenter', () => {
  it('returns center of a Polygon (average of all vertices)', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(feature);
    // Average of 5 coords (including closing point): (0+2+2+0+0)/5 = 0.8
    expect(lng).toBeCloseTo(0.8, 5);
    expect(lat).toBeCloseTo(0.8, 5);
  });

  it('returns center of a MultiPolygon', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]],
        ],
      },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(feature);
    // Average of all coordinates (including closing points)
    expect(lng).toBeGreaterThan(0);
    expect(lat).toBeGreaterThan(0);
  });

  it('returns Point coordinates directly', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.95, 60.17] },
      properties: {},
    };
    const [lng, lat] = getFeatureCenter(feature);
    expect(lng).toBe(24.95);
    expect(lat).toBe(60.17);
  });

  it('returns [0, 0] for null geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as any,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('returns [0, 0] for feature with empty coordinates', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [] } as any,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });
});
