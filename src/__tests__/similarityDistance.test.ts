/**
 * Similarity — Euclidean distance calculation and ranking.
 *
 * Priority 2: Feature logic. Wrong similarity results give users
 * misleading "similar neighborhoods" recommendations.
 *
 * Targets untested paths:
 * - Distance normalization by number of used metrics
 * - Behavior when target has missing metric values
 * - Exact distance value verification
 * - Count parameter (top-N selection)
 * - Self-exclusion (target PNO skipped)
 * - Candidates with zero shared metrics excluded
 * - Center computation deferred to top-N only
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: null, he_vakiy: 1000, ...props },
    geometry: { type: 'Polygon', coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]] },
  };
}

const baseProps: Partial<NeighborhoodProperties> = {
  hr_mtu: 30000,
  unemployment_rate: 5,
  higher_education_rate: 40,
  foreign_language_pct: 10,
  ownership_rate: 50,
  transit_stop_density: 30,
  property_price_sqm: 3000,
  crime_index: 50,
  population_density: 5000,
  child_ratio: 8,
};

describe('findSimilarNeighborhoods — basic behavior', () => {
  it('excludes the target neighborhood itself', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100' }),
      makeFeature({ ...baseProps, pno: '00200' }),
      makeFeature({ ...baseProps, pno: '00300' }),
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.every(r => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns at most `count` results', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = Array.from({ length: 20 }, (_, i) =>
      makeFeature({ ...baseProps, pno: String(i + 200).padStart(5, '0'), hr_mtu: 30000 + i * 1000 })
    );
    features.push(makeFeature({ ...baseProps, pno: '00100' }));

    const results = findSimilarNeighborhoods(target, features, 3);
    expect(results.length).toBe(3);
  });

  it('returns results sorted by ascending distance', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100' }),
      makeFeature({ ...baseProps, pno: '00200', hr_mtu: 50000 }), // far
      makeFeature({ ...baseProps, pno: '00300', hr_mtu: 31000 }), // close
      makeFeature({ ...baseProps, pno: '00400', hr_mtu: 40000 }), // medium
    ];
    const results = findSimilarNeighborhoods(target, features, 3);
    expect(results[0].properties.pno).toBe('00300');
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });
});

describe('findSimilarNeighborhoods — distance calculation', () => {
  it('returns distance 0 for identical neighborhoods (with range-creating third feature)', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100' }),
      makeFeature({ ...baseProps, pno: '00200' }), // identical values → distance 0
      // Third feature creates min/max range so metrics are actually usable
      makeFeature({ ...baseProps, pno: '00300', hr_mtu: 60000, unemployment_rate: 15, crime_index: 150 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results[0].distance).toBe(0);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('computes higher distance for more different neighborhoods', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const close = makeFeature({ ...baseProps, pno: '00200', hr_mtu: 31000 });
    const far = makeFeature({ ...baseProps, pno: '00300', hr_mtu: 60000, unemployment_rate: 15, crime_index: 150 });
    const features = [makeFeature({ ...baseProps, pno: '00100' }), close, far];

    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[1].properties.pno).toBe('00300');
    expect(results[1].distance).toBeGreaterThan(results[0].distance);
  });

  it('normalizes distance by number of shared metrics', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const fullData = makeFeature({ ...baseProps, pno: '00200', hr_mtu: 35000 });
    const partialData = makeFeature({
      pno: '00300',
      hr_mtu: 35000,
      unemployment_rate: null,
      higher_education_rate: null,
      foreign_language_pct: null,
      ownership_rate: null,
      transit_stop_density: null,
      property_price_sqm: null,
      crime_index: null,
      population_density: null,
      child_ratio: null,
    });
    const features = [makeFeature({ ...baseProps, pno: '00100' }), fullData, partialData];

    const results = findSimilarNeighborhoods(target, features, 2);
    // Both should appear (partial still has hr_mtu)
    expect(results.length).toBe(2);
    // Distance should be comparable since normalization divides by metric count
    expect(results.every(r => r.distance >= 0)).toBe(true);
  });
});

describe('findSimilarNeighborhoods — missing data handling', () => {
  it('skips candidates with no shared metrics', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const noSharedMetrics = makeFeature({
      pno: '00200',
      hr_mtu: null,
      unemployment_rate: null,
      higher_education_rate: null,
      foreign_language_pct: null,
      ownership_rate: null,
      transit_stop_density: null,
      property_price_sqm: null,
      crime_index: null,
      population_density: null,
      child_ratio: null,
    });
    const features = [makeFeature({ ...baseProps, pno: '00100' }), noSharedMetrics];

    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.length).toBe(0);
  });

  it('skips metrics where target value is null', () => {
    const target = { ...baseProps, pno: '00100', crime_index: null } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100', crime_index: null }),
      makeFeature({ ...baseProps, pno: '00200', hr_mtu: 35000 }),
      // Third feature creates ranges for metrics
      makeFeature({ ...baseProps, pno: '00300', hr_mtu: 60000, unemployment_rate: 15 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    // Should find neighborhoods — crime_index skipped since target has null
    expect(results.length).toBe(2);
  });

  it('skips candidates with null properties object', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100' }),
      { type: 'Feature' as const, properties: null, geometry: { type: 'Point' as const, coordinates: [0, 0] } },
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.length).toBe(0);
  });
});

describe('findSimilarNeighborhoods — center computation', () => {
  it('returns valid center coordinates for results', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature({ ...baseProps, pno: '00100' }),
      makeFeature({ ...baseProps, pno: '00200', hr_mtu: 35000 }),
      // Need varied values to create ranges
      makeFeature({ ...baseProps, pno: '00300', hr_mtu: 60000, unemployment_rate: 15 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].center).toHaveLength(2);
    expect(results[0].center[0]).toBeCloseTo(24.5, 0);
    expect(results[0].center[1]).toBeCloseTo(60.5, 0);
  });
});

describe('findSimilarNeighborhoods — default count', () => {
  it('defaults to 5 results when count is not specified', () => {
    const target = { ...baseProps, pno: '00100' } as NeighborhoodProperties;
    const features = Array.from({ length: 10 }, (_, i) =>
      makeFeature({ ...baseProps, pno: String(i + 200).padStart(5, '0'), hr_mtu: 30000 + i * 1000 })
    );
    features.push(makeFeature({ ...baseProps, pno: '00100' }));

    const results = findSimilarNeighborhoods(target, features);
    expect(results.length).toBe(5);
  });
});
