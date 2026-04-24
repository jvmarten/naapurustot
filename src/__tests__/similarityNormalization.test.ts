/**
 * Tests for similarity scoring normalization correctness.
 *
 * findSimilarNeighborhoods uses Euclidean distance on min-max normalized metrics.
 * Bugs in normalization would rank neighborhoods incorrectly — a user looking at
 * "similar neighborhoods" would see completely wrong suggestions.
 *
 * Key invariants:
 * - Distance is always non-negative
 * - Self-distance would be 0 (self is excluded)
 * - Distance is symmetric: dist(A, B) === dist(B, A)
 * - Normalization uses dataset-wide min/max, not just the compared pair
 * - Missing metrics are skipped, not treated as 0
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(pno: string, props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: '091',
      city: 'helsinki_metro',
      he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.2], [24.91, 60.2], [24.91, 60.21], [24.9, 60.21], [24.9, 60.2]]],
    },
  };
}

describe('findSimilarNeighborhoods — distance properties', () => {
  const features = [
    makeFeature('00100', { hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40 }),
    makeFeature('00200', { hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40 }),
    makeFeature('00300', { hr_mtu: 50000, unemployment_rate: 15, higher_education_rate: 80 }),
    makeFeature('00400', { hr_mtu: 40000, unemployment_rate: 10, higher_education_rate: 60 }),
  ];

  it('identical neighborhoods have distance 0', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    const twin = results.find((r) => r.properties.pno === '00200');
    expect(twin).toBeDefined();
    expect(twin!.distance).toBe(0);
  });

  it('excludes the target neighborhood from results', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results.find((r) => r.properties.pno === '00100')).toBeUndefined();
  });

  it('all distances are non-negative', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    for (const r of results) {
      expect(r.distance).toBeGreaterThanOrEqual(0);
    }
  });

  it('results are sorted by ascending distance', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('distance is symmetric: dist(A, B) ≈ dist(B, A)', () => {
    const targetA = features[0].properties as NeighborhoodProperties;
    const targetC = features[2].properties as NeighborhoodProperties;

    const fromA = findSimilarNeighborhoods(targetA, features);
    const fromC = findSimilarNeighborhoods(targetC, features);

    const distAtoC = fromA.find((r) => r.properties.pno === '00300')!.distance;
    const distCtoA = fromC.find((r) => r.properties.pno === '00100')!.distance;

    expect(distAtoC).toBeCloseTo(distCtoA, 10);
  });

  it('respects count parameter', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results).toHaveLength(2);
  });

  it('returns fewer results than count when not enough candidates', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features, 100);
    expect(results).toHaveLength(3);
  });
});

describe('findSimilarNeighborhoods — missing data handling', () => {
  it('skips candidates with no comparable metrics', () => {
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', {}),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results).toHaveLength(0);
  });

  it('compares only shared metrics between target and candidate', () => {
    const features = [
      makeFeature('00100', { hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature('00200', { hr_mtu: 31000 }),
      makeFeature('00300', { hr_mtu: 50000 }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('each result includes a center coordinate', () => {
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: 35000 }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results[0].center).toBeDefined();
    expect(results[0].center).toHaveLength(2);
    expect(typeof results[0].center[0]).toBe('number');
    expect(typeof results[0].center[1]).toBe('number');
  });
});

describe('findSimilarNeighborhoods — range caching', () => {
  it('produces same results on repeated calls with same features reference', () => {
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: 35000 }),
      makeFeature('00300', { hr_mtu: 40000 }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const r1 = findSimilarNeighborhoods(target, features);
    const r2 = findSimilarNeighborhoods(target, features);

    expect(r1.map((r) => r.properties.pno)).toEqual(r2.map((r) => r.properties.pno));
    expect(r1.map((r) => r.distance)).toEqual(r2.map((r) => r.distance));
  });
});
