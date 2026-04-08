/**
 * Integration tests for filter pipeline: FilterCriterion → computeMatchingPnos.
 *
 * Tests the full filter flow including multi-criteria AND logic, outlier boundary
 * handling, and empty-population exclusion. Bugs here cause neighborhoods to
 * disappear from the map or include wrong results.
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection, Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFC(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function makeFeature(pno: string, props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      he_vakiy: 1000,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('computeMatchingPnos', () => {
  const data = makeFC([
    makeFeature('00100', { hr_mtu: 25000, unemployment_rate: 5 }),
    makeFeature('00200', { hr_mtu: 35000, unemployment_rate: 10 }),
    makeFeature('00300', { hr_mtu: 45000, unemployment_rate: 3 }),
    makeFeature('00400', { hr_mtu: 55000, unemployment_rate: 15 }),
    makeFeature('00500', { hr_mtu: null as unknown as number, unemployment_rate: 7 }),
  ]);

  it('returns empty set when no filters', () => {
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns the stable empty set for no-filter case', () => {
    const a = computeMatchingPnos(data, []);
    const b = computeMatchingPnos(data, []);
    expect(a).toBe(b); // Same reference — prevents unnecessary re-renders
  });

  it('returns empty set when data is null', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100000 }]);
    expect(result.size).toBe(0);
  });

  it('filters by single criterion', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 30000, max: 50000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00200')).toBe(true); // 35000
    expect(result.has('00300')).toBe(true); // 45000
    expect(result.has('00100')).toBe(false); // 25000
    expect(result.has('00400')).toBe(false); // 55000
  });

  it('applies AND logic for multiple criteria', () => {
    // unemployment layer stops: [1,2,3,4,5,6,7,8,9,11]
    // Use a max within the stop range (not at the extreme) so outlier logic doesn't apply
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 30000, max: 60000 },
      { layerId: 'unemployment', min: 2, max: 10 },
    ];
    const result = computeMatchingPnos(data, filters);
    // 00200: income 35000 ✓, unemp 10 ✓
    // 00300: income 45000 ✓, unemp 3 ✓
    // 00400: income 55000 ✓, unemp 15 ✗ (above max 10, and 10 < rangeMax 11 so outlier logic doesn't apply)
    expect(result.has('00200')).toBe(true);
    expect(result.has('00300')).toBe(true);
    expect(result.has('00400')).toBe(false);
  });

  it('excludes features with null property values', () => {
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 0, max: 100000 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00500')).toBe(false); // hr_mtu is null
  });

  it('excludes features with zero population', () => {
    const dataWithZeroPop = makeFC([
      makeFeature('00100', { he_vakiy: 0, hr_mtu: 30000 }),
      makeFeature('00200', { he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 0, max: 100000 },
    ];
    const result = computeMatchingPnos(dataWithZeroPop, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('handles outlier boundary: includes values beyond stop range when slider at extreme', () => {
    // The median_income layer has stops starting at 15000.
    // A neighborhood with hr_mtu=12000 is an outlier below the scale.
    // When the slider min is at the lowest stop (15000), outliers should still be included.
    const dataWithOutlier = makeFC([
      makeFeature('00100', { hr_mtu: 12000 }), // below first stop
      makeFeature('00200', { hr_mtu: 20000 }),
      makeFeature('00300', { hr_mtu: 70000 }), // above last stop
    ]);

    // Slider at extreme positions (matching the stop boundaries)
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 15000, max: 55000 },
    ];
    const result = computeMatchingPnos(dataWithOutlier, filters);
    // min=15000 matches first stop → should include outlier below
    expect(result.has('00100')).toBe(true);
    // max=55000 matches last stop → should include outlier above
    expect(result.has('00300')).toBe(true);
  });

  it('excludes outliers when slider is NOT at extreme', () => {
    const dataWithOutlier = makeFC([
      makeFeature('00100', { hr_mtu: 12000 }), // below filter min
      makeFeature('00200', { hr_mtu: 20000 }),
    ]);

    // Slider not at extreme — min is above first stop
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 18000, max: 55000 },
    ];
    const result = computeMatchingPnos(dataWithOutlier, filters);
    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });
});
