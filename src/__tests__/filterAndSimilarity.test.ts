/**
 * Priority 3: Filter matching and similarity — input validation and edge cases
 *
 * Filter logic determines which neighborhoods are highlighted on the map.
 * Similarity logic drives the "Similar neighborhoods" recommendation panel.
 * Bugs here cause wrong neighborhoods to appear/disappear.
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, FeatureCollection } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', he_vakiy: 1000, ...props } as NeighborhoodProperties,
  };
}

function makeCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('computeMatchingPnos — filter matching', () => {
  it('returns empty set for no filters', () => {
    const data = makeCollection([makeFeature({ pno: '00100' })]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 20000, max: 50000 }]);
    expect(result.size).toBe(0);
  });

  it('matches features within filter range', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 60000 }),
      makeFeature({ pno: '00300', hr_mtu: 10000 }),
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 50000 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(false);
  });

  it('excludes features with null/non-numeric values', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', hr_mtu: null }),
      makeFeature({ pno: '00200', hr_mtu: 30000 }),
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 50000 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with zero or negative population', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 0, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: -1, hr_mtu: 30000 }),
      makeFeature({ pno: '00300', he_vakiy: 100, hr_mtu: 30000 }),
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 50000 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(true);
  });

  it('applies multiple filters as AND (intersection)', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 3 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, unemployment_rate: 8 }),
      makeFeature({ pno: '00300', hr_mtu: 60000, unemployment_rate: 3 }),
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 50000 },
      { layerId: 'unemployment', min: 1, max: 5 },
    ];
    const result = computeMatchingPnos(data, filters);

    // Only 00100 matches both filters
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(false);
  });

  it('slider at extreme includes outlier values beyond stop range', () => {
    // Income layer stops start at 15000. A neighborhood with 12000 should be included
    // when the slider min is at the lowest stop position (15000).
    const data = makeCollection([
      makeFeature({ pno: '00100', hr_mtu: 12000 }),
      makeFeature({ pno: '00200', hr_mtu: 30000 }),
    ]);

    // min=15000 is the first stop for median_income, so slider is at extreme
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);

    // 12000 < 15000 but min is at rangeMin so it should be included
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(true);
  });

  it('returns stable EMPTY_SET reference for no filters', () => {
    const data = makeCollection([makeFeature({ pno: '00100' })]);
    const r1 = computeMatchingPnos(data, []);
    const r2 = computeMatchingPnos(data, []);
    expect(r1).toBe(r2); // Same reference, not just equal
  });
});

describe('findSimilarNeighborhoods — similarity scoring', () => {
  const allFeatures = [
    makeFeature({ pno: '00100', hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, foreign_language_pct: 10, ownership_rate: 50, transit_stop_density: 30, property_price_sqm: 3000, crime_index: 50, population_density: 5000, child_ratio: 8 }),
    makeFeature({ pno: '00200', hr_mtu: 31000, unemployment_rate: 5.2, higher_education_rate: 51, foreign_language_pct: 11, ownership_rate: 52, transit_stop_density: 32, property_price_sqm: 3100, crime_index: 48, population_density: 5200, child_ratio: 7.5 }),
    makeFeature({ pno: '00300', hr_mtu: 60000, unemployment_rate: 1, higher_education_rate: 80, foreign_language_pct: 3, ownership_rate: 80, transit_stop_density: 100, property_price_sqm: 8000, crime_index: 15, population_density: 8000, child_ratio: 12 }),
    makeFeature({ pno: '00400', hr_mtu: 15000, unemployment_rate: 18, higher_education_rate: 15, foreign_language_pct: 40, ownership_rate: 20, transit_stop_density: 5, property_price_sqm: 1500, crime_index: 150, population_density: 12000, child_ratio: 3 }),
  ];

  it('does not return the target neighborhood itself', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, allFeatures, 5);
    expect(similar.every(s => s.properties.pno !== '00100')).toBe(true);
  });

  it('most similar neighborhood is the one with closest values', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, allFeatures, 3);
    // 00200 has very similar values to 00100
    expect(similar[0].properties.pno).toBe('00200');
  });

  it('results are sorted by ascending distance', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, allFeatures, 3);
    for (let i = 1; i < similar.length; i++) {
      expect(similar[i].distance).toBeGreaterThanOrEqual(similar[i - 1].distance);
    }
  });

  it('respects count parameter', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    expect(findSimilarNeighborhoods(target, allFeatures, 1)).toHaveLength(1);
    expect(findSimilarNeighborhoods(target, allFeatures, 2)).toHaveLength(2);
  });

  it('returns center coordinates for each result', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, allFeatures, 1);
    expect(similar[0].center).toHaveLength(2);
    expect(typeof similar[0].center[0]).toBe('number');
    expect(typeof similar[0].center[1]).toBe('number');
  });

  it('handles features with missing metric values gracefully', () => {
    const sparseFeatures = [
      makeFeature({ pno: '00100', hr_mtu: 30000 }), // most metrics undefined
      makeFeature({ pno: '00200', hr_mtu: 31000 }),
    ];
    const target = sparseFeatures[0].properties as NeighborhoodProperties;
    // Should not throw even with mostly-missing data
    const similar = findSimilarNeighborhoods(target, sparseFeatures, 1);
    expect(similar).toHaveLength(1);
  });

  it('distance is normalized by number of comparable metrics', () => {
    const target = allFeatures[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, allFeatures, 3);
    // All distances should be in [0, 1] range since they're normalized
    for (const s of similar) {
      expect(s.distance).toBeGreaterThanOrEqual(0);
      expect(s.distance).toBeLessThanOrEqual(1);
    }
  });
});
