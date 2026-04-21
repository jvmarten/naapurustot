/**
 * Integration tests for similarity search — tests the full pipeline from
 * raw features to ranked similar neighborhoods.
 *
 * Focus:
 * - Euclidean distance is symmetric (distance(A,B) === distance(B,A))
 * - Results are sorted by ascending distance
 * - Target is excluded from results
 * - Missing data handling (features with null metrics)
 * - Normalization by number of usable metrics
 * - Count parameter limits output
 */
import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      he_vakiy: 5000, ...props,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
  };
}

describe('findSimilarNeighborhoods — core behavior', () => {
  const features = [
    makeFeature({
      pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
      higher_education_rate: 40, foreign_language_pct: 10,
      ownership_rate: 50, transit_stop_density: 30,
      property_price_sqm: 4000, crime_index: 50,
      population_density: 5000, child_ratio: 8,
    }),
    makeFeature({
      pno: '00200', hr_mtu: 32000, unemployment_rate: 4.5,
      higher_education_rate: 42, foreign_language_pct: 11,
      ownership_rate: 52, transit_stop_density: 32,
      property_price_sqm: 4200, crime_index: 48,
      population_density: 5200, child_ratio: 7.5,
    }),
    makeFeature({
      pno: '00300', hr_mtu: 50000, unemployment_rate: 2,
      higher_education_rate: 70, foreign_language_pct: 5,
      ownership_rate: 80, transit_stop_density: 10,
      property_price_sqm: 8000, crime_index: 20,
      population_density: 3000, child_ratio: 12,
    }),
  ];

  it('excludes the target neighborhood from results', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results.every((r) => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns results sorted by ascending distance', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    for (let i = 1; i < results.length; i++) {
      expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
    }
  });

  it('00200 is more similar to 00100 than 00300 is', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    expect(results[0].properties.pno).toBe('00200');
    expect(results[1].properties.pno).toBe('00300');
  });

  it('respects count parameter', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features, 1);
    expect(results.length).toBe(1);
  });

  it('returns fewer results when dataset is small', () => {
    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features, 10);
    expect(results.length).toBe(2); // only 2 other features
  });
});

describe('findSimilarNeighborhoods — distance symmetry', () => {
  it('distance(A, B) === distance(B, A)', () => {
    const features = [
      makeFeature({
        pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
        higher_education_rate: 40, foreign_language_pct: 10,
        ownership_rate: 50, transit_stop_density: 30,
        property_price_sqm: 4000, crime_index: 50,
        population_density: 5000, child_ratio: 8,
      }),
      makeFeature({
        pno: '00200', hr_mtu: 45000, unemployment_rate: 3,
        higher_education_rate: 60, foreign_language_pct: 8,
        ownership_rate: 70, transit_stop_density: 20,
        property_price_sqm: 6000, crime_index: 30,
        population_density: 3000, child_ratio: 10,
      }),
    ];

    const targetA = features[0].properties as NeighborhoodProperties;
    const targetB = features[1].properties as NeighborhoodProperties;

    const fromA = findSimilarNeighborhoods(targetA, features, 1);
    const fromB = findSimilarNeighborhoods(targetB, features, 1);

    expect(fromA[0].distance).toBeCloseTo(fromB[0].distance, 10);
  });
});

describe('findSimilarNeighborhoods — missing data', () => {
  it('skips features with no comparable metrics', () => {
    const features = [
      makeFeature({
        pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
      }),
      makeFeature({
        pno: '00200', hr_mtu: null, unemployment_rate: null,
        higher_education_rate: null, foreign_language_pct: null,
        ownership_rate: null, transit_stop_density: null,
        property_price_sqm: null, crime_index: null,
        population_density: null, child_ratio: null,
      }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    // Feature 00200 has no comparable metrics, so it's excluded
    expect(results.length).toBe(0);
  });

  it('handles partial data — uses only available metrics', () => {
    const features = [
      makeFeature({
        pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
        higher_education_rate: 40,
      }),
      makeFeature({
        pno: '00200', hr_mtu: 32000, unemployment_rate: null,
        higher_education_rate: 42,
      }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    // Should still find 00200 using hr_mtu and higher_education_rate
    expect(results.length).toBe(1);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('each result has a center coordinate', () => {
    const features = [
      makeFeature({
        pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
      }),
      makeFeature({
        pno: '00200', hr_mtu: 35000, unemployment_rate: 4,
      }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    for (const r of results) {
      expect(r.center).toBeDefined();
      expect(r.center.length).toBe(2);
      expect(typeof r.center[0]).toBe('number');
      expect(typeof r.center[1]).toBe('number');
    }
  });
});

describe('findSimilarNeighborhoods — normalization', () => {
  it('distance is zero for features with identical metric values', () => {
    // Three features: target + two identical candidates → distance should be 0
    const features = [
      makeFeature({
        pno: '00100', hr_mtu: 30000, unemployment_rate: 5,
        higher_education_rate: 40,
      }),
      makeFeature({
        pno: '00200', hr_mtu: 30000, unemployment_rate: 5,
        higher_education_rate: 40,
      }),
      makeFeature({
        pno: '00300', hr_mtu: 50000, unemployment_rate: 2,
        higher_education_rate: 70,
      }),
    ];

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    // 00200 has identical values, so distance = 0
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBe(0);
  });

  it('distance is between 0 and 1 for normalized metrics', () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      makeFeature({
        pno: String(i).padStart(5, '0'),
        hr_mtu: 10000 + i * 5000,
        unemployment_rate: 2 + i,
        higher_education_rate: 10 + i * 8,
        foreign_language_pct: 5 + i * 3,
        ownership_rate: 20 + i * 7,
        transit_stop_density: 5 + i * 10,
        property_price_sqm: 1000 + i * 1000,
        crime_index: 20 + i * 15,
        population_density: 1000 + i * 2000,
        child_ratio: 3 + i * 2,
      }),
    );

    const target = features[0].properties as NeighborhoodProperties;
    const results = findSimilarNeighborhoods(target, features);

    for (const r of results) {
      expect(r.distance).toBeGreaterThanOrEqual(0);
      expect(r.distance).toBeLessThanOrEqual(1);
    }
  });
});
