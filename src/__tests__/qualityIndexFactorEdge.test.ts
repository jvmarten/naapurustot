import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: props };
}

describe('computeQualityIndices — factor weight edge cases', () => {
  it('skips factors with weight 0', () => {
    const features = [
      makeFeature({ hr_mtu: 20000, unemployment_rate: 5, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 40000, unemployment_rate: 15, higher_education_rate: 70 }),
    ];
    const allZeroExceptIncome: QualityWeights = {};
    for (const f of QUALITY_FACTORS) allZeroExceptIncome[f.id] = 0;
    allZeroExceptIncome['income'] = 100;

    computeQualityIndices(features, allZeroExceptIncome);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('skips factors with negative weight (treated as <= 0)', () => {
    const features = [
      makeFeature({ hr_mtu: 20000, unemployment_rate: 5, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 40000, unemployment_rate: 15, higher_education_rate: 70 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = -10;
    weights['income'] = 50;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('handles factor with unknown id in weights (defaults to 0)', () => {
    const features = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    const weights: QualityWeights = { unknown_factor: 50, income: 50 };
    for (const f of QUALITY_FACTORS) {
      if (f.id !== 'income') weights[f.id] = 0;
    }
    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('all weights zero produces null quality_index', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10 }),
    ];
    const allZero: QualityWeights = {};
    for (const f of QUALITY_FACTORS) allZero[f.id] = 0;

    computeQualityIndices(features, allZero);
    expect(features[0].properties!.quality_index).toBeNull();
  });
});

describe('computeQualityIndices — multi-property factor (services)', () => {
  it('averages multiple properties within a single factor', () => {
    const features = [
      makeFeature({
        healthcare_density: 0, school_density: 0, daycare_density: 0, grocery_density: 0,
      }),
      makeFeature({
        healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10,
      }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['services'] = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('handles partial missing data in multi-property factor', () => {
    const features = [
      makeFeature({
        healthcare_density: 0, school_density: null, daycare_density: 0, grocery_density: null,
      }),
      makeFeature({
        healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10,
      }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['services'] = 100;

    computeQualityIndices(features, weights);
    // Feature 0 has missing data → uses metro avg fallback → lower score
    // Feature 1 has all data at max → higher score
    // The exact values depend on fallback normalization
    expect(features[0].properties!.quality_index).not.toBeNull();
    expect(features[1].properties!.quality_index).not.toBeNull();
    expect(features[0].properties!.quality_index).toBeLessThan(features[1].properties!.quality_index!);
  });
});

describe('computeQualityIndices — inverted factors', () => {
  it('inverts crime_index (lower crime = higher quality)', () => {
    const features = [
      makeFeature({ crime_index: 10 }),
      makeFeature({ crime_index: 90 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['safety'] = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('inverts air_quality_index (lower pollution = higher quality)', () => {
    const features = [
      makeFeature({ air_quality_index: 5 }),
      makeFeature({ air_quality_index: 50 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['air_quality'] = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('inverts unemployment_rate (lower unemployment = higher quality)', () => {
    const features = [
      makeFeature({ unemployment_rate: 2 }),
      makeFeature({ unemployment_rate: 20 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['employment'] = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});

describe('computeQualityIndices — range cache invalidation', () => {
  it('recomputes ranges when features array reference changes', () => {
    const features1 = [
      makeFeature({ hr_mtu: 10000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    const features2 = [
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 60000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100;

    computeQualityIndices(features1, weights);
    expect(features1[0].properties!.quality_index).toBe(0);

    computeQualityIndices(features2, weights);
    expect(features2[0].properties!.quality_index).toBe(0);
    expect(features2[1].properties!.quality_index).toBe(100);
  });

  it('reuses cache when same features array is passed twice', () => {
    const features = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 5 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 15 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 50;
    weights['employment'] = 50;

    computeQualityIndices(features, weights);
    const qi0 = features[0].properties!.quality_index;

    weights['income'] = 80;
    weights['employment'] = 20;
    computeQualityIndices(features, weights);
    const qi0After = features[0].properties!.quality_index;

    expect(qi0After).not.toBe(qi0);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w['income'] = (w['income'] ?? 0) + 1;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false when weights equal defaults but from different object', () => {
    const w: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w[f.id] = f.defaultWeight;
    expect(isCustomWeights(w)).toBe(false);
  });

  it('treats missing key as defaultWeight', () => {
    const w: QualityWeights = {};
    expect(isCustomWeights(w)).toBe(false);
  });
});

describe('getDefaultWeights', () => {
  it('returns a weight for every QUALITY_FACTOR', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('returns a new object each call', () => {
    expect(getDefaultWeights()).not.toBe(getDefaultWeights());
  });
});
