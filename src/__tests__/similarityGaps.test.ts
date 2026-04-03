import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.0, 60.0], [24.1, 60.0], [24.1, 60.1], [24.0, 60.1], [24.0, 60.0]]],
    },
    properties: props,
  };
}

function makeMultiPolyFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[24.0, 60.0], [24.05, 60.0], [24.05, 60.05], [24.0, 60.05], [24.0, 60.0]]],
        [[[24.1, 60.1], [24.15, 60.1], [24.15, 60.15], [24.1, 60.15], [24.1, 60.1]]],
      ],
    },
    properties: props,
  };
}

const baseProps = {
  hr_mtu: 30000,
  unemployment_rate: 10,
  higher_education_rate: 50,
  foreign_language_pct: 15,
  ownership_rate: 50,
  transit_stop_density: 30,
  property_price_sqm: 3000,
  crime_index: 60,
  population_density: 5000,
  child_ratio: 10,
};

describe('findSimilarNeighborhoods distance correctness', () => {
  it('returns distance=0 for an identical neighborhood', () => {
    const target = { pno: '00100', ...baseProps } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', ...baseProps }),
      makeFeature({ pno: '00200', ...baseProps }), // identical metrics
      // Need a third feature with different values so min/max ranges exist
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 20,
        higher_education_rate: 80, foreign_language_pct: 30, ownership_rate: 80,
        transit_stop_density: 60, property_price_sqm: 6000, crime_index: 100,
        population_density: 10000, child_ratio: 20 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);
    // 00200 is identical to target → distance 0
    expect(results[0].distance).toBe(0);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('computes correct Euclidean distance for a known case', () => {
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 10,
      higher_education_rate: 50,
    } as NeighborhoodProperties;

    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', hr_mtu: 40000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ pno: '00300', hr_mtu: 30000, unemployment_rate: 20, higher_education_rate: 50 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);

    // Both candidates differ on exactly one metric by the full range
    // For 00200: income is at max, target at min → diff=1.0 on income only
    //   distance = sqrt(1.0^2 / 1) = 1.0 (only income differs, normalized by 1 metric)
    // Wait — they share all 3 metrics. Let me recalculate.
    // Ranges: hr_mtu: 30000-40000, unemployment: 10-20, education: 50-50 (excluded, min===max)
    // 00200: income diff = (30000-40000)/(40000-30000) = normalized target=0, candidate=1 → diff=-1
    //        unemployment diff = 0 (both 10), but range is 10-20, normalized target=0, candidate=0 → diff=0
    //        education: excluded (min===max)
    //        sumSq = 1.0, usedMetrics = 2, distance = sqrt(1/2) ≈ 0.707
    // 00300: income diff = 0 (both 30000), normalized: target=0, candidate=0
    //        unemployment: target norm=0, candidate norm=1.0 → diff=-1
    //        sumSq = 1.0, usedMetrics = 2, distance = sqrt(1/2) ≈ 0.707
    expect(results).toHaveLength(2);
    expect(results[0].distance).toBeCloseTo(results[1].distance, 5);
    expect(results[0].distance).toBeCloseTo(Math.sqrt(0.5), 5);
  });

  it('returns results sorted by ascending distance', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 50000 }), // far
      makeFeature({ pno: '00300', hr_mtu: 35000 }), // close
      makeFeature({ pno: '00400', hr_mtu: 10000 }), // far (min)
    ];

    const results = findSimilarNeighborhoods(target, features, 3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
    expect(results[0].properties.pno).toBe('00300'); // closest
  });
});

describe('findSimilarNeighborhoods normalization', () => {
  it('normalizes distance by number of used metrics', () => {
    // Two features that differ on 1 metric vs 2 metrics
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
    } as NeighborhoodProperties;

    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5 }),
      // Differs only on income
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 5 }),
      // Differs only on unemployment
      makeFeature({ pno: '00300', hr_mtu: 30000, unemployment_rate: 15 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);
    // Both differ on one dimension by the full range → same distance
    expect(results[0].distance).toBeCloseTo(results[1].distance, 5);
  });

  it('excludes candidates with no comparable metrics', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200' }), // no metrics at all
    ];

    const results = findSimilarNeighborhoods(target, features);
    expect(results).toHaveLength(0);
  });

  it('skips metrics where target value is non-numeric', () => {
    const target = {
      pno: '00100',
      hr_mtu: null, // non-numeric
      unemployment_rate: 10,
    } as unknown as NeighborhoodProperties;

    const features = [
      makeFeature({ pno: '00100', hr_mtu: null, unemployment_rate: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 10 }),
      makeFeature({ pno: '00300', hr_mtu: 40000, unemployment_rate: 20 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);
    // Income is skipped for target, so only unemployment is compared
    // 00200 has same unemployment → distance 0
    expect(results[0].distance).toBe(0);
  });
});

describe('findSimilarNeighborhoods center computation', () => {
  it('returns correct center for Polygon feature', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
    ];

    const results = findSimilarNeighborhoods(target, features);
    expect(results).toHaveLength(1);
    // Bounding box center of [[24.0, 60.0], [24.1, 60.0], [24.1, 60.1], [24.0, 60.1]]
    expect(results[0].center[0]).toBeCloseTo(24.05, 2);
    expect(results[0].center[1]).toBeCloseTo(60.05, 2);
  });

  it('returns correct center for MultiPolygon feature', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeMultiPolyFeature({ pno: '00200', hr_mtu: 40000 }),
    ];

    const results = findSimilarNeighborhoods(target, features);
    expect(results).toHaveLength(1);
    // Bounding box: lng [24.0, 24.15], lat [60.0, 60.15]
    expect(results[0].center[0]).toBeCloseTo(24.075, 2);
    expect(results[0].center[1]).toBeCloseTo(60.075, 2);
  });
});

describe('findSimilarNeighborhoods count parameter', () => {
  it('returns requested count', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = Array.from({ length: 20 }, (_, i) =>
      makeFeature({ pno: String(i).padStart(5, '0'), hr_mtu: 20000 + i * 1000 }),
    );
    // Mark the target
    (features[10].properties as Record<string, unknown>).pno = '00100';
    (features[10].properties as Record<string, unknown>).hr_mtu = 30000;

    const results = findSimilarNeighborhoods(target, features, 3);
    expect(results).toHaveLength(3);
  });

  it('returns fewer than count if not enough candidates', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 10);
    expect(results).toHaveLength(1);
  });
});
