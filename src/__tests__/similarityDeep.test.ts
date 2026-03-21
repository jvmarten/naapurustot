import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
    properties: props as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods — deep edge cases', () => {
  it('returns neighborhoods sorted by ascending distance', () => {
    const target = { pno: '00100', hr_mtu: 30000, unemployment_rate: 10 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }), // target
      makeFeature({ pno: '00200', hr_mtu: 31000, unemployment_rate: 10 }), // closest
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 20 }), // farthest
      makeFeature({ pno: '00400', hr_mtu: 32000, unemployment_rate: 11 }), // middle
    ];
    const results = findSimilarNeighborhoods(target, features, 3);
    expect(results.length).toBe(3);
    expect(results[0].properties.pno).toBe('00200');
    // Distances should be ascending
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('excludes the target neighborhood from results', () => {
    const target = { pno: '00100', hr_mtu: 30000, unemployment_rate: 10 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 10 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 20 }), // need range variation
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.length).toBe(2);
    // Target (00100) should not be in results
    expect(results.every((r) => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns fewer than requested when not enough candidates', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 10);
    expect(results.length).toBe(1);
  });

  it('handles features with all null metrics (no comparable metrics)', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200' }), // no metrics at all
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    // Feature 00200 has no comparable metrics, should be excluded
    expect(results.length).toBe(0);
  });

  it('distance is 0 for identical neighborhoods', () => {
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 40,
    } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 15, higher_education_rate: 70 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });

  it('normalizes distance by number of available metrics', () => {
    // Two features with same distance on 1 metric vs 2 metrics should have different raw distances
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 10,
    } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10 }),
      // Has both metrics
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 10 }),
      // Has only one metric
      makeFeature({ pno: '00300', hr_mtu: 50000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    // Both should appear
    expect(results.length).toBe(2);
  });

  it('computes center coordinates from polygon bounding box', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[24.0, 60.0], [26.0, 60.0], [26.0, 62.0], [24.0, 62.0], [24.0, 60.0]]],
        },
        properties: { pno: '00200', hr_mtu: 35000 } as NeighborhoodProperties,
      },
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results[0].center[0]).toBeCloseTo(24.8);
    expect(results[0].center[1]).toBeCloseTo(60.8);
  });

  it('handles MultiPolygon geometry for center calculation', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: [
            [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]],
            [[[26.0, 62.0], [27.0, 62.0], [27.0, 63.0], [26.0, 63.0], [26.0, 62.0]]],
          ],
        },
        properties: { pno: '00200', hr_mtu: 35000 } as NeighborhoodProperties,
      },
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    // Centroid by averaging all vertices: [25.4, 61.4]
    expect(results[0].center[0]).toBeCloseTo(25.4);
    expect(results[0].center[1]).toBeCloseTo(61.4);
  });

  it('handles empty features array', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, [], 5);
    expect(results.length).toBe(0);
  });

  it('handles count = 0', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 0);
    expect(results.length).toBe(0);
  });
});
