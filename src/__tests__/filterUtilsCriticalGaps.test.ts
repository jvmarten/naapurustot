import { describe, it, expect } from 'vitest';
import { computeMatchingPnos } from '../utils/filterUtils';
import type { FeatureCollection } from 'geojson';
import type { LayerId } from '../utils/colorScales';

function makeFC(features: Record<string, unknown>[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((props) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
      properties: props,
    })),
  };
}

describe('computeMatchingPnos — outlier handling at slider extremes', () => {
  it('includes values below first stop when slider min is at stop minimum', () => {
    // Unemployment stops start at 1. A neighborhood with 0.5% should still match
    // when slider min is at the stop minimum (1)
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, unemployment_rate: 0.5 },
      { pno: '00200', he_vakiy: 1000, unemployment_rate: 5 },
    ]);

    const filters = [{ layerId: 'unemployment' as LayerId, min: 1, max: 11 }];
    const result = computeMatchingPnos(data, filters);

    // min=1 equals the first stop (rangeMin), so minOk should be true for all values
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(true);
  });

  it('includes values above last stop when slider max is at stop maximum', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, unemployment_rate: 5 },
      { pno: '00200', he_vakiy: 1000, unemployment_rate: 15 }, // above max stop
    ]);

    const filters = [{ layerId: 'unemployment' as LayerId, min: 1, max: 11 }];
    const result = computeMatchingPnos(data, filters);

    // max=11 equals the last stop (rangeMax), so maxOk should be true for all
    expect(result.has('00200')).toBe(true);
  });

  it('excludes values outside a narrower filter range', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, unemployment_rate: 3 },
      { pno: '00200', he_vakiy: 1000, unemployment_rate: 8 },
    ]);

    const filters = [{ layerId: 'unemployment' as LayerId, min: 5, max: 7 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(false);
  });
});

describe('computeMatchingPnos — AND logic with multiple filters', () => {
  it('requires all filters to match', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, hr_mtu: 40000, unemployment_rate: 3 },
      { pno: '00200', he_vakiy: 1000, hr_mtu: 25000, unemployment_rate: 3 },
      { pno: '00300', he_vakiy: 1000, hr_mtu: 40000, unemployment_rate: 8 },
    ]);

    const filters = [
      { layerId: 'median_income' as LayerId, min: 30000, max: 55000 },
      { layerId: 'unemployment' as LayerId, min: 1, max: 5 },
    ];
    const result = computeMatchingPnos(data, filters);

    // Only 00100 passes both filters
    expect(result.has('00100')).toBe(true);
    expect(result.has('00200')).toBe(false);
    expect(result.has('00300')).toBe(false);
  });
});

describe('computeMatchingPnos — null/invalid data handling', () => {
  it('excludes features with null property value', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, hr_mtu: null },
      { pno: '00200', he_vakiy: 1000, hr_mtu: 30000 },
    ]);

    const filters = [{ layerId: 'median_income' as LayerId, min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.has('00100')).toBe(false);
    expect(result.has('00200')).toBe(true);
  });

  it('excludes features with NaN property value', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, hr_mtu: NaN },
    ]);

    const filters = [{ layerId: 'median_income' as LayerId, min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(false);
  });

  it('excludes features with zero or negative population', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 0, hr_mtu: 30000 },
      { pno: '00200', he_vakiy: -5, hr_mtu: 30000 },
    ]);

    const filters = [{ layerId: 'median_income' as LayerId, min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);

    expect(result.size).toBe(0);
  });

  it('returns stable empty set for no filters', () => {
    const data = makeFC([{ pno: '00100', he_vakiy: 1000 }]);
    const r1 = computeMatchingPnos(data, []);
    const r2 = computeMatchingPnos(data, []);
    // Should be the same reference (stable empty set optimization)
    expect(r1).toBe(r2);
  });

  it('returns stable empty set for null data', () => {
    const result = computeMatchingPnos(null, [{ layerId: 'median_income' as LayerId, min: 0, max: 100 }]);
    expect(result.size).toBe(0);
  });
});

describe('computeMatchingPnos — boundary precision', () => {
  it('includes value at exact min boundary', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, hr_mtu: 30000 },
    ]);

    const filters = [{ layerId: 'median_income' as LayerId, min: 30000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
  });

  it('includes value at exact max boundary', () => {
    const data = makeFC([
      { pno: '00100', he_vakiy: 1000, hr_mtu: 55000 },
    ]);

    const filters = [{ layerId: 'median_income' as LayerId, min: 15000, max: 55000 }];
    const result = computeMatchingPnos(data, filters);
    expect(result.has('00100')).toBe(true);
  });
});
