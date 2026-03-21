import { describe, it, expect, vi } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', ...props },
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
  };
}

describe('findSimilarNeighborhoods — edge cases', () => {
  it('returns fewer results when fewer candidates exist', () => {
    const target = makeFeature({ pno: '00100', hr_mtu: 30000 });
    const features = [
      target,
      makeFeature({ pno: '00200', hr_mtu: 31000 }),
      makeFeature({ pno: '00300', hr_mtu: 32000 }),
    ];
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
      5,
    );
    expect(result.length).toBe(2); // only 2 candidates (target excluded)
  });

  it('returns results sorted by ascending distance', () => {
    const target = makeFeature({
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
    });
    const features = [
      target,
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 20 }), // very different
      makeFeature({ pno: '00300', hr_mtu: 31000, unemployment_rate: 6 }),   // very similar
      makeFeature({ pno: '00400', hr_mtu: 40000, unemployment_rate: 10 }),  // moderately different
    ];
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
    );
    // Most similar should be first
    expect(result[0].properties.pno).toBe('00300');
    // Verify distance ordering
    for (let i = 1; i < result.length; i++) {
      expect(result[i].distance).toBeGreaterThanOrEqual(result[i - 1].distance);
    }
  });

  it('computes center coordinates from polygon geometry', () => {
    const target = makeFeature({ pno: '00100', hr_mtu: 30000 });
    const candidate = {
      type: 'Feature' as const,
      properties: { pno: '00200', nimi: 'Candidate', hr_mtu: 31000 },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[24.0, 60.0], [26.0, 60.0], [26.0, 62.0], [24.0, 62.0], [24.0, 60.0]]],
      },
    };
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, candidate],
    );
    expect(result.length).toBe(1);
    // Centroid by averaging vertices: [24.8, 60.8]
    expect(result[0].center[0]).toBeCloseTo(24.8);
    expect(result[0].center[1]).toBeCloseTo(60.8);
  });

  it('handles MultiPolygon geometry for center calculation', () => {
    const target = makeFeature({ pno: '00100', hr_mtu: 30000 });
    const candidate = {
      type: 'Feature' as const,
      properties: { pno: '00200', nimi: 'Multi', hr_mtu: 31000 },
      geometry: {
        type: 'MultiPolygon' as const,
        coordinates: [
          [[[10.0, 50.0], [20.0, 50.0], [20.0, 60.0], [10.0, 60.0], [10.0, 50.0]]],
          [[[30.0, 50.0], [40.0, 50.0], [40.0, 60.0], [30.0, 60.0], [30.0, 50.0]]],
        ],
      },
    };
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      [target, candidate],
    );
    expect(result.length).toBe(1);
    // Centroid by averaging all vertices: [24, 54]
    expect(result[0].center[0]).toBeCloseTo(24.0);
    expect(result[0].center[1]).toBeCloseTo(54.0);
  });

  it('normalizes distance by number of used metrics', () => {
    // When metrics have range, identical values should produce distance 0
    const target = makeFeature({
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
    });
    const identical = makeFeature({
      pno: '00200',
      hr_mtu: 30000,
      unemployment_rate: 5,
    });
    // Need a third feature to create min/max range
    const different = makeFeature({
      pno: '00300',
      hr_mtu: 50000,
      unemployment_rate: 15,
    });
    const features = [target, identical, different];
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
    );
    // identical should be first with distance 0
    expect(result[0].properties.pno).toBe('00200');
    expect(result[0].distance).toBe(0);
  });

  it('skips candidates with no comparable metrics', () => {
    const target = makeFeature({
      pno: '00100',
      hr_mtu: 30000,
    });
    // Candidate has no metrics that overlap with similarity metrics
    const candidate = makeFeature({
      pno: '00200',
      // only non-similarity metrics
    });
    const features = [target, candidate];
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
    );
    // hr_mtu range would be [30000, 30000] => min === max => range not registered
    // So candidate has no comparable metrics
    expect(result.length).toBe(0);
  });

  it('respects custom count parameter', () => {
    const target = makeFeature({ pno: '00100', hr_mtu: 30000 });
    const features = [target];
    for (let i = 1; i <= 10; i++) {
      features.push(makeFeature({ pno: `001${String(i).padStart(2, '0')}`, hr_mtu: 30000 + i * 1000 }));
    }
    const result = findSimilarNeighborhoods(
      target.properties as NeighborhoodProperties,
      features,
      3,
    );
    expect(result.length).toBe(3);
  });
});
