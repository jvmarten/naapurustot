import { describe, it, expect, vi } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection, Feature } from 'geojson';

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

describe('computeMatchingPnos — deep edge cases', () => {
  it('returns empty set when no neighborhoods match all criteria', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 20000, unemployment_rate: 20 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 50000, unemployment_rate: 2 }),
    ]);
    // Income 25-35k AND unemployment 2-5% — no feature matches both
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 35000 },
      { layerId: 'unemployment', min: 2, max: 5 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(0);
  });

  it('handles three simultaneous filters', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 15 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000, unemployment_rate: 20, higher_education_rate: 50 }),
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 35000 },
      { layerId: 'unemployment', min: 2, max: 10 },
      { layerId: 'education', min: 30, max: 80 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00100']));
  });

  it('handles non-numeric property values by excluding them', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 'not a number' }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result).toEqual(new Set(['00200']));
  });

  it('handles very large dataset efficiently', () => {
    const features = Array.from({ length: 500 }, (_, i) =>
      makeFeature({ pno: String(i).padStart(5, '0'), he_vakiy: 1000, hr_mtu: 15000 + i * 100 }),
    );
    const data = makeCollection(features);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 30000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    // Values 30000 to 40000 → indices 150 to 250
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBeLessThanOrEqual(101);
  });

  it('returns empty set when data has no features', () => {
    const data = makeCollection([]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    expect(computeMatchingPnos(data, filters).size).toBe(0);
  });

  it('handles filter with min > max (no matches)', () => {
    const data = makeCollection([
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 30000 }),
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 40000, max: 20000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(0);
  });
});
