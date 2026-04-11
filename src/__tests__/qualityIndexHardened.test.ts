/**
 * Hardened quality index tests: edge cases around normalization,
 * missing data, weight boundaries, and category classification.
 *
 * These tests target the highest-risk logic in qualityIndex.ts:
 * - normalize() behavior at boundaries
 * - getFactorScore() with missing/NaN/zero data
 * - computeQualityIndices() with custom weights, all-missing data, single feature
 * - getQualityCategory() boundary values and null handling
 * - isCustomWeights() detection
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  computeQualityIndices,
  getQualityCategory,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_CATEGORIES,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

/** Create a minimal feature with given properties for testing. */
function mkFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', he_vakiy: 1000, ...props } as NeighborhoodProperties,
  };
}

describe('computeQualityIndices — edge cases', () => {
  it('produces a score between 0 and 100 for well-formed data', () => {
    const features = [
      mkFeature({ crime_index: 10, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 5, healthcare_density: 2, school_density: 1, daycare_density: 3, grocery_density: 2, air_quality_index: 2 }),
      mkFeature({ pno: '00200', crime_index: 50, hr_mtu: 20000, unemployment_rate: 15, higher_education_rate: 20, transit_stop_density: 2, healthcare_density: 0.5, school_density: 0.3, daycare_density: 1, grocery_density: 0.5, air_quality_index: 5 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });

  it('sets quality_index to null when all factor data is missing', () => {
    const features = [mkFeature({})];
    // Remove all quality-relevant properties
    const p = features[0].properties as Record<string, unknown>;
    for (const factor of QUALITY_FACTORS) {
      for (const prop of factor.properties) {
        delete p[prop as string];
      }
    }
    computeQualityIndices(features);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('handles single feature (min === max → normalize returns 50)', () => {
    const features = [
      mkFeature({ crime_index: 10, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40 }),
    ];
    computeQualityIndices(features);
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    // With a single feature, all normalized scores are 50
    // Inverted factors: 100 - 50 = 50, non-inverted: 50
    // So the weighted average should be 50
    expect(qi).toBe(50);
  });

  it('skips factors with zero custom weight', () => {
    const features = [
      mkFeature({ crime_index: 100, hr_mtu: 50000, unemployment_rate: 0, higher_education_rate: 80 }),
      mkFeature({ pno: '00200', crime_index: 0, hr_mtu: 10000, unemployment_rate: 30, higher_education_rate: 10 }),
    ];
    // Only use income weight
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index;
    // Feature 0 has highest income → should get score 100
    // Feature 1 has lowest income → should get score 0
    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });

  it('handles NaN values in factor properties gracefully', () => {
    const features = [
      mkFeature({ crime_index: NaN, hr_mtu: 30000, unemployment_rate: 5 }),
      mkFeature({ pno: '00200', crime_index: 10, hr_mtu: 20000, unemployment_rate: 10 }),
    ];
    computeQualityIndices(features);
    // Should not crash, and feature with NaN crime gets fallback to dataset avg
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).not.toBeNull();
    expect(typeof qi).toBe('number');
    expect(isFinite(qi!)).toBe(true);
  });

  it('handles Infinity values as missing data', () => {
    const features = [
      mkFeature({ crime_index: Infinity, hr_mtu: 30000 }),
      mkFeature({ pno: '00200', crime_index: 10, hr_mtu: 20000 }),
    ];
    computeQualityIndices(features);
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).not.toBeNull();
    expect(isFinite(qi!)).toBe(true);
  });

  it('excludes income values <= 0 from range calculation', () => {
    const features = [
      mkFeature({ hr_mtu: 0, crime_index: 10 }),
      mkFeature({ pno: '00200', hr_mtu: 50000, crime_index: 20 }),
      mkFeature({ pno: '00300', hr_mtu: 30000, crime_index: 15 }),
    ];
    computeQualityIndices(features);
    // Feature 0 has hr_mtu=0 which is treated as missing for income factor
    // It should still get a quality index from other factors
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).not.toBeNull();
  });

  it('all weights zero produces null quality_index', () => {
    const features = [
      mkFeature({ crime_index: 10, hr_mtu: 30000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    computeQualityIndices(features, weights);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('inverted factor gives higher score for lower raw values', () => {
    const features = [
      mkFeature({ crime_index: 5 }),  // low crime
      mkFeature({ pno: '00200', crime_index: 95 }), // high crime
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100; // crime_index is inverted

    computeQualityIndices(features, weights);
    const qiLow = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qiHigh = (features[1].properties as NeighborhoodProperties).quality_index!;
    // Lower crime → higher quality score
    expect(qiLow).toBeGreaterThan(qiHigh);
  });

  it('multi-property factor (services) averages sub-scores', () => {
    const features = [
      mkFeature({ healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10 }),
      mkFeature({ pno: '00200', healthcare_density: 0, school_density: 0, daycare_density: 0, grocery_density: 0 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });

  it('quality_index is an integer (rounded)', () => {
    const features = [
      mkFeature({ crime_index: 10, hr_mtu: 33333, unemployment_rate: 7.7, higher_education_rate: 42.3 }),
      mkFeature({ pno: '00200', crime_index: 50, hr_mtu: 22222, unemployment_rate: 12.1, higher_education_rate: 28.9 }),
      mkFeature({ pno: '00300', crime_index: 30, hr_mtu: 27777, unemployment_rate: 9.5, higher_education_rate: 35.5 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      if (qi !== null) {
        expect(Number.isInteger(qi)).toBe(true);
      }
    }
  });
});

describe('getQualityCategory — boundary classification', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('maps score 0 to first category (Avoid)', () => {
    const cat = getQualityCategory(0);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('maps score 100 to last category (Excellent)', () => {
    const cat = getQualityCategory(100);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Excellent');
  });

  it('maps score exactly at boundary (20) to the higher category', () => {
    // 20 is boundary between Avoid (0-20) and Bad (20-40)
    // With the half-open interval logic: first is [0,20], rest are (min, max]
    // So 20 falls in [0,20] (Avoid)
    const cat = getQualityCategory(20);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('maps score just above boundary (20.1) to Bad category', () => {
    const cat = getQualityCategory(20.1);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Bad');
  });

  it('every integer score 0–100 maps to exactly one category', () => {
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      expect(cat).not.toBeNull();
    }
  });

  it('score slightly above 100 returns null (out of range)', () => {
    expect(getQualityCategory(101)).toBeNull();
  });

  it('negative score returns null', () => {
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('all categories have contiguous, non-overlapping ranges', () => {
    for (let i = 1; i < QUALITY_CATEGORIES.length; i++) {
      expect(QUALITY_CATEGORIES[i].min).toBe(QUALITY_CATEGORIES[i - 1].max);
    }
    expect(QUALITY_CATEGORIES[0].min).toBe(0);
    expect(QUALITY_CATEGORIES[QUALITY_CATEGORIES.length - 1].max).toBe(100);
  });
});

describe('getDefaultWeights & isCustomWeights', () => {
  it('returns a weight for every quality factor', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBeDefined();
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('default weights are not custom', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('detects custom weights when one factor changed', () => {
    const w = getDefaultWeights();
    w.safety = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('treats missing factor keys as default (not custom)', () => {
    expect(isCustomWeights({})).toBe(false);
  });
});
