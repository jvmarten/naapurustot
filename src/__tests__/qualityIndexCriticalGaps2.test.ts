import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  getQualityCategory,
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
  it('returns weights for all defined quality factors', () => {
    const weights = getDefaultWeights();
    for (const factor of QUALITY_FACTORS) {
      expect(weights).toHaveProperty(factor.id);
      expect(weights[factor.id]).toBe(factor.defaultWeight);
    }
  });

  it('primary factors have positive weights, secondary have zero', () => {
    const weights = getDefaultWeights();
    for (const factor of QUALITY_FACTORS) {
      if (factor.primary) {
        expect(weights[factor.id]).toBeGreaterThan(0);
      } else {
        expect(weights[factor.id]).toBe(0);
      }
    }
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const weights = getDefaultWeights();
    weights.safety = 50; // default is 25
    expect(isCustomWeights(weights)).toBe(true);
  });

  it('returns true when a secondary factor gets a positive weight', () => {
    const weights = getDefaultWeights();
    weights.cycling = 10; // default is 0
    expect(isCustomWeights(weights)).toBe(true);
  });

  it('returns false for empty object (missing keys fall back to defaults)', () => {
    // Missing keys use ?? f.defaultWeight, which equals the default
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('quality factor inversion', () => {
  it('inverted factors (crime, unemployment) give higher scores for lower values', () => {
    // Test with only the safety factor (crime_index, inverted)
    const features = [
      makeFeature({ crime_index: 20 }),  // low crime → high quality
      makeFeature({ crime_index: 100 }), // high crime → low quality
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100; // only safety factor

    computeQualityIndices(features, weights);

    // Low crime should get highest score (100), high crime lowest (0)
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('non-inverted factors give higher scores for higher values', () => {
    const features = [
      makeFeature({ hr_mtu: 50000 }), // high income → high quality
      makeFeature({ hr_mtu: 20000 }), // low income → low quality
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});

describe('multi-property factor scoring (services)', () => {
  it('services factor averages across healthcare, school, daycare, grocery densities', () => {
    // Services factor uses: healthcare_density, school_density, daycare_density, grocery_density
    const features = [
      makeFeature({
        healthcare_density: 10, school_density: 10,
        daycare_density: 10, grocery_density: 10,
      }),
      makeFeature({
        healthcare_density: 0, school_density: 0,
        daycare_density: 0, grocery_density: 0,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('handles partial service data by averaging available properties', () => {
    const features = [
      makeFeature({
        healthcare_density: 10, school_density: null,
        daycare_density: null, grocery_density: null,
      }),
      makeFeature({
        healthcare_density: 0, school_density: null,
        daycare_density: null, grocery_density: null,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    // Only healthcare_density has data, so score is based on that alone
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});

describe('secondary factors with custom weights', () => {
  it('secondary factors are included when given positive weight', () => {
    const features = [
      makeFeature({ cycling_density: 100 }),
      makeFeature({ cycling_density: 0 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.cycling = 50;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('secondary factors are excluded when weight is 0 (default)', () => {
    const features = [
      makeFeature({ cycling_density: 100, hr_mtu: 30000 }),
      makeFeature({ cycling_density: 0, hr_mtu: 30000 }),
    ];
    // Default weights: cycling=0
    computeQualityIndices(features);

    // Both should get same score since cycling is excluded
    expect(features[0].properties!.quality_index).toBe(
      features[1].properties!.quality_index,
    );
  });
});

describe('range cache invalidation', () => {
  it('recomputes ranges when features array reference changes', () => {
    const featuresA = [
      makeFeature({ hr_mtu: 10000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    const featuresB = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 40000 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(featuresA, weights);
    // A: min=10000, max=50000 → [0, 100]
    expect(featuresA[0].properties!.quality_index).toBe(0);
    expect(featuresA[1].properties!.quality_index).toBe(100);

    computeQualityIndices(featuresB, weights);
    // B: min=30000, max=40000 → [0, 100] (new ranges, not A's ranges)
    expect(featuresB[0].properties!.quality_index).toBe(0);
    expect(featuresB[1].properties!.quality_index).toBe(100);
  });
});

describe('getQualityCategory edge cases', () => {
  it('returns null for values outside 0-100 range', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('handles fractional values within range', () => {
    // 20.5 falls in Avoid (0-20)? No, Avoid max is 20, Bad min is 21
    // 20.5 is between 20 and 21 — should fall in gap
    expect(getQualityCategory(20.5)).toBeNull();
  });
});

describe('air_quality factor inversion', () => {
  it('air_quality is inverted — lower index means better air', () => {
    const features = [
      makeFeature({ air_quality_index: 18 }), // low pollution → good
      makeFeature({ air_quality_index: 48 }), // high pollution → bad
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.air_quality = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});
