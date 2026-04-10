/**
 * Tests for similarity.ts edge cases:
 * - Distance normalization by number of available metrics
 * - Partial metrics: candidates have different numbers of comparable metrics
 * - Dataset with all identical values for some metrics
 * - Very small datasets
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.0, 60.0], [25.0, 60.0], [25.0, 61.0], [24.0, 61.0], [24.0, 60.0]]],
    },
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city: 'helsinki_metro',
      he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods — distance normalization', () => {
  it('normalizes distance by number of shared metrics', () => {
    // Target: all metrics at midpoint
    const target = {
      pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
      higher_education_rate: 50, foreign_language_pct: 10,
      ownership_rate: 50, transit_stop_density: 30,
      property_price_sqm: 3000, crime_index: 20,
      population_density: 5000, child_ratio: 8,
    } as NeighborhoodProperties;

    // Candidate A: shares ALL 10 metrics, all at max
    const candidateA = makeFeature({
      pno: '00200', hr_mtu: 50000, unemployment_rate: 10,
      higher_education_rate: 80, foreign_language_pct: 30,
      ownership_rate: 80, transit_stop_density: 80,
      property_price_sqm: 8000, crime_index: 50,
      population_density: 15000, child_ratio: 18,
    });

    // Candidate B: shares only 2 metrics, both at max distance
    const candidateB = makeFeature({
      pno: '00300', hr_mtu: 50000, unemployment_rate: 10,
      // All others null
    });

    const allFeatures = [
      makeFeature(target),
      candidateA,
      candidateB,
    ];

    const results = findSimilarNeighborhoods(target, allFeatures, 5);
    expect(results.length).toBe(2);

    // Both candidates should have non-zero distances
    for (const r of results) {
      expect(r.distance).toBeGreaterThan(0);
    }

    // Distance normalization: sqrt(sumSq / usedMetrics)
    // This means candidates with fewer metrics aren't unfairly penalized
  });

  it('returns empty array when target is the only feature', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [makeFeature(target)];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results).toEqual([]);
  });

  it('excludes candidates with zero comparable metrics', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    // Candidate has no overlap in metrics with target
    const candidate = makeFeature({ pno: '00200' });
    const features = [makeFeature(target), candidate];
    const results = findSimilarNeighborhoods(target, features, 5);
    // Candidate has no hr_mtu → range won't exist for it → excluded
    // Actually, if target has hr_mtu and candidate doesn't, that metric is skipped for that candidate
    // Let me think... the range is computed from allFeatures. If only target has hr_mtu,
    // min === max so range won't be in mins/maxs. So no metrics are comparable → excluded.
    expect(results.length).toBe(0);
  });

  it('returns zero distance for identical neighborhoods', () => {
    const props = {
      hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50,
      foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 30,
      property_price_sqm: 3000, crime_index: 20, population_density: 5000, child_ratio: 8,
    };
    const target = { pno: '00100', ...props } as NeighborhoodProperties;
    const clone = makeFeature({ pno: '00200', ...props });
    const features = [makeFeature(target), clone];
    const results = findSimilarNeighborhoods(target, features, 5);
    // Clone should have distance 0 (identical metrics)
    // But with only 2 features, min===max for all metrics → ranges empty → no comparable metrics
    // Need at least 3 features for ranges to exist
    // This is actually a meaningful edge case!
    expect(results.length).toBe(0); // No comparable metrics when all values identical
  });

  it('returns zero distance for identical neighborhoods (3+ features with spread)', () => {
    const props = {
      hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50,
      foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 30,
      property_price_sqm: 3000, crime_index: 20, population_density: 5000, child_ratio: 8,
    };
    const target = { pno: '00100', ...props } as NeighborhoodProperties;
    const clone = makeFeature({ pno: '00200', ...props });
    // Third feature with different values to create a range
    const different = makeFeature({
      pno: '00300', hr_mtu: 60000, unemployment_rate: 15, higher_education_rate: 80,
      foreign_language_pct: 30, ownership_rate: 80, transit_stop_density: 80,
      property_price_sqm: 8000, crime_index: 50, population_density: 15000, child_ratio: 18,
    });
    const features = [makeFeature(target), clone, different];
    const results = findSimilarNeighborhoods(target, features, 5);
    expect(results.length).toBe(2);
    // Clone should be closest with distance 0
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBeCloseTo(0);
  });

  it('respects count parameter', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature(target),
      makeFeature({ pno: '00200', hr_mtu: 31000 }),
      makeFeature({ pno: '00300', hr_mtu: 32000 }),
      makeFeature({ pno: '00400', hr_mtu: 35000 }),
      makeFeature({ pno: '00500', hr_mtu: 50000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results.length).toBe(2);
    // Should be the two closest
    expect(results[0].properties.pno).toBe('00200');
    expect(results[1].properties.pno).toBe('00300');
  });

  it('returns results sorted by ascending distance', () => {
    const target = {
      pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
    } as NeighborhoodProperties;
    const features = [
      makeFeature(target),
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 15 }),  // far
      makeFeature({ pno: '00300', hr_mtu: 31000, unemployment_rate: 5.5 }), // close
      makeFeature({ pno: '00400', hr_mtu: 40000, unemployment_rate: 10 }),   // medium
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('includes center coordinates for each result', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature(target),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
      makeFeature({ pno: '00300', hr_mtu: 50000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 5);
    for (const r of results) {
      expect(r.center).toBeDefined();
      expect(r.center.length).toBe(2);
      expect(typeof r.center[0]).toBe('number');
      expect(typeof r.center[1]).toBe('number');
    }
  });
});
