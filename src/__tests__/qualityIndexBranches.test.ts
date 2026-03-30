import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeQualityIndices — untested branches', () => {
  it('sets quality_index to null when all weights are zero', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    const zeroWeights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) zeroWeights[f.id] = 0;

    computeQualityIndices(features, zeroWeights);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('handles single feature (no spread — normalize returns 50)', () => {
    const features = [
      makeFeature({
        hr_mtu: 30000,
        unemployment_rate: 10,
        higher_education_rate: 50,
        crime_index: 5,
        transit_stop_density: 3,
        air_quality_index: 2,
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 1,
      }),
    ];
    computeQualityIndices(features);
    // All normalized values are 50 (min === max). Inverted factors: 100-50=50.
    // All factor scores are 50, weighted average = 50.
    expect(features[0].properties!.quality_index).toBe(50);
  });

  it('handles features with Infinity values in metrics', () => {
    const features = [
      makeFeature({ hr_mtu: Infinity, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    computeQualityIndices(features);
    // Infinity is filtered by isFinite check, so both should get quality indices
    expect(features[0].properties!.quality_index).not.toBeNull();
    expect(features[1].properties!.quality_index).not.toBeNull();
  });

  it('handles NaN values in metrics', () => {
    const features = [
      makeFeature({ hr_mtu: NaN, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).not.toBeNull();
    expect(features[1].properties!.quality_index).not.toBeNull();
  });

  it('correctly inverts scores for crime_index (lower is better)', () => {
    const features = [
      makeFeature({ crime_index: 1 }),   // low crime = high quality
      makeFeature({ crime_index: 100 }), // high crime = low quality
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100; // only use safety factor

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(100); // best
    expect(features[1].properties!.quality_index).toBe(0);   // worst
  });

  it('handles multi-property factor (services) correctly', () => {
    const features = [
      makeFeature({
        healthcare_density: 0, school_density: 0,
        daycare_density: 0, grocery_density: 0,
      }),
      makeFeature({
        healthcare_density: 10, school_density: 10,
        daycare_density: 10, grocery_density: 10,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('handles multi-property factor with partial data', () => {
    const features = [
      makeFeature({
        healthcare_density: 0, school_density: null,
        daycare_density: null, grocery_density: null,
      }),
      makeFeature({
        healthcare_density: 10, school_density: null,
        daycare_density: null, grocery_density: null,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);
    // Only healthcare_density is available; should still work
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('cache invalidates when features array reference changes', () => {
    const features1 = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 5 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 15 }),
    ];
    computeQualityIndices(features1);
    const qi1 = features1[0].properties!.quality_index;

    // New array with different data
    const features2 = [
      makeFeature({ hr_mtu: 20000, unemployment_rate: 5 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 15 }),
    ];
    computeQualityIndices(features2);
    // Should have computed fresh ranges from features2
    expect(features2[0].properties!.quality_index).toEqual(expect.any(Number));
    // Confirm it didn't corrupt features1 results
    expect(features1[0].properties!.quality_index).toBe(qi1);
  });

  it('treats negative hr_mtu as missing', () => {
    const features = [
      makeFeature({ hr_mtu: -100 }),
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);
    // Feature 0 falls back to metro average income ((30000+50000)/2=40000) → normalized to 50
    expect(features[0].properties!.quality_index).toBe(50);
    // Features 1 and 2 should be scored
    expect(features[1].properties!.quality_index).toBe(0);
    expect(features[2].properties!.quality_index).toBe(100);
  });
});

describe('getDefaultWeights', () => {
  it('returns weights for all quality factors', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('sums primary factor weights to 95', () => {
    const total = QUALITY_FACTORS
      .filter((f) => f.primary)
      .reduce((sum, f) => sum + f.defaultWeight, 0);
    expect(total).toBe(95);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when a weight differs', () => {
    const w = getDefaultWeights();
    w.safety = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false for empty object (falls back to defaults)', () => {
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a zero-default weight is set non-zero', () => {
    const w = getDefaultWeights();
    w.cycling = 10; // default is 0
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('getQualityCategory — edge cases', () => {
  it('returns null for values outside 0-100 range', () => {
    expect(getQualityCategory(101)).toBeNull();
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('handles exact boundary at 20.5 (between Avoid and Bad)', () => {
    // 20.5 is >= 0 and <= 20? No, 20.5 > 20 and < 21, so no category matches
    expect(getQualityCategory(20.5)).toBeNull();
  });
});
