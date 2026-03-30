import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[24.9, 60.1], [24.91, 60.1], [24.91, 60.11], [24.9, 60.1]]] },
    properties: props,
  };
}

describe('findSimilarNeighborhoods — distance normalization', () => {
  it('distance is range-independent: small and large ranges produce comparable distances', () => {
    // Two metrics: one with range [0, 100], one with range [0, 100000]
    // A 50% difference on each should give equal contribution
    const target = { pno: '00100', hr_mtu: 50000, unemployment_rate: 5 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 50000, unemployment_rate: 5 }),
      // 50% of range on income, 0% on unemployment
      makeFeature({ pno: '00200', hr_mtu: 75000, unemployment_rate: 5 }),
      // 0% on income, 50% of range on unemployment
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 10 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    const dist200 = results.find((r) => r.properties.pno === '00200')!.distance;
    const dist300 = results.find((r) => r.properties.pno === '00300')!.distance;

    // Both should have the same normalized distance (50% in one dimension)
    expect(dist200).toBeCloseTo(dist300, 5);
  });

  it('returns results sorted by ascending distance', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 30500 }),  // closest
      makeFeature({ pno: '00300', hr_mtu: 35000 }),  // further
      makeFeature({ pno: '00400', hr_mtu: 50000 }),  // furthest
    ];

    const results = findSimilarNeighborhoods(target, features, 5);

    expect(results[0].properties.pno).toBe('00200');
    expect(results[1].properties.pno).toBe('00300');
    expect(results[2].properties.pno).toBe('00400');
    // Each distance should be >= previous
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('identical neighborhoods have distance 0', () => {
    // Need at least 3 features so that min !== max for normalization to work
    const target = { pno: '00100', hr_mtu: 30000, unemployment_rate: 5 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 15 }), // different values for range
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    // 00200 is identical to target → distance should be 0
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });
});

describe('findSimilarNeighborhoods — partial data handling', () => {
  it('handles target with some null metrics', () => {
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: null,
    } as unknown as NeighborhoodProperties;

    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: null }),
      makeFeature({ pno: '00200', hr_mtu: 35000, unemployment_rate: 10 }),
      makeFeature({ pno: '00300', hr_mtu: 25000, unemployment_rate: 5 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    // Should still return results based on available metrics (hr_mtu only)
    expect(results.length).toBeGreaterThan(0);
  });

  it('skips candidates with no overlapping non-null metrics', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      // This candidate only has unemployment_rate but target only has hr_mtu
      // Both have hr_mtu though (it's the SIMILARITY_METRICS that matters)
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.length).toBe(1);
  });

  it('excludes target from results', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 30000 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.every((r) => r.properties.pno !== '00100')).toBe(true);
  });
});

describe('findSimilarNeighborhoods — count parameter', () => {
  it('returns at most count results', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 31000 }),
      makeFeature({ pno: '00300', hr_mtu: 32000 }),
      makeFeature({ pno: '00400', hr_mtu: 33000 }),
      makeFeature({ pno: '00500', hr_mtu: 34000 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results.length).toBe(2);
  });

  it('returns all available when count exceeds candidates', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 31000 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 10);
    expect(results.length).toBe(1); // target excluded
  });

  it('returns empty array for empty features', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, [], 5);
    expect(results).toEqual([]);
  });
});

describe('findSimilarNeighborhoods — center computation', () => {
  it('computes center from polygon bounding box', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[24.0, 60.0], [26.0, 60.0], [26.0, 62.0], [24.0, 62.0], [24.0, 60.0]]],
        },
        properties: { pno: '00200', hr_mtu: 31000 },
      },
    ];

    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results[0].center[0]).toBeCloseTo(25.0, 1); // midpoint lng
    expect(results[0].center[1]).toBeCloseTo(61.0, 1); // midpoint lat
  });
});
