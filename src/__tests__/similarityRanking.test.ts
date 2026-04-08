/**
 * Tests for similarity ranking correctness.
 *
 * Verifies that findSimilarNeighborhoods returns neighbors in correct distance
 * order, handles edge cases like identical features, single-metric comparisons,
 * and datasets where some metrics are uniform. Bugs here show users wrong
 * "similar neighborhoods" recommendations.
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(pno: string, props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
    },
    properties: { pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, ...props } as NeighborhoodProperties,
  };
}

describe('findSimilarNeighborhoods ranking', () => {
  it('returns the most similar neighborhood first', () => {
    const target: NeighborhoodProperties = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 50,
      foreign_language_pct: 10,
      ownership_rate: 60,
      transit_stop_density: 10,
      property_price_sqm: 4000,
      crime_index: 5,
      population_density: 3000,
      child_ratio: 8,
    } as NeighborhoodProperties;

    const features = [
      makeFeature('00100', target as Partial<NeighborhoodProperties>),
      // Nearly identical
      makeFeature('00200', { ...target, pno: '00200', hr_mtu: 30100, unemployment_rate: 5.1 }),
      // Very different
      makeFeature('00300', { ...target, pno: '00300', hr_mtu: 80000, unemployment_rate: 20, crime_index: 50 }),
      // Moderately different
      makeFeature('00400', { ...target, pno: '00400', hr_mtu: 35000, unemployment_rate: 7 }),
    ];

    const result = findSimilarNeighborhoods(target, features, 3);
    expect(result[0].properties.pno).toBe('00200'); // Most similar
    expect(result[0].distance).toBeLessThan(result[1].distance);
    expect(result[1].distance).toBeLessThan(result[2].distance);
  });

  it('excludes the target neighborhood itself', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: 31000 }),
    ];
    const result = findSimilarNeighborhoods(target, features, 5);
    expect(result.every((r) => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns fewer results than count if dataset is small', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: 31000 }),
    ];
    const result = findSimilarNeighborhoods(target, features, 10);
    expect(result).toHaveLength(1); // Only 1 non-target feature
  });

  it('returns empty array when no comparable metrics exist', () => {
    const target = { pno: '00100' } as NeighborhoodProperties;
    const features = [
      makeFeature('00100', {}),
      makeFeature('00200', {}),
    ];
    const result = findSimilarNeighborhoods(target, features, 5);
    expect(result).toEqual([]);
  });

  it('normalizes distance by metrics used for fairness', () => {
    // Feature A shares 3 metrics with target, all slightly different
    // Feature B shares only 1 metric with target, also slightly different
    // Distance normalization (sqrt(sumSq / usedMetrics)) ensures comparability
    const target = {
      pno: '00100',
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 50,
    } as NeighborhoodProperties;

    const features = [
      makeFeature('00100', target as Partial<NeighborhoodProperties>),
      makeFeature('00200', {
        hr_mtu: 32000,
        unemployment_rate: 6,
        higher_education_rate: 52,
      }),
      // Only shares one metric
      makeFeature('00300', { hr_mtu: 32000 }),
    ];

    const result = findSimilarNeighborhoods(target, features, 2);
    // Both should be returned — single-metric features aren't excluded
    expect(result.length).toBe(2);
    // All distances should be finite
    expect(result.every((r) => isFinite(r.distance))).toBe(true);
  });

  it('distance is zero for identical features (different PNO)', () => {
    const sharedMetrics = {
      hr_mtu: 30000,
      unemployment_rate: 5,
      higher_education_rate: 50,
      foreign_language_pct: 10,
      ownership_rate: 60,
      transit_stop_density: 10,
      property_price_sqm: 4000,
      crime_index: 5,
      population_density: 3000,
      child_ratio: 8,
    };

    const target = { pno: '00100', ...sharedMetrics } as NeighborhoodProperties;

    // Need at least 3 features so min !== max for at least some metrics
    const features = [
      makeFeature('00100', sharedMetrics),
      makeFeature('00200', sharedMetrics),
      // A different feature to create variation in the dataset
      makeFeature('00300', {
        hr_mtu: 50000, unemployment_rate: 15, higher_education_rate: 80,
        foreign_language_pct: 30, ownership_rate: 30, transit_stop_density: 20,
        property_price_sqm: 8000, crime_index: 20, population_density: 6000, child_ratio: 15,
      }),
    ];

    const result = findSimilarNeighborhoods(target, features, 1);
    expect(result).toHaveLength(1);
    expect(result[0].properties.pno).toBe('00200');
    expect(result[0].distance).toBe(0);
  });

  it('each result has a valid center coordinate', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: 31000 }),
    ];
    const result = findSimilarNeighborhoods(target, features, 5);
    for (const r of result) {
      expect(r.center).toHaveLength(2);
      expect(typeof r.center[0]).toBe('number');
      expect(typeof r.center[1]).toBe('number');
    }
  });

  it('handles features with NaN/Infinity metric values gracefully', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature('00100', { hr_mtu: 30000 }),
      makeFeature('00200', { hr_mtu: NaN }),
      makeFeature('00300', { hr_mtu: Infinity }),
      makeFeature('00400', { hr_mtu: 31000 }),
    ];
    const result = findSimilarNeighborhoods(target, features, 5);
    // NaN/Infinity features should be excluded or handled without crashing
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((r) => isFinite(r.distance))).toBe(true);
  });
});
