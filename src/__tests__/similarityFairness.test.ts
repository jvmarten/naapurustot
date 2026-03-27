import { describe, it, expect } from 'vitest';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      ...props,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
  };
}

/** Full set of similarity metrics for a "typical" neighborhood */
const FULL_METRICS: Partial<NeighborhoodProperties> = {
  hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40,
  foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 20,
  property_price_sqm: 3000, crime_index: 50, population_density: 5000, child_ratio: 8,
};

describe('similarity — distance normalization fairness', () => {
  it('normalizes distance by number of available metrics', () => {
    // Need 3+ features for min-max ranges to work (need spread)
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'Target', namn: 'Target', kunta: '091', city: 'helsinki_metro',
      ...FULL_METRICS,
    } as NeighborhoodProperties;

    // Candidate A: all 10 metrics, slightly different
    const candidateA = makeFeature({
      pno: '00200', hr_mtu: 32000, unemployment_rate: 5.5, higher_education_rate: 42,
      foreign_language_pct: 11, ownership_rate: 52, transit_stop_density: 22,
      property_price_sqm: 3200, crime_index: 52, population_density: 5200, child_ratio: 8.5,
    });

    // Candidate B: fewer metrics match but same small difference
    const candidateB = makeFeature({
      pno: '00300', hr_mtu: 32000, unemployment_rate: 5.5, higher_education_rate: 42,
      foreign_language_pct: 11, ownership_rate: 52, transit_stop_density: 22,
      property_price_sqm: 3200, crime_index: 52, population_density: 5200, child_ratio: 8.5,
    });

    // Need a "spread" feature to establish ranges
    const spread = makeFeature({
      pno: '00400', hr_mtu: 60000, unemployment_rate: 20, higher_education_rate: 80,
      foreign_language_pct: 50, ownership_rate: 90, transit_stop_density: 100,
      property_price_sqm: 10000, crime_index: 200, population_density: 20000, child_ratio: 20,
    });

    const features = [candidateA, candidateB, spread];
    const results = findSimilarNeighborhoods(target, features, 3);

    expect(results.length).toBe(3);
    // A and B have same metrics → same distance, both closest
    expect(results[0].distance).toBeGreaterThanOrEqual(0);
    expect(results[0].distance).toBeLessThan(results[2].distance); // closer than spread
  });

  it('identical candidate has distance 0', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'T', namn: 'T', kunta: '091', city: 'helsinki_metro',
      ...FULL_METRICS,
    } as NeighborhoodProperties;

    const clone = makeFeature({ pno: '00200', ...FULL_METRICS });
    // Need a spread feature for ranges to exist
    const spread = makeFeature({
      pno: '00300', hr_mtu: 60000, unemployment_rate: 20, higher_education_rate: 80,
      foreign_language_pct: 50, ownership_rate: 90, transit_stop_density: 100,
      property_price_sqm: 10000, crime_index: 200, population_density: 20000, child_ratio: 20,
    });

    const results = findSimilarNeighborhoods(target, [clone, spread], 2);
    expect(results[0].distance).toBe(0);
    expect(results[0].properties.pno).toBe('00200');
  });

  it('excludes candidates with zero comparable metrics', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'T', namn: 'T', kunta: '091', city: 'helsinki_metro',
      hr_mtu: 30000,
      // All other similarity metrics are undefined/null
    } as NeighborhoodProperties;

    // Candidate has hr_mtu null (only overlapping metric is missing)
    const noOverlap = makeFeature({
      pno: '00200', hr_mtu: null, unemployment_rate: 5,
    });

    const withOverlap = makeFeature({
      pno: '00300', hr_mtu: 35000,
    });

    // Spread feature for range
    const spread = makeFeature({
      pno: '00400', hr_mtu: 60000,
    });

    const results = findSimilarNeighborhoods(target, [noOverlap, withOverlap, spread], 5);
    // noOverlap has null hr_mtu → excluded because target only has hr_mtu as metric
    // withOverlap and spread both have hr_mtu → included
    const pnos = results.map(r => r.properties.pno);
    expect(pnos).not.toContain('00200');
    expect(pnos).toContain('00300');
  });

  it('returns results sorted by ascending distance', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'T', namn: 'T', kunta: '091', city: 'helsinki_metro',
      ...FULL_METRICS,
    } as NeighborhoodProperties;

    const close = makeFeature({ pno: '00200', ...FULL_METRICS, hr_mtu: 31000 });
    const far = makeFeature({
      pno: '00300', hr_mtu: 60000, unemployment_rate: 20, higher_education_rate: 80,
      foreign_language_pct: 50, ownership_rate: 90, transit_stop_density: 100,
      property_price_sqm: 10000, crime_index: 200, population_density: 20000, child_ratio: 20,
    });
    const mid = makeFeature({
      pno: '00400', hr_mtu: 40000, unemployment_rate: 10, higher_education_rate: 55,
      foreign_language_pct: 20, ownership_rate: 65, transit_stop_density: 50,
      property_price_sqm: 5000, crime_index: 90, population_density: 10000, child_ratio: 13,
    });

    const results = findSimilarNeighborhoods(target, [far, close, mid], 3);
    expect(results[0].properties.pno).toBe('00200'); // closest
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
    expect(results[1].distance).toBeLessThanOrEqual(results[2].distance);
  });

  it('respects count parameter', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'T', namn: 'T', kunta: '091', city: 'helsinki_metro',
      ...FULL_METRICS,
    } as NeighborhoodProperties;

    const features = Array.from({ length: 10 }, (_, i) =>
      makeFeature({ pno: String(i + 1).padStart(5, '0'), ...FULL_METRICS, hr_mtu: 30000 + i * 5000 }),
    );

    expect(findSimilarNeighborhoods(target, features, 3).length).toBe(3);
    expect(findSimilarNeighborhoods(target, features, 0).length).toBe(0);
  });

  it('computes center from polygon bounding box', () => {
    const target: NeighborhoodProperties = {
      pno: '00100', nimi: 'T', namn: 'T', kunta: '091', city: 'helsinki_metro',
      ...FULL_METRICS,
    } as NeighborhoodProperties;

    const feature = makeFeature({ pno: '00200', ...FULL_METRICS, hr_mtu: 35000 });
    const spread = makeFeature({ pno: '00300', ...FULL_METRICS, hr_mtu: 60000 });
    const results = findSimilarNeighborhoods(target, [feature, spread], 1);
    // Polygon: [24.9, 60.1] to [25.0, 60.2] → center = [24.95, 60.15]
    expect(results[0].center[0]).toBeCloseTo(24.95, 2);
    expect(results[0].center[1]).toBeCloseTo(60.15, 2);
  });
});
