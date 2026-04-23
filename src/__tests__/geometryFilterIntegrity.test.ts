import { describe, it, expect } from 'vitest';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

describe('filterSmallIslands — polygon area calculation', () => {
  it('preserves single-polygon features', () => {
    const f: Feature<Polygon> = {
      type: 'Feature', properties: { pno: '00100' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    };
    expect(filterSmallIslands([f])[0].geometry.type).toBe('Polygon');
  });

  it('removes tiny island polygons (< 15% of largest)', () => {
    const big = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tiny = [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]];
    const f: Feature<MultiPolygon> = {
      type: 'Feature', properties: { pno: '00100' },
      geometry: { type: 'MultiPolygon', coordinates: [big, tiny] },
    };
    const result = filterSmallIslands([f]);
    if (result[0].geometry.type === 'Polygon') {
      expect(result[0].geometry.coordinates).toEqual(big);
    } else {
      expect((result[0].geometry as MultiPolygon).coordinates).toHaveLength(1);
    }
  });

  it('keeps polygons at or above 15% threshold', () => {
    const big = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const medium = [[[20, 20], [25, 20], [25, 25], [20, 25], [20, 20]]];
    const f: Feature<MultiPolygon> = {
      type: 'Feature', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [big, medium] },
    };
    const result = filterSmallIslands([f]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates).toHaveLength(2);
  });

  it('converts to Polygon when only one polygon remains', () => {
    const big = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]];
    const tiny = [[[20, 20], [20.1, 20], [20.1, 20.1], [20, 20.1], [20, 20]]];
    const f: Feature<MultiPolygon> = {
      type: 'Feature', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [big, tiny] },
    };
    const result = filterSmallIslands([f]);
    expect(result[0].geometry.type).toBe('Polygon');
  });

  it('preserves properties after filtering', () => {
    const f: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: [
        [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
        [[[20, 20], [20.01, 20], [20.01, 20.01], [20, 20.01], [20, 20]]],
      ]},
      properties: { pno: '00100', nimi: 'Kallio', city: 'helsinki_metro' },
    };
    expect(filterSmallIslands([f])[0].properties).toEqual(f.properties);
  });
});

describe('getFeatureCenter — bounding box midpoint', () => {
  it('Polygon center', () => {
    const f: Feature<Polygon> = {
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[24, 60], [26, 60], [26, 62], [24, 62], [24, 60]]] },
    };
    expect(getFeatureCenter(f)).toEqual([25, 61]);
  });

  it('MultiPolygon center spans both polygons', () => {
    const f: Feature<MultiPolygon> = {
      type: 'Feature', properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [
        [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
        [[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]],
      ]},
    };
    expect(getFeatureCenter(f)).toEqual([15, 15]);
  });

  it('Point geometry returns coordinates directly', () => {
    const f: Feature = {
      type: 'Feature', properties: {},
      geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    };
    expect(getFeatureCenter(f)).toEqual([24.94, 60.17]);
  });

  it('null geometry returns [0,0]', () => {
    expect(getFeatureCenter({ type: 'Feature', geometry: null as any, properties: {} })).toEqual([0, 0]);
  });

  it('is not biased by duplicate closing vertex', () => {
    const f: Feature<Polygon> = {
      type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    };
    expect(getFeatureCenter(f)).toEqual([5, 5]);
  });
});
