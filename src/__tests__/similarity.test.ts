import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, any>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
    properties: props,
  };
}

describe('findSimilarNeighborhoods', () => {
  it('returns the correct number of results', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 31000, unemployment_rate: 11, higher_education_rate: 51 }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 32000, unemployment_rate: 12, higher_education_rate: 52 }),
      makeFeature({ pno: '00400', nimi: 'C', namn: 'C', hr_mtu: 33000, unemployment_rate: 13, higher_education_rate: 53 }),
      makeFeature({ pno: '00500', nimi: 'D', namn: 'D', hr_mtu: 34000, unemployment_rate: 14, higher_education_rate: 54 }),
      makeFeature({ pno: '00600', nimi: 'E', namn: 'E', hr_mtu: 35000, unemployment_rate: 15, higher_education_rate: 55 }),
      makeFeature({ pno: '00700', nimi: 'F', namn: 'F', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 3);
    expect(result).toHaveLength(3);
  });

  it('excludes the target neighborhood from results', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: 31000, unemployment_rate: 11, higher_education_rate: 51 }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    const pnos = result.map((r) => r.properties.pno);
    expect(pnos).not.toContain('00100');
  });

  it('handles empty features array', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const result = findSimilarNeighborhoods(target as any, [], 5);
    expect(result).toHaveLength(0);
  });

  it('handles features with null metrics', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', nimi: 'A', namn: 'A', hr_mtu: null, unemployment_rate: null, higher_education_rate: null }),
      makeFeature({ pno: '00300', nimi: 'B', namn: 'B', hr_mtu: 35000, unemployment_rate: 12, higher_education_rate: 55 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    // Feature with all null metrics should be excluded (no comparable metrics)
    const pnos = result.map((r) => r.properties.pno);
    expect(pnos).not.toContain('00200');
    expect(pnos).toContain('00300');
  });

  it('returns distance of 0 for identical neighborhoods', () => {
    const target = {
      pno: '00100',
      nimi: 'Target',
      namn: 'Target',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    };

    const features = [
      makeFeature({ pno: '00100', nimi: 'Target', namn: 'Target', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      // Same metrics, different pno
      makeFeature({ pno: '00200', nimi: 'Clone', namn: 'Clone', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      // Different metrics to establish a min-max range
      makeFeature({ pno: '00300', nimi: 'Different', namn: 'Different', hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 80 }),
    ];

    const result = findSimilarNeighborhoods(target as any, features, 5);
    const clone = result.find((r) => r.properties.pno === '00200');
    expect(clone).toBeDefined();
    expect(clone!.distance).toBe(0);
  });
});
