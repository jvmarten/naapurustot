import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeCollection(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      properties: {
        pno: String(i + 1).padStart(5, '0'),
        nimi: `Area ${i}`,
        namn: `Area ${i}`,
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...props,
      },
      geometry: { type: 'Point' as const, coordinates: [24.94, 60.17] },
    })),
  };
}

describe('computeMatchingPnos — outlier inclusion at slider extremes', () => {
  it('includes values below the first stop when min slider is at rangeMin', () => {
    // unemployment layer has stops [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]
    // If min is set to 1 (rangeMin), neighborhoods with 0.5% should still match
    const data = makeCollection([
      { unemployment_rate: 0.5 },
      { unemployment_rate: 1.0 },
      { unemployment_rate: 5.0 },
      { unemployment_rate: 12.0 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'unemployment', min: 1, max: 5 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00001')).toBe(true);
    expect(result.has('00002')).toBe(true);
    expect(result.has('00003')).toBe(true);
    expect(result.has('00004')).toBe(false);
  });

  it('includes values above the last stop when max slider is at rangeMax', () => {
    // unemployment layer has rangeMax = 11
    const data = makeCollection([
      { unemployment_rate: 2.0 },
      { unemployment_rate: 15.0 },
      { unemployment_rate: 20.0 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'unemployment', min: 5, max: 11 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(true);
    expect(result.has('00003')).toBe(true);
  });

  it('does NOT include outliers when slider is not at the extreme', () => {
    const data = makeCollection([
      { unemployment_rate: 0.5 },
      { unemployment_rate: 3.0 },
    ]);

    // min=2 is NOT the rangeMin (1), so 0.5 should be excluded
    const filters: FilterCriterion[] = [{ layerId: 'unemployment', min: 2, max: 5 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(true);
  });

  it('returns EMPTY_SET for empty filters array', () => {
    const data = makeCollection([{ unemployment_rate: 5 }]);
    const result1 = computeMatchingPnos(data, []);
    const result2 = computeMatchingPnos(data, []);
    expect(result1.size).toBe(0);
    // Same reference (stable empty set)
    expect(result1).toBe(result2);
  });

  it('returns EMPTY_SET for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'unemployment', min: 1, max: 5 }]);
    expect(result.size).toBe(0);
  });

  it('excludes features with zero or negative population', () => {
    const data = makeCollection([
      { he_vakiy: 0, unemployment_rate: 5 },
      { he_vakiy: 1000, unemployment_rate: 5 },
    ]);

    const filters: FilterCriterion[] = [{ layerId: 'unemployment', min: 1, max: 11 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00001')).toBe(false);
    expect(result.has('00002')).toBe(true);
  });

  it('excludes features with non-numeric property values', () => {
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            pno: '00100',
            nimi: 'Test',
            namn: 'Test',
            kunta: '091',
            city: 'helsinki_metro',
            he_vakiy: 1000,
            unemployment_rate: 'N/A',
          },
          geometry: { type: 'Point', coordinates: [24.94, 60.17] },
        },
      ],
    };

    const filters: FilterCriterion[] = [{ layerId: 'unemployment', min: 1, max: 11 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(0);
  });

  it('applies AND logic across multiple filters', () => {
    const data = makeCollection([
      { unemployment_rate: 3, hr_mtu: 40000 },
      { unemployment_rate: 3, hr_mtu: 10000 },
      { unemployment_rate: 10, hr_mtu: 40000 },
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'unemployment', min: 1, max: 5 },
      { layerId: 'median_income', min: 25000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00001')).toBe(true);
    expect(result.has('00002')).toBe(false);
    expect(result.has('00003')).toBe(false);
  });
});
