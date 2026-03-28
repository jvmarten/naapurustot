import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
    properties: props,
  };
}

describe('findSimilarNeighborhoods — untested branches', () => {
  it('excludes candidates where no metrics are comparable (usedMetrics === 0)', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      // This candidate has completely different metrics (no overlap with SIMILARITY_METRICS)
      makeFeature({ pno: '00200', some_other_metric: 999 }),
      makeFeature({ pno: '00300', hr_mtu: 35000, unemployment_rate: 12 }),
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    const pnos = result.map((r) => r.properties.pno);
    expect(pnos).not.toContain('00200');
    expect(pnos).toContain('00300');
  });

  it('returns empty array when only the target feature exists', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    expect(result).toHaveLength(0);
  });

  it('computes center from Polygon geometry', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]],
        },
        properties: { pno: '00200', hr_mtu: 35000, unemployment_rate: 12 },
      },
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    expect(result).toHaveLength(1);
    // Center should be midpoint of bounding box: [24.5, 60.5]
    expect(result[0].center[0]).toBeCloseTo(24.5, 1);
    expect(result[0].center[1]).toBeCloseTo(60.5, 1);
  });

  it('computes center from MultiPolygon geometry', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: [
            [[[20.0, 60.0], [22.0, 60.0], [22.0, 62.0], [20.0, 62.0], [20.0, 60.0]]],
            [[[24.0, 60.0], [26.0, 60.0], [26.0, 62.0], [24.0, 62.0], [24.0, 60.0]]],
          ],
        },
        properties: { pno: '00200', hr_mtu: 35000, unemployment_rate: 12 },
      },
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    expect(result).toHaveLength(1);
    // Bounding box: [20, 60] to [26, 62], center = [23, 61]
    expect(result[0].center[0]).toBeCloseTo(23.0, 1);
    expect(result[0].center[1]).toBeCloseTo(61.0, 1);
  });

  it('returns [0,0] center for feature with no geometry', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      {
        type: 'Feature' as const,
        geometry: null as unknown as GeoJSON.Geometry,
        properties: { pno: '00200', hr_mtu: 35000, unemployment_rate: 12 },
      },
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    expect(result).toHaveLength(1);
    expect(result[0].center).toEqual([0, 0]);
  });

  it('normalizes distance by metric count for fair comparison', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
      higher_education_rate: 50,
    };
    // A has only 1 comparable metric, B has all 3
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }), // only 1 metric
      makeFeature({ pno: '00300', hr_mtu: 35000, unemployment_rate: 12, higher_education_rate: 55 }),
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    // Both should be included
    expect(result).toHaveLength(2);
    // Distances should be finite, non-negative
    for (const r of result) {
      expect(r.distance).toBeGreaterThanOrEqual(0);
      expect(isFinite(r.distance)).toBe(true);
    }
  });

  it('sorts results by ascending distance (most similar first)', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 25 }), // far
      makeFeature({ pno: '00300', hr_mtu: 31000, unemployment_rate: 11 }), // close
      makeFeature({ pno: '00400', hr_mtu: 40000, unemployment_rate: 18 }), // medium
    ];
    const result = findSimilarNeighborhoods(target as any, features, 5);
    expect(result[0].properties.pno).toBe('00300');
    expect(result[result.length - 1].properties.pno).toBe('00200');
    // Verify sorted
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
    }
  });

  it('skips features with null properties', () => {
    const target = {
      pno: '00100', nimi: 'T', namn: 'T',
      hr_mtu: 30000, unemployment_rate: 10,
    };
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: null },
      makeFeature({ pno: '00300', hr_mtu: 35000, unemployment_rate: 12 }),
    ];
    const result = findSimilarNeighborhoods(target as any, features as Feature[], 5);
    expect(result).toHaveLength(1);
    expect(result[0].properties.pno).toBe('00300');
  });
});
