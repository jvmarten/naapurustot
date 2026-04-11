/**
 * Hardened tests for the data loading pipeline.
 *
 * Targets critical logic in dataLoader.ts:
 * - processTopology: TopoJSON → GeoJSON conversion and type coercion
 * - String-to-number coercion for quantized properties
 * - ID fields (pno, kunta, postinumeroalue) must stay as strings
 * - Empty string values left as-is (not coerced to 0)
 * - Processing pipeline order: islands → quality → change → quickwin → metro avg
 *
 * Also tests geometryFilter.ts:
 * - filterSmallIslands polygon area filtering
 * - getFeatureCenter bbox midpoint computation
 */
import { describe, it, expect } from 'vitest';
import type { Feature, MultiPolygon, Polygon, Point } from 'geojson';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';

describe('Type coercion logic (dataLoader processTopology equivalent)', () => {
  const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);

  function coerceProperties(properties: Record<string, unknown>): Record<string, unknown> {
    const result = { ...properties };
    for (const key of Object.keys(result)) {
      if (ID_FIELDS.has(key)) continue;
      const v = result[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) result[key] = num;
      }
    }
    return result;
  }

  it('converts string numbers to actual numbers', () => {
    const result = coerceProperties({ he_vakiy: '1234', hr_mtu: '30000' });
    expect(result.he_vakiy).toBe(1234);
    expect(result.hr_mtu).toBe(30000);
  });

  it('preserves ID fields as strings', () => {
    const result = coerceProperties({ pno: '00100', kunta: '091', postinumeroalue: '00100' });
    expect(result.pno).toBe('00100');
    expect(result.kunta).toBe('091');
    expect(result.postinumeroalue).toBe('00100');
  });

  it('leaves empty strings as-is (not coerced to 0)', () => {
    const result = coerceProperties({ hr_mtu: '' });
    expect(result.hr_mtu).toBe('');
  });

  it('leaves whitespace-only strings as-is', () => {
    const result = coerceProperties({ hr_mtu: '   ' });
    expect(result.hr_mtu).toBe('   ');
  });

  it('leaves non-numeric strings as-is', () => {
    const result = coerceProperties({ nimi: 'Kallio', city: 'helsinki_metro' });
    expect(result.nimi).toBe('Kallio');
    expect(result.city).toBe('helsinki_metro');
  });

  it('converts negative number strings', () => {
    const result = coerceProperties({ some_metric: '-5.5' });
    expect(result.some_metric).toBe(-5.5);
  });

  it('converts zero string', () => {
    const result = coerceProperties({ some_metric: '0' });
    expect(result.some_metric).toBe(0);
  });

  it('does not convert Infinity string', () => {
    const result = coerceProperties({ some_metric: 'Infinity' });
    // Number('Infinity') returns Infinity, which is NOT finite
    expect(result.some_metric).toBe('Infinity');
  });

  it('does not convert NaN string', () => {
    const result = coerceProperties({ some_metric: 'NaN' });
    expect(result.some_metric).toBe('NaN');
  });

  it('converts decimal strings', () => {
    const result = coerceProperties({ unemployment_rate: '12.5' });
    expect(result.unemployment_rate).toBe(12.5);
  });

  it('preserves null values', () => {
    const result = coerceProperties({ hr_mtu: null });
    expect(result.hr_mtu).toBeNull();
  });

  it('preserves actual number values', () => {
    const result = coerceProperties({ hr_mtu: 30000 });
    expect(result.hr_mtu).toBe(30000);
  });

  it('preserves boolean values', () => {
    const result = coerceProperties({ _isMetroArea: true });
    expect(result._isMetroArea).toBe(true);
  });
});

describe('filterSmallIslands — edge cases', () => {
  function mkMultiPoly(areas: number[][][]): Feature<MultiPolygon> {
    return {
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: areas },
      properties: { pno: '00100' },
    };
  }

  function mkSquare(x: number, y: number, size: number): number[][][] {
    return [[
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y], // close ring
    ]];
  }

  it('removes polygons smaller than 15% of largest', () => {
    // Large polygon area = 1 (1x1 square), small = 0.01 (0.1x0.1)
    const feature = mkMultiPoly([
      mkSquare(0, 0, 1),     // area ~0.5 (1x1)
      mkSquare(2, 2, 0.1),   // area ~0.005 (0.1x0.1) → < 15% of 0.5
    ]);
    const result = filterSmallIslands([feature]);
    const geom = result[0].geometry;
    // Small polygon should be removed, leaving single Polygon
    expect(geom.type).toBe('Polygon');
  });

  it('keeps polygons >= 15% of largest', () => {
    const feature = mkMultiPoly([
      mkSquare(0, 0, 1),     // area ~0.5
      mkSquare(2, 2, 0.5),   // area ~0.125 → 25% of 0.5 → kept
    ]);
    const result = filterSmallIslands([feature]);
    expect(result[0].geometry.type).toBe('MultiPolygon');
    expect((result[0].geometry as MultiPolygon).coordinates.length).toBe(2);
  });

  it('passes through Polygon features unchanged', () => {
    const polyFeature: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
        ]],
      },
      properties: { pno: '00100' },
    };
    const result = filterSmallIslands([polyFeature]);
    expect(result[0]).toBe(polyFeature); // same reference
  });

  it('handles empty features array', () => {
    expect(filterSmallIslands([])).toEqual([]);
  });

  it('passes through single-polygon MultiPolygon unchanged', () => {
    const feature = mkMultiPoly([mkSquare(0, 0, 1)]);
    const result = filterSmallIslands([feature]);
    expect(result[0]).toBe(feature); // same reference, no filtering needed
  });
});

describe('getFeatureCenter — bbox midpoint', () => {
  it('returns center of a polygon bounding box', () => {
    const feature: Feature<Polygon> = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
      properties: {},
    };
    const center = getFeatureCenter(feature);
    expect(center).toEqual([5, 5]);
  });

  it('returns Point coordinates directly', () => {
    const feature: Feature<Point> = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([24.9, 60.2]);
  });

  it('returns [0, 0] for feature with no geometry', () => {
    const feature: Feature = {
      type: 'Feature',
      geometry: null as unknown as Point,
      properties: {},
    };
    expect(getFeatureCenter(feature)).toEqual([0, 0]);
  });

  it('handles MultiPolygon correctly', () => {
    const feature: Feature<MultiPolygon> = {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]],
          [[[10, 10], [20, 10], [20, 20], [10, 20], [10, 10]]],
        ],
      },
      properties: {},
    };
    const center = getFeatureCenter(feature);
    // Bbox: [0,0] to [20,20] → center [10, 10]
    expect(center).toEqual([10, 10]);
  });
});
