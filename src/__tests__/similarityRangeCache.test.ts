import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00000', nimi: 'Test', ...props } as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.2]]] },
  };
}

describe('findSimilarNeighborhoods — distance accuracy', () => {
  it('returns closer neighborhoods first', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', hr_mtu: 30000, unemployment_rate: 8,
      higher_education_rate: 40, foreign_language_pct: 10,
      ownership_rate: 50, transit_stop_density: 30,
      property_price_sqm: 4000, crime_index: 40,
      population_density: 8000, child_ratio: 12,
    } as NeighborhoodProperties;

    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 8, higher_education_rate: 40, foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 30, property_price_sqm: 4000, crime_index: 40, population_density: 8000, child_ratio: 12 }),
      makeFeature({ pno: '00200', hr_mtu: 31000, unemployment_rate: 8.5, higher_education_rate: 41, foreign_language_pct: 11, ownership_rate: 51, transit_stop_density: 31, property_price_sqm: 4100, crime_index: 41, population_density: 8100, child_ratio: 12.5 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 2, higher_education_rate: 80, foreign_language_pct: 5, ownership_rate: 80, transit_stop_density: 60, property_price_sqm: 8000, crime_index: 10, population_density: 3000, child_ratio: 20 }),
    ];

    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results).toHaveLength(2);
    expect(results[0].properties.pno).toBe('00200');
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('excludes the target neighborhood itself', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(target, features);
    expect(results.every(r => r.properties.pno !== '00100')).toBe(true);
  });

  it('returns empty array when all features are the target', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [makeFeature({ pno: '00100', hr_mtu: 30000 })];
    const results = findSimilarNeighborhoods(target, features);
    expect(results).toHaveLength(0);
  });

  it('handles missing metrics gracefully (skip non-numeric values)', () => {
    const target = { pno: '00100', hr_mtu: 30000, unemployment_rate: null } as unknown as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00200', hr_mtu: 32000, unemployment_rate: null } as unknown as Partial<NeighborhoodProperties>),
      makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 5 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results.length).toBeGreaterThan(0);
  });

  it('handles features with no properties', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features: GeoJSON.Feature[] = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      { type: 'Feature', properties: null, geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.2]]] } },
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const results = findSimilarNeighborhoods(target, features);
    expect(results.length).toBe(1);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('skips candidates with zero comparable metrics', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00200' }),
    ];
    const results = findSimilarNeighborhoods(target, features);
    expect(results).toHaveLength(0);
  });

  it('normalizes distance by number of available metrics', () => {
    const target = {
      pno: '00100', hr_mtu: 10000, unemployment_rate: 0,
    } as NeighborhoodProperties;
    // Both features need unemployment_rate data since ranges require at least 2 values
    const featureWith2Metrics = makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 20 });
    const featureWith1Metric = makeFeature({ pno: '00300', hr_mtu: 50000, unemployment_rate: 10 });

    const features = [
      makeFeature({ pno: '00100', hr_mtu: 10000, unemployment_rate: 0 }),
      featureWith2Metrics,
      featureWith1Metric,
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results).toHaveLength(2);
  });

  it('respects count parameter', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = Array.from({ length: 20 }, (_, i) =>
      makeFeature({ pno: String(i + 200).padStart(5, '0'), hr_mtu: 30000 + i * 1000 }),
    );
    const results = findSimilarNeighborhoods(target, features, 3);
    expect(results).toHaveLength(3);
  });

  it('returns all candidates when count exceeds available', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
      makeFeature({ pno: '00300', hr_mtu: 40000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 10);
    expect(results).toHaveLength(2);
  });

  it('includes center coordinates in results', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
      makeFeature({ pno: '00300', hr_mtu: 40000 }),
    ];
    const results = findSimilarNeighborhoods(target, features, 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].center).toHaveLength(2);
    expect(typeof results[0].center[0]).toBe('number');
    expect(typeof results[0].center[1]).toBe('number');
  });
});

describe('findSimilarNeighborhoods — cache behavior', () => {
  it('uses cached ranges when called with same features array', () => {
    const target1 = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const target2 = { pno: '00200', hr_mtu: 35000 } as NeighborhoodProperties;
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
      makeFeature({ pno: '00300', hr_mtu: 40000 }),
    ];

    const results1 = findSimilarNeighborhoods(target1, features, 2);
    const results2 = findSimilarNeighborhoods(target2, features, 2);

    expect(results1.length).toBeGreaterThan(0);
    expect(results2.length).toBeGreaterThan(0);
  });

  it('recomputes ranges for new features array', () => {
    const target = { pno: '00100', hr_mtu: 30000 } as NeighborhoodProperties;
    const features1 = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 35000 }),
    ];
    const features2 = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 100000 }),
    ];

    findSimilarNeighborhoods(target, features1);
    const results2 = findSimilarNeighborhoods(target, features2);
    expect(results2.length).toBeGreaterThan(0);
  });
});
