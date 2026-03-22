/**
 * Critical tests for similarity.ts — distance normalization,
 * partial data handling, and center computation edge cases.
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(
  props: Partial<NeighborhoodProperties>,
  geom?: GeoJSON.Geometry,
): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: geom ?? {
      type: 'Polygon',
      coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
    },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods — distance normalization', () => {
  it('distance is normalized by number of metrics used', () => {
    // Need varied values to establish min/max ranges
    const target = { pno: '00100', hr_mtu: 50000, unemployment_rate: 10 } as NeighborhoodProperties;
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 50000, unemployment_rate: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 10 }), // identical
      makeFeature({ pno: '00300', hr_mtu: 20000, unemployment_rate: 30 }), // different (establishes range)
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 2);
    expect(results.length).toBe(2);
    // First result should be the identical one (distance ≈ 0)
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBeCloseTo(0, 5);
    // Second result should be the different one
    expect(results[1].distance).toBeGreaterThan(0);
  });

  it('excludes target from results', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    expect(results.every((r) => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns empty array when only target exists', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const allFeatures = [makeFeature({ pno: '00100', hr_mtu: 40000 })];
    const results = findSimilarNeighborhoods(target, allFeatures);
    expect(results).toHaveLength(0);
  });

  it('handles features with null properties gracefully', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      { type: 'Feature' as const, geometry: null, properties: null } as GeoJSON.Feature,
      makeFeature({ pno: '00200', hr_mtu: 45000 }),
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    // Should skip null-properties feature
    expect(results).toHaveLength(1);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('skips candidates with zero comparable metrics', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    // Candidate has no overlap with any similarity metrics
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      makeFeature({ pno: '00200' }), // no metrics at all
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    expect(results).toHaveLength(0);
  });

  it('identical features have distance 0', () => {
    const target = {
      pno: '00100',
      hr_mtu: 40000,
      unemployment_rate: 8,
      higher_education_rate: 45,
      crime_index: 5,
    } as NeighborhoodProperties;

    const allFeatures = [
      makeFeature({ ...target }),
      makeFeature({ pno: '00200', hr_mtu: 40000, unemployment_rate: 8, higher_education_rate: 45, crime_index: 5 }),
      // Need a different feature to establish min/max ranges
      makeFeature({ pno: '00300', hr_mtu: 80000, unemployment_rate: 20, higher_education_rate: 80, crime_index: 50 }),
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 2);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });

  it('respects count parameter', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      makeFeature({ pno: '00200', hr_mtu: 41000 }),
      makeFeature({ pno: '00300', hr_mtu: 42000 }),
      makeFeature({ pno: '00400', hr_mtu: 43000 }),
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 2);
    expect(results).toHaveLength(2);
  });

  it('results are sorted by ascending distance', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      makeFeature({ pno: '00200', hr_mtu: 80000 }), // far
      makeFeature({ pno: '00300', hr_mtu: 41000 }), // close
      makeFeature({ pno: '00400', hr_mtu: 60000 }), // medium
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 3);
    expect(results[0].properties.pno).toBe('00300');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('center computation works for features with no geometry', () => {
    const target = { pno: '00100', hr_mtu: 40000 } as NeighborhoodProperties;
    const noGeom: GeoJSON.Feature = {
      type: 'Feature',
      geometry: null as unknown as GeoJSON.Geometry,
      properties: { pno: '00200', hr_mtu: 41000, nimi: 'X', namn: 'X' },
    };
    const allFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 40000 }),
      noGeom,
    ];
    const results = findSimilarNeighborhoods(target, allFeatures, 1);
    // Should still return result; center falls back to [0,0]
    expect(results).toHaveLength(1);
    expect(results[0].center).toEqual([0, 0]);
  });
});
