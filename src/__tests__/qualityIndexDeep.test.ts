import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('getDefaultWeights', () => {
  it('returns weights for all quality factors', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w).toHaveProperty(f.id);
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('has weights summing to a known value', () => {
    const w = getDefaultWeights();
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    // Primary weights sum: 25+20+20+15+7+5+3 = 95; secondary are 0
    expect(sum).toBe(95);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w.safety = 10;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false for empty object (uses defaults via fallback)', () => {
    // Each factor defaults to f.defaultWeight when key is missing
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a secondary factor is given a nonzero weight', () => {
    const w = getDefaultWeights();
    w.cycling = 10; // secondary factor, default is 0
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('computeQualityIndices — deep edge cases', () => {
  it('produces integer quality_index values (always rounds)', () => {
    const features = [
      makeFeature({ hr_mtu: 25000, unemployment_rate: 7, higher_education_rate: 45 }),
      makeFeature({ hr_mtu: 35000, unemployment_rate: 12, higher_education_rate: 55 }),
      makeFeature({ hr_mtu: 45000, unemployment_rate: 3, higher_education_rate: 75 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = f.properties!.quality_index as number;
      expect(Number.isInteger(qi)).toBe(true);
    }
  });

  it('uses only factors with positive weights', () => {
    // Give weight only to income
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    const features = [
      makeFeature({ hr_mtu: 20000, crime_index: 999 }),
      makeFeature({ hr_mtu: 50000, crime_index: 1 }),
    ];
    computeQualityIndices(features, weights);

    // Feature 0 has low income → low score, crime should be ignored
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('correctly inverts metrics (lower crime = higher score)', () => {
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100; // crime_index, inverted

    const features = [
      makeFeature({ crime_index: 10 }), // low crime → high safety
      makeFeature({ crime_index: 100 }), // high crime → low safety
    ];
    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('handles multi-property factors (services: 4 properties)', () => {
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    const features = [
      makeFeature({
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
      makeFeature({
        healthcare_density: 0,
        school_density: 0,
        daycare_density: 0,
        grocery_density: 0,
      }),
    ];
    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('handles partial data in multi-property factors', () => {
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    const features = [
      makeFeature({
        healthcare_density: 10,
        school_density: null,
        daycare_density: null,
        grocery_density: null,
      }),
      makeFeature({
        healthcare_density: 0,
        school_density: null,
        daycare_density: null,
        grocery_density: null,
      }),
    ];
    computeQualityIndices(features, weights);

    // Only healthcare_density contributes
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('all weights zero produces null quality_index', () => {
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;

    const features = [makeFeature({ hr_mtu: 30000 })];
    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('handles NaN values in properties gracefully', () => {
    const features = [
      makeFeature({ hr_mtu: NaN, unemployment_rate: 5 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10 }),
    ];
    computeQualityIndices(features);
    // NaN is not finite, should be skipped
    expect(features[0].properties!.quality_index).not.toBeNull();
  });

  it('handles Infinity values in properties gracefully', () => {
    const features = [
      makeFeature({ hr_mtu: Infinity, unemployment_rate: 5 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10 }),
    ];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).not.toBeNull();
  });

  it('large dataset produces values between 0 and 100', () => {
    const features = Array.from({ length: 200 }, (_, i) =>
      makeFeature({
        hr_mtu: 15000 + i * 200,
        unemployment_rate: 2 + (i % 25),
        higher_education_rate: 10 + (i % 70),
        crime_index: 20 + (i % 150),
        transit_stop_density: 5 + (i % 200),
        air_quality_index: 18 + (i % 30),
      }),
    );
    computeQualityIndices(features);
    for (const f of features) {
      const qi = f.properties!.quality_index as number;
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });
});

describe('getQualityCategory — edge cases', () => {
  it('returns null for values outside 0-100', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('handles non-integer values within range', () => {
    // 50.5 should fall in the 41-60 range
    const cat = getQualityCategory(50.5);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Okay');
  });
});

describe('QUALITY_FACTORS integrity', () => {
  it('all primary factors have positive default weights', () => {
    for (const f of QUALITY_FACTORS) {
      if (f.primary) {
        expect(f.defaultWeight).toBeGreaterThan(0);
      }
    }
  });

  it('all secondary factors have zero default weight', () => {
    for (const f of QUALITY_FACTORS) {
      if (!f.primary) {
        expect(f.defaultWeight).toBe(0);
      }
    }
  });

  it('all factors have both fi and en labels', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f.label.fi).toBeTruthy();
      expect(f.label.en).toBeTruthy();
    }
  });

  it('all factor IDs are unique', () => {
    const ids = QUALITY_FACTORS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all factors reference valid property names', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f.properties.length).toBeGreaterThan(0);
      for (const prop of f.properties) {
        expect(typeof prop).toBe('string');
        expect((prop as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('QUALITY_CATEGORIES integrity', () => {
  it('all categories have both fi and en labels', () => {
    for (const c of QUALITY_CATEGORIES) {
      expect(c.label.fi).toBeTruthy();
      expect(c.label.en).toBeTruthy();
    }
  });

  it('all categories have valid hex color codes', () => {
    for (const c of QUALITY_CATEGORIES) {
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('categories are in ascending order', () => {
    for (let i = 1; i < QUALITY_CATEGORIES.length; i++) {
      expect(QUALITY_CATEGORIES[i].min).toBeGreaterThan(QUALITY_CATEGORIES[i - 1].min);
    }
  });
});
