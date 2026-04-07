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

describe('quality index — inverted factor correctness', () => {
  it('air_quality_index is correctly inverted (lower raw = better score)', () => {
    const features = [
      makeFeature({ air_quality_index: 1 }),   // best air quality
      makeFeature({ air_quality_index: 10 }),  // worst air quality
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.air_quality = 100;

    computeQualityIndices(features, weights);

    // Low air_quality_index → high quality score (inverted)
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('crime_index is correctly inverted (lower raw = better score)', () => {
    const features = [
      makeFeature({ crime_index: 2 }),
      makeFeature({ crime_index: 20 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('non-inverted factors score higher raw values higher', () => {
    const features = [
      makeFeature({ transit_stop_density: 1 }),
      makeFeature({ transit_stop_density: 20 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.transit = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('all inverted factors in QUALITY_FACTORS are marked correctly', () => {
    const invertedIds = QUALITY_FACTORS.filter((f) => f.invert).map((f) => f.id);
    // Safety (crime) and air quality should be inverted
    expect(invertedIds).toContain('safety');
    expect(invertedIds).toContain('air_quality');
    // Income, education, transit, services should NOT be inverted
    expect(invertedIds).not.toContain('income');
    expect(invertedIds).not.toContain('education');
    expect(invertedIds).not.toContain('transit');
    expect(invertedIds).not.toContain('services');
  });
});

describe('quality index — multi-property factor averaging', () => {
  it('services factor averages 4 sub-properties correctly', () => {
    const features = [
      makeFeature({
        healthcare_density: 0,
        school_density: 0,
        daycare_density: 0,
        grocery_density: 0,
      }),
      makeFeature({
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('services factor handles partial sub-property nulls', () => {
    // Feature 0: has 2 of 4 sub-properties, both at min
    // Feature 1: has all 4, all at max
    const features = [
      makeFeature({
        healthcare_density: 0,
        school_density: null,
        daycare_density: 0,
        grocery_density: null,
      }),
      makeFeature({
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    // Feature 0: healthcare=0, school=fallback to avg(10)→50, daycare=0, grocery=fallback to avg(10)→50
    // avg = (0+50+0+50)/4 = 25
    expect(features[0].properties!.quality_index).toBe(25);
    // Feature 1: healthcare=100, school=50(min===max), daycare=100, grocery=50(min===max)
    // avg = (100+50+100+50)/4 = 75
    expect(features[1].properties!.quality_index).toBe(75);
  });

  it('services factor with mixed sub-property values computes correct average', () => {
    const features = [
      makeFeature({
        healthcare_density: 0,
        school_density: 0,
        daycare_density: 0,
        grocery_density: 0,
      }),
      makeFeature({
        healthcare_density: 10,
        school_density: 0,  // min value for this property
        daycare_density: 10,
        grocery_density: 0,  // min value for this property
      }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    // Feature 1: healthcare=100, school=50(same values→50), daycare=100, grocery=50
    // Wait — school_density has values [0, 0] → min===max → normalize returns 50
    // healthcare: [0, 10] → feature1=100, daycare: [0, 10] → feature1=100
    // school: [0, 0] → 50, grocery: [0, 0] → 50
    // avg = (100+50+100+50)/4 = 75
    expect(features[1].properties!.quality_index).toBe(75);
  });
});

describe('quality index — weight redistribution', () => {
  it('rebalances weights when some factors have no data', () => {
    // Only income data available — all other factors null
    const features = [
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 40000 }),
    ];
    // Use default weights (income=20, safety=25, employment=20, etc.)
    computeQualityIndices(features);

    // With only income: min=20k→0, max=40k→100
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('zero-weight factors do not contribute to score', () => {
    const features = [
      makeFeature({ hr_mtu: 50000, crime_index: 100 }),
      makeFeature({ hr_mtu: 10000, crime_index: 1 }),
    ];
    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;
    // safety=0, so crime_index is ignored

    computeQualityIndices(features, weights);

    // Only income matters: feature 0 is highest
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });
});

describe('getDefaultWeights / isCustomWeights', () => {
  it('default weights match QUALITY_FACTORS', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('default weights are not custom', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('modified weight is detected as custom', () => {
    const w = getDefaultWeights();
    w.income = 99;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('missing key falls back to default (not custom)', () => {
    const w: Record<string, number> = {};
    // Empty object — all keys missing → all default
    expect(isCustomWeights(w)).toBe(false);
  });
});

describe('getQualityCategory — edge cases', () => {
  it('returns null for values outside 0-100', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('returns correct category for exact boundary values', () => {
    expect(getQualityCategory(0)!.label.en).toBe('Avoid');
    expect(getQualityCategory(20)!.label.en).toBe('Avoid');
    expect(getQualityCategory(21)!.label.en).toBe('Bad');
    expect(getQualityCategory(100)!.label.en).toBe('Excellent');
  });

  it('handles non-integer values correctly', () => {
    // Categories use continuous boundaries — no gaps between them
    // 20.5 is > 20 (Bad min) and <= 40 (Bad max), so it falls in Bad
    expect(getQualityCategory(20.5)!.label.en).toBe('Bad');
    // 80.9 is > 80 (Excellent min) and <= 100, so it falls in Excellent
    expect(getQualityCategory(80.9)!.label.en).toBe('Excellent');
    // Values within integer ranges still work
    expect(getQualityCategory(50)!.label.en).toBe('Okay');
  });
});
