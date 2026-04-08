/**
 * Tests for quality index custom weights behavior.
 *
 * Covers: isCustomWeights(), getDefaultWeights(), custom weight application,
 * zero-weight factor exclusion, and the range cache invalidation path.
 * These are high-risk because bugs here silently corrupt the primary ranking
 * metric used across the entire application.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  getQualityCategory,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
  };
}

describe('getDefaultWeights', () => {
  it('returns a weight for every defined factor', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w).toHaveProperty(f.id);
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('primary factors sum to a non-zero total', () => {
    const w = getDefaultWeights();
    const primarySum = QUALITY_FACTORS
      .filter((f) => f.primary)
      .reduce((sum, f) => sum + w[f.id], 0);
    expect(primarySum).toBeGreaterThan(0);
  });

  it('secondary factors default to zero', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      if (!f.primary) {
        expect(w[f.id]).toBe(0);
      }
    }
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when a single weight differs', () => {
    const w = getDefaultWeights();
    w.safety = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns true when a secondary factor is enabled', () => {
    const w = getDefaultWeights();
    w.cycling = 10;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('treats missing keys as defaultWeight (falls back correctly)', () => {
    // An empty object should compare each factor's key: (undefined ?? defaultWeight) === defaultWeight
    // This should return false only if all defaults are matched
    const w: Record<string, number> = {};
    expect(isCustomWeights(w)).toBe(false);
  });

  it('returns true for a zeroed-out primary factor', () => {
    const w = getDefaultWeights();
    w.safety = 0;
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('computeQualityIndices with custom weights', () => {
  it('excludes factors with weight=0 from the computation', () => {
    // Two features that differ only in crime (safety factor)
    const features = [
      makeFeature({ hr_mtu: 30000, crime_index: 100, unemployment_rate: 5, higher_education_rate: 50 }),
      makeFeature({ hr_mtu: 30000, crime_index: 0, unemployment_rate: 5, higher_education_rate: 50 }),
    ];

    // With safety weighted, the feature with lower crime should score higher
    computeQualityIndices(features, getDefaultWeights());
    const withSafety0 = features[0].properties!.quality_index as number;
    const withSafety1 = features[1].properties!.quality_index as number;
    expect(withSafety1).toBeGreaterThan(withSafety0);

    // Now disable safety — scores should become equal (since all other metrics match)
    const noSafety = getDefaultWeights();
    noSafety.safety = 0;
    computeQualityIndices(features, noSafety);
    expect(features[0].properties!.quality_index).toBe(features[1].properties!.quality_index);
  });

  it('produces different rankings when weights change', () => {
    const features = [
      makeFeature({ hr_mtu: 50000, unemployment_rate: 15, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 20000, unemployment_rate: 2, higher_education_rate: 80 }),
    ];

    // Income-heavy weights: feature 0 should win
    const incomeHeavy = { ...getDefaultWeights() };
    for (const k of Object.keys(incomeHeavy)) incomeHeavy[k] = 0;
    incomeHeavy.income = 100;
    computeQualityIndices(features, incomeHeavy);
    const f0Income = features[0].properties!.quality_index as number;
    const f1Income = features[1].properties!.quality_index as number;
    expect(f0Income).toBeGreaterThan(f1Income);

    // Employment-heavy weights: feature 1 should win (lower unemployment)
    const employHeavy = { ...getDefaultWeights() };
    for (const k of Object.keys(employHeavy)) employHeavy[k] = 0;
    employHeavy.employment = 100;
    computeQualityIndices(features, employHeavy);
    const f0Employ = features[0].properties!.quality_index as number;
    const f1Employ = features[1].properties!.quality_index as number;
    expect(f1Employ).toBeGreaterThan(f0Employ);
  });

  it('sets quality_index to null when all weights are zero', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5 }),
    ];
    const allZero: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) allZero[f.id] = 0;
    computeQualityIndices(features, allZero);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('handles single-feature datasets (min === max → normalize returns 50)', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, crime_index: 10, transit_stop_density: 5 }),
    ];
    computeQualityIndices(features);
    // When min === max for all metrics, normalize returns 50 for each.
    // Inverted factors get 100-50=50. So the final score should be 50.
    expect(features[0].properties!.quality_index).toBe(50);
  });

  it('recomputes when a new features array is passed (cache invalidation)', () => {
    // Dataset 1: wide range — middle feature should get ~50
    const set1 = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 20, higher_education_rate: 10, crime_index: 50, transit_stop_density: 1 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50, crime_index: 25, transit_stop_density: 5 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 1, higher_education_rate: 90, crime_index: 1, transit_stop_density: 10 }),
    ];
    computeQualityIndices(set1);
    const scoreMid1 = set1[1].properties!.quality_index as number;

    // Dataset 2: same middle feature is now the worst — should score lower
    const set2 = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50, crime_index: 25, transit_stop_density: 5 }),
      makeFeature({ hr_mtu: 60000, unemployment_rate: 2, higher_education_rate: 85, crime_index: 2, transit_stop_density: 15 }),
      makeFeature({ hr_mtu: 80000, unemployment_rate: 1, higher_education_rate: 95, crime_index: 1, transit_stop_density: 20 }),
    ];
    computeQualityIndices(set2);
    const scoreMid2 = set2[0].properties!.quality_index as number;

    // Same raw values for the "middle" feature → different quality indices because the
    // normalization ranges changed (in set2 it's the worst, in set1 it was truly middle)
    expect(scoreMid1).not.toBe(scoreMid2);
    expect(scoreMid1).toBeGreaterThan(scoreMid2);
  });
});

describe('getQualityCategory boundary precision', () => {
  it('maps exact boundary value 20 to the first category (half-open interval)', () => {
    // Category boundaries: [0,20], (20,40], (40,60], (60,80], (80,100]
    const cat = getQualityCategory(20);
    expect(cat).not.toBeNull();
    expect(cat!.max).toBe(20);
  });

  it('maps 20.5 to the second category (not a gap)', () => {
    const cat = getQualityCategory(20.5);
    expect(cat).not.toBeNull();
    expect(cat!.min).toBe(20);
    expect(cat!.max).toBe(40);
  });

  it('maps 0 to the first category', () => {
    const cat = getQualityCategory(0);
    expect(cat).not.toBeNull();
    expect(cat!.min).toBe(0);
  });

  it('maps 100 to the last category', () => {
    const cat = getQualityCategory(100);
    expect(cat).not.toBeNull();
    expect(cat!.max).toBe(100);
  });

  it('returns null for values outside range', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('covers all integer values 0–100 without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      expect(cat).not.toBeNull();
    }
  });

  it('every category is reachable', () => {
    const reached = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      if (cat) reached.add(JSON.stringify(cat.label));
    }
    expect(reached.size).toBe(QUALITY_CATEGORIES.length);
  });
});
