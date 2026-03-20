import { describe, it, expect, vi } from 'vitest';
import {
  getDefaultWeights,
  isCustomWeights,
  computeQualityIndices,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', ...props },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('getDefaultWeights', () => {
  it('returns weights for all quality factors', () => {
    const weights = getDefaultWeights();
    for (const factor of QUALITY_FACTORS) {
      expect(weights[factor.id]).toBe(factor.defaultWeight);
    }
  });

  it('has primary factors with non-zero weights', () => {
    const weights = getDefaultWeights();
    const primaryFactors = QUALITY_FACTORS.filter((f) => f.primary);
    for (const factor of primaryFactors) {
      expect(weights[factor.id]).toBeGreaterThan(0);
    }
  });

  it('has secondary factors with zero weights', () => {
    const weights = getDefaultWeights();
    const secondaryFactors = QUALITY_FACTORS.filter((f) => !f.primary);
    for (const factor of secondaryFactors) {
      expect(weights[factor.id]).toBe(0);
    }
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    const weights = getDefaultWeights();
    expect(isCustomWeights(weights)).toBe(false);
  });

  it('returns true when a weight is changed', () => {
    const weights = getDefaultWeights();
    weights['safety'] = 50;
    expect(isCustomWeights(weights)).toBe(true);
  });

  it('returns true when a secondary factor gets weight', () => {
    const weights = getDefaultWeights();
    weights['cycling'] = 10;
    expect(isCustomWeights(weights)).toBe(true);
  });

  it('returns false for empty object (falls back to defaults)', () => {
    // isCustomWeights uses ?? fallback, so missing keys use defaultWeight
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('computeQualityIndices with custom weights', () => {
  it('respects custom weights — safety-only weighting', () => {
    const features = [
      makeFeature({ crime_index: 20 }),  // low crime = high safety score
      makeFeature({ crime_index: 100 }), // high crime = low safety score
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['safety'] = 100; // only safety matters

    computeQualityIndices(features, weights);
    // Crime is inverted — lower crime = higher quality
    expect(features[0].properties!.quality_index).toBeGreaterThan(
      features[1].properties!.quality_index as number,
    );
  });

  it('respects custom weights — income-only weighting', () => {
    const features = [
      makeFeature({ hr_mtu: 50000 }),
      makeFeature({ hr_mtu: 20000 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBeGreaterThan(
      features[1].properties!.quality_index as number,
    );
  });

  it('skips factors with zero weight', () => {
    const features = [
      makeFeature({ hr_mtu: 50000, crime_index: 200 }), // great income, terrible safety
      makeFeature({ hr_mtu: 20000, crime_index: 10 }),   // poor income, great safety
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100; // only income matters
    // safety = 0, so crime_index shouldn't affect the result

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBeGreaterThan(
      features[1].properties!.quality_index as number,
    );
  });

  it('handles equal weights for all factors', () => {
    const features = [
      makeFeature({
        crime_index: 50,
        hr_mtu: 30000,
        unemployment_rate: 10,
        higher_education_rate: 50,
      }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 10;

    computeQualityIndices(features, weights);
    // Should not crash and should produce a valid index
    const qi = features[0].properties!.quality_index;
    expect(qi).not.toBeNull();
    expect(typeof qi).toBe('number');
  });

  it('produces null when all weighted factors have no data', () => {
    const features = [makeFeature({})]; // no metric properties at all

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['cycling'] = 100; // only cycling, but no cycling_density data

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('multi-property factor (services) averages sub-scores', () => {
    const features = [
      makeFeature({
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
      makeFeature({
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 1,
      }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['services'] = 100;

    computeQualityIndices(features, weights);
    // First feature has max values for all services, second has min
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});
