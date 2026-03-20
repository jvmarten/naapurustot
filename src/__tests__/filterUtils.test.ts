import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection, Feature } from 'geojson';

// Mock i18n to prevent localStorage issues
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: props,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

function makeCollection(features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('computeMatchingPnos', () => {
  it('returns empty set for null data', () => {
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    expect(computeMatchingPnos(null, filters)).toEqual(new Set());
  });

  it('returns empty set for empty filters', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    expect(computeMatchingPnos(data, [])).toEqual(new Set());
  });

  it('filters neighborhoods by a single layer range', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 50000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 10000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 25000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00100']));
  });

  it('requires all filters to match (AND logic)', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 35000, unemployment_rate: 15 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 50000, unemployment_rate: 3 }),
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 40000 },
      { layerId: 'unemployment', min: 2, max: 10 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00100']));
  });

  it('skips features with null or zero population', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 0, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', he_vakiy: null, hr_mtu: 30000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00300']));
  });

  it('excludes features with null property values', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: null }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00200']));
  });

  it('includes outliers when slider is at extreme min position', () => {
    // When min slider is at the lowest stop, values below the stop range should be included
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 10000 }), // below first stop (15000)
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    // min=15000 matches the first stop of median_income layer (15000)
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    // Both should match since min is at the range minimum
    expect(result).toEqual(new Set(['00100', '00200']));
  });

  it('includes outliers when slider is at extreme max position', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 60000 }), // above last stop (55000)
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    // max=55000 matches the last stop of median_income layer (55000)
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00100', '00200']));
  });

  it('handles boundary values (value exactly at min and max)', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 25000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 35000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 25000, max: 35000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00100', '00200', '00300']));
  });
});
