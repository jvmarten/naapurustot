/**
 * Hardened tests for computeMatchingPnos.
 *
 * Targets critical logic in filterUtils.ts:
 * - Outlier inclusion when slider at layer extreme stops
 * - Multi-filter AND logic (all must match)
 * - Features with non-numeric values excluded
 * - Features with he_vakiy <= 0 excluded
 * - Empty filter returns stable empty set reference
 * - Null data returns empty set
 */
import { describe, it, expect } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { NeighborhoodProperties } from '../utils/metrics';
import { LAYERS } from '../utils/colorScales';

function mkCollection(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [24.9, 60.2] },
      properties: {
        pno: String(i).padStart(5, '0'),
        nimi: `Area ${i}`,
        namn: `Area ${i}`,
        kunta: '091',
        city: 'helsinki_metro',
        he_vakiy: 1000,
        ...props,
      },
    })),
  };
}

describe('computeMatchingPnos', () => {
  it('returns stable empty set for empty filters', () => {
    const data = mkCollection([{ hr_mtu: 30000 }]);
    const result1 = computeMatchingPnos(data, []);
    const result2 = computeMatchingPnos(data, []);
    expect(result1.size).toBe(0);
    expect(result1).toBe(result2); // same reference → no React re-render
  });

  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income', min: 0, max: 100000 }]);
    expect(result.size).toBe(0);
  });

  it('filters features within range', () => {
    const data = mkCollection([
      { hr_mtu: 25000 },
      { hr_mtu: 35000 },
      { hr_mtu: 45000 },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 20000, max: 40000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(2); // 25000 and 35000
    expect(result.has('00000')).toBe(true);
    expect(result.has('00001')).toBe(true);
    expect(result.has('00002')).toBe(false);
  });

  it('excludes features with non-numeric property values', () => {
    const data = mkCollection([
      { hr_mtu: 30000 },
      { hr_mtu: null as unknown as number },
      { hr_mtu: NaN },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00000')).toBe(true);
  });

  it('excludes features with he_vakiy <= 0', () => {
    const data = mkCollection([
      { he_vakiy: 1000, hr_mtu: 30000 },
      { he_vakiy: 0, hr_mtu: 30000 },
      { he_vakiy: -1, hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00000')).toBe(true);
  });

  it('AND-combines multiple filters', () => {
    const data = mkCollection([
      { hr_mtu: 30000, unemployment_rate: 5 },   // matches both
      { hr_mtu: 30000, unemployment_rate: 25 },   // matches income only
      { hr_mtu: 10000, unemployment_rate: 5 },    // matches unemployment only
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 20000, max: 50000 },
      { layerId: 'unemployment', min: 0, max: 10 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00000')).toBe(true);
  });

  it('includes outlier values below range when slider at minimum stop', () => {
    // Find the median_income layer to know its stop range
    const incomeLayer = LAYERS.find(l => l.id === 'median_income')!;
    const rangeMin = incomeLayer.stops[0];

    const data = mkCollection([
      { hr_mtu: rangeMin - 5000 },  // outlier below range
      { hr_mtu: rangeMin + 1000 },  // within range
    ]);

    // Set filter min at the layer's minimum stop (slider at leftmost position)
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: rangeMin, max: incomeLayer.stops[incomeLayer.stops.length - 1] },
    ];
    const result = computeMatchingPnos(data, filters);
    // Both should match because min <= rangeMin triggers outlier inclusion
    expect(result.size).toBe(2);
  });

  it('includes outlier values above range when slider at maximum stop', () => {
    const incomeLayer = LAYERS.find(l => l.id === 'median_income')!;
    const rangeMax = incomeLayer.stops[incomeLayer.stops.length - 1];

    const data = mkCollection([
      { hr_mtu: rangeMax + 5000 },  // outlier above range
      { hr_mtu: rangeMax - 1000 },  // within range
    ]);

    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: incomeLayer.stops[0], max: rangeMax },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(2);
  });

  it('excludes outliers when slider is NOT at the extreme', () => {
    const incomeLayer = LAYERS.find(l => l.id === 'median_income')!;
    const rangeMin = incomeLayer.stops[0];
    const rangeMax = incomeLayer.stops[incomeLayer.stops.length - 1];

    const data = mkCollection([
      { hr_mtu: rangeMin - 5000 },  // outlier below range
      { hr_mtu: rangeMin + 1000 },  // within range
    ]);

    // Set filter min ABOVE the layer's minimum stop (slider not at leftmost)
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: rangeMin + 500, max: rangeMax },
    ];
    const result = computeMatchingPnos(data, filters);
    // Outlier should NOT be included because slider is not at extreme
    expect(result.size).toBe(1);
    expect(result.has('00001')).toBe(true);
  });

  it('handles Infinity values in feature properties', () => {
    const data = mkCollection([
      { hr_mtu: Infinity },
      { hr_mtu: 30000 },
    ]);
    const filters: FilterCriterion[] = [{ layerId: 'median_income', min: 0, max: 100000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1); // Infinity is not finite, so excluded
    expect(result.has('00001')).toBe(true);
  });
});
