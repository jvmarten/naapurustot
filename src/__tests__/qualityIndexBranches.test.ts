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
        violent_crime_rate: 5,
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

  it('correctly inverts scores for violent_crime_rate (lower is better)', () => {
    // The safety factor reads violent_crime_rate (crimes against life and health),
    // not crime_index — total offences are 47% property crime and 22% traffic
    // infractions, so they are an opt-in factor of their own now.
    const features = [
      makeFeature({ violent_crime_rate: 1 }),   // low violent crime = high quality
      makeFeature({ violent_crime_rate: 100 }), // high violent crime = low quality
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

  it('sums primary factor weights to 100', () => {
    // Weights are RELATIVE: computeQualityIndices divides by the actual total
    // weight, so only the ratios between factors matter — the total need not be
    // 100. It used to be, but cutting safety from 26 to 15 (crime is a municipal
    // statistic, identical for every postal code in a city, so a quarter of the
    // score could not move when comparing neighbourhoods) freed 11 points that
    // were deliberately NOT redistributed to the other factors.
    const total = QUALITY_FACTORS
      .filter((f) => f.primary)
      .reduce((sum, f) => sum + Math.abs(f.defaultWeight), 0);
    // Primary factors sum to 100; secondary factors (incl. the opt-in
    // property_crime and total_crime) start at 0.
    // safety 15 + traffic 8 + air 9 + tree 8 + noise 7 + water 4 + employment 12
    // + income 10 + education 4 + walkability 7 + transit 7 + services 6 + cycling 3
    // Safety was cut 26 -> 15 because crime is a municipal statistic and cannot
    // distinguish neighbourhoods within a city; the freed 11 points went to
    // traffic (4->8), transit (3->7) and services (3->6), all postal-resolution.
    expect(total).toBe(100);
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
    // 20.5 is > 20 (Bad min) and <= 40 (Bad max), so it falls in Bad
    // Categories use continuous boundaries: no gaps between them
    expect(getQualityCategory(20.5)!.label.en).toBe('Bad');
  });
});
