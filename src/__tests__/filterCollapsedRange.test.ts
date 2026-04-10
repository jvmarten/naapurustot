/**
 * Tests for computeMatchingPnos edge cases not covered by existing tests:
 * - Collapsed slider range (min === max)
 * - Filter with value exactly at range boundary
 * - Interaction between outlier inclusion and tight filters
 * - Multiple simultaneous filters with different range positions
 */
import { describe, it, expect } from 'vitest';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeCollection(features: Partial<NeighborhoodProperties>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [24.9 + i * 0.01, 60.2] },
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

describe('computeMatchingPnos — collapsed slider range (min === max)', () => {
  it('matches features at exact value when slider min equals max', () => {
    const data = makeCollection([
      { quality_index: 50 },
      { quality_index: 60 },
      { quality_index: 70 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 60, max: 60 },
    ];
    const result = computeMatchingPnos(data, filters);
    // value >= 60 && value <= 60 → only exact 60
    expect(result.size).toBe(1);
    expect(result.has('00001')).toBe(true);
  });

  it('matches nothing when collapsed range excludes all features', () => {
    const data = makeCollection([
      { quality_index: 50 },
      { quality_index: 70 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 60, max: 60 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(0);
  });
});

describe('computeMatchingPnos — outlier inclusion at extremes', () => {
  it('includes outliers below range when slider is at minimum stop', () => {
    // quality_index stops start at 0
    const data = makeCollection([
      { quality_index: -5 },  // Below min stop — outlier
      { quality_index: 50 },
      { quality_index: 90 },
    ]);
    // Set min to the layer's first stop (0) — should include values below 0
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 0, max: 100 },
    ];
    const result = computeMatchingPnos(data, filters);
    // -5 is below the min stop (0), and our filter min equals the stop min,
    // so outlier should be included
    expect(result.has('00000')).toBe(true);
  });

  it('includes outliers above range when slider is at maximum stop', () => {
    const data = makeCollection([
      { quality_index: 50 },
      { quality_index: 105 },  // Above max stop — outlier
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 0, max: 100 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00001')).toBe(true);
  });

  it('excludes outliers when slider is NOT at extreme', () => {
    const data = makeCollection([
      { quality_index: -5 },  // Outlier
      { quality_index: 50 },
    ]);
    // min=10 is NOT the layer's first stop (0), so strict filtering
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 10, max: 90 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00000')).toBe(false); // outlier excluded
    expect(result.has('00001')).toBe(true);  // in range
  });
});

describe('computeMatchingPnos — multiple simultaneous filters (AND logic)', () => {
  it('requires all filters to pass for a feature to match', () => {
    const data = makeCollection([
      { quality_index: 80, hr_mtu: 20000 },  // High quality, low income
      { quality_index: 30, hr_mtu: 50000 },  // Low quality, high income
      { quality_index: 80, hr_mtu: 50000 },  // Both high
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 50, max: 100 },
      { layerId: 'median_income', min: 30000, max: 55000 },
    ];
    const result = computeMatchingPnos(data, filters);
    // Only feature 2 passes both filters
    expect(result.size).toBe(1);
    expect(result.has('00002')).toBe(true);
  });
});

describe('computeMatchingPnos — null/missing property handling', () => {
  it('excludes features with null property value', () => {
    const data = makeCollection([
      { quality_index: null },
      { quality_index: 50 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 0, max: 100 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00000')).toBe(false);
    expect(result.has('00001')).toBe(true);
  });

  it('excludes features with NaN property value', () => {
    const data = makeCollection([
      { quality_index: NaN },
      { quality_index: 50 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 0, max: 100 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00000')).toBe(false);
    expect(result.has('00001')).toBe(true);
  });

  it('excludes features with zero or negative population', () => {
    const data = makeCollection([
      { he_vakiy: 0, quality_index: 50 },
      { he_vakiy: -1, quality_index: 50 },
      { he_vakiy: 1000, quality_index: 50 },
    ]);
    const filters: FilterCriterion[] = [
      { layerId: 'quality_index', min: 0, max: 100 },
    ];
    const result = computeMatchingPnos(data, filters);
    expect(result.size).toBe(1);
    expect(result.has('00002')).toBe(true);
  });
});

describe('computeMatchingPnos — empty inputs', () => {
  it('returns empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'quality_index', min: 0, max: 100 }]);
    expect(result.size).toBe(0);
  });

  it('returns empty set for empty filters', () => {
    const data = makeCollection([{ quality_index: 50 }]);
    const result = computeMatchingPnos(data, []);
    expect(result.size).toBe(0);
  });

  it('returns stable EMPTY_SET reference for repeated empty calls', () => {
    const r1 = computeMatchingPnos(null, []);
    const r2 = computeMatchingPnos(null, []);
    expect(r1).toBe(r2); // Same object reference
  });
});
