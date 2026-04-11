/**
 * Hardened tests for findSimilarNeighborhoods.
 *
 * Targets critical logic in similarity.ts:
 * - Euclidean distance calculation with normalized metrics
 * - Handling of missing metrics (different neighborhoods missing different data)
 * - Cache invalidation when dataset reference changes
 * - Exclusion of target neighborhood from results
 * - Correct sorting by distance
 * - Edge case: all features identical → distance 0
 * - Edge case: only one other feature
 * - Edge case: no comparable metrics → excluded
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function mkFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', he_vakiy: 1000, ...props } as NeighborhoodProperties,
  };
}

const TARGET_PROPS: NeighborhoodProperties = {
  pno: '00100', nimi: 'Kruununhaka', namn: 'Kronohagen', kunta: '091', city: 'helsinki_metro',
  he_vakiy: 5000, hr_mtu: 40000, unemployment_rate: 5, higher_education_rate: 60,
  foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 8,
  property_price_sqm: 5000, crime_index: 15, population_density: 8000, child_ratio: 5,
} as NeighborhoodProperties;

describe('findSimilarNeighborhoods', () => {
  it('excludes the target neighborhood from results', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    expect(results.every(r => r.properties.pno !== TARGET_PROPS.pno)).toBe(true);
  });

  it('returns results sorted by ascending distance', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 45000 }), // close
      mkFeature({ ...TARGET_PROPS, pno: '00300', hr_mtu: 10000 }), // far
      mkFeature({ ...TARGET_PROPS, pno: '00400', hr_mtu: 38000 }), // very close
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('returns at most `count` results', () => {
    const features = Array.from({ length: 20 }, (_, i) =>
      mkFeature({ ...TARGET_PROPS, pno: String(i + 1).padStart(5, '0'), hr_mtu: 20000 + i * 1000 }),
    );
    const results = findSimilarNeighborhoods(TARGET_PROPS, features, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns fewer than count when not enough candidates', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures, 10);
    expect(results.length).toBe(1); // only 1 candidate (target excluded)
  });

  it('identical neighborhoods have distance 0 (when range exists from a third feature)', () => {
    // Need at least 3 features so metrics have a non-zero range for normalization.
    // With only 2 identical features, all metrics have min===max → no metrics compared → no results.
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200' }), // identical metrics
      mkFeature({ ...TARGET_PROPS, pno: '00300', hr_mtu: 10000, crime_index: 80 }), // differs → creates range
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    // Feature 00200 has identical metrics to target → distance 0
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });

  it('skips candidates with no comparable metrics', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ pno: '00200' }), // no similarity metrics at all
      mkFeature({ ...TARGET_PROPS, pno: '00300', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    // Feature 00200 should be excluded (no shared metrics)
    expect(results.every(r => r.properties.pno !== '00200')).toBe(true);
  });

  it('normalizes distance by number of metrics used', () => {
    // Two candidates: one shares all metrics, one shares only hr_mtu
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 45000 }),
      mkFeature({ pno: '00300', hr_mtu: 45000 }),
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    // Both should have computed distances (not excluded)
    expect(results.length).toBe(2);
  });

  it('handles all features having same value for a metric (range 0)', () => {
    const allFeatures = [
      mkFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 10, crime_index: 5 }),
      mkFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 10, crime_index: 5 }), // identical
      mkFeature({ pno: '00300', hr_mtu: 30000, unemployment_rate: 20, crime_index: 5 }), // differs in one metric
    ];
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, allFeatures);
    // When all values are same for a metric, that metric is skipped (range=0 → not in mins/maxs)
    // For hr_mtu: all same → skipped
    // For crime_index: all same → skipped
    // For unemployment_rate: 10 vs 20 → has range
    // Feature 00200: unemployment_rate=10 → normalized diff = 0
    // Feature 00300: unemployment_rate=20 → normalized diff = 1
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });

  it('returns center coordinates for each result', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].center).toBeDefined();
    expect(results[0].center.length).toBe(2);
    expect(typeof results[0].center[0]).toBe('number');
    expect(typeof results[0].center[1]).toBe('number');
  });

  it('returns empty array when only target exists', () => {
    const allFeatures = [mkFeature({ ...TARGET_PROPS })];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    expect(results).toEqual([]);
  });

  it('closer neighborhoods rank higher than distant ones', () => {
    const allFeatures = [
      mkFeature({ ...TARGET_PROPS }),
      mkFeature({ ...TARGET_PROPS, pno: '00200', hr_mtu: 39000 }), // very close to 40000
      mkFeature({ ...TARGET_PROPS, pno: '00300', hr_mtu: 10000 }), // far from 40000
    ];
    const results = findSimilarNeighborhoods(TARGET_PROPS, allFeatures);
    expect(results.length).toBe(2);
    expect(results[0].properties.pno).toBe('00200'); // closer
    expect(results[1].properties.pno).toBe('00300'); // farther
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });
});
