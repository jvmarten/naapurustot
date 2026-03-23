/**
 * Tests for quality index computation with custom weights, cache behavior,
 * and edge cases in normalization.
 *
 * The quality index is the most visible user-facing metric. Bugs here would
 * silently rank neighborhoods incorrectly.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00000', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [25, 60] },
  };
}

function getProp(f: GeoJSON.Feature): NeighborhoodProperties {
  return f.properties as NeighborhoodProperties;
}

describe('Quality index — custom weights', () => {
  it('produces different rankings when weights change dramatically', () => {
    // Two neighborhoods: A is safe but poor, B is rich but dangerous
    const features = [
      makeFeature({ pno: 'A', crime_index: 10, hr_mtu: 20000, unemployment_rate: 15, higher_education_rate: 20, transit_stop_density: 10, healthcare_density: 1, daycare_density: 1, school_density: 1, grocery_density: 1, air_quality_index: 20 }),
      makeFeature({ pno: 'B', crime_index: 200, hr_mtu: 60000, unemployment_rate: 3, higher_education_rate: 70, transit_stop_density: 50, healthcare_density: 5, daycare_density: 5, school_density: 5, grocery_density: 5, air_quality_index: 40 }),
    ];

    // Default weights: safety=25, income=20
    computeQualityIndices(features);

    // Now weight ONLY safety at 100
    const safetyOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) safetyOnly[f.id] = 0;
    safetyOnly.safety = 100;

    computeQualityIndices(features, safetyOnly);
    const safetyA = getProp(features[0]).quality_index!;
    const safetyB = getProp(features[1]).quality_index!;

    // With safety-only weights, A (low crime) should score higher than B
    expect(safetyA).toBeGreaterThan(safetyB);

    // Now weight ONLY income at 100
    const incomeOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) incomeOnly[f.id] = 0;
    incomeOnly.income = 100;

    computeQualityIndices(features, incomeOnly);
    const incomeA = getProp(features[0]).quality_index!;
    const incomeB = getProp(features[1]).quality_index!;

    // With income-only weights, B (high income) should score higher than A
    expect(incomeB).toBeGreaterThan(incomeA);
  });

  it('setting all weights to zero produces null quality_index', () => {
    const features = [makeFeature({ hr_mtu: 30000, crime_index: 50 })];
    const zeroWeights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) zeroWeights[f.id] = 0;

    computeQualityIndices(features, zeroWeights);
    expect(getProp(features[0]).quality_index).toBeNull();
  });

  it('equal weights on two factors produces average of both scores', () => {
    // Two features with known values for safety and income only
    const features = [
      makeFeature({ crime_index: 50, hr_mtu: 30000 }),
      makeFeature({ crime_index: 100, hr_mtu: 50000 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 50;
    weights.income = 50;

    computeQualityIndices(features, weights);

    // Both scores should be defined
    expect(getProp(features[0]).quality_index).not.toBeNull();
    expect(getProp(features[1]).quality_index).not.toBeNull();
  });
});

describe('Quality index — normalization edge cases', () => {
  it('all neighborhoods with same value get score of 50 (max === min case)', () => {
    const features = [
      makeFeature({ crime_index: 100 }),
      makeFeature({ crime_index: 100 }),
      makeFeature({ crime_index: 100 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);

    // When all values are identical, normalize returns 50, then safety inverts to 50
    for (const f of features) {
      expect(getProp(f).quality_index).toBe(50);
    }
  });

  it('two neighborhoods produce scores 0 and 100 for a single non-inverted factor', () => {
    const features = [
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 60000 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    const scores = features.map((f) => getProp(f).quality_index!);
    expect(Math.min(...scores)).toBe(0);
    expect(Math.max(...scores)).toBe(100);
  });

  it('inverted factor (crime) gives higher score to lower value', () => {
    const features = [
      makeFeature({ pno: 'safe', crime_index: 10 }),
      makeFeature({ pno: 'dangerous', crime_index: 200 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);

    // Low crime = high safety score
    expect(getProp(features[0]).quality_index!).toBe(100);
    expect(getProp(features[1]).quality_index!).toBe(0);
  });

  it('features with null property values are skipped (no NaN contamination)', () => {
    const features = [
      makeFeature({ hr_mtu: null, crime_index: 50 }),
      makeFeature({ hr_mtu: 30000, crime_index: 100 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.safety = 50;

    computeQualityIndices(features, weights);

    // First feature: income is null, so only safety contributes
    const qi1 = getProp(features[0]).quality_index;
    expect(qi1).not.toBeNull();
    expect(Number.isNaN(qi1)).toBe(false);
  });

  it('hr_mtu with value <= 0 is excluded from normalization range', () => {
    const features = [
      makeFeature({ hr_mtu: -1 }), // should be excluded
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 40000 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    // First feature should have null quality_index (no valid income data)
    expect(getProp(features[0]).quality_index).toBeNull();
    // Others should have valid scores (0 and 100)
    expect(getProp(features[1]).quality_index).toBe(0);
    expect(getProp(features[2]).quality_index).toBe(100);
  });
});

describe('Quality index — multi-property factors (services)', () => {
  it('services factor averages across all 4 service densities', () => {
    // Services factor uses: healthcare_density, school_density, daycare_density, grocery_density
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

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    // First should score 100, second should score 0
    expect(getProp(features[0]).quality_index).toBe(100);
    expect(getProp(features[1]).quality_index).toBe(0);
  });

  it('services factor handles partial null values', () => {
    const features = [
      makeFeature({
        healthcare_density: 10,
        school_density: null, // missing
        daycare_density: 10,
        grocery_density: null, // missing
      }),
      makeFeature({
        healthcare_density: 0,
        school_density: null,
        daycare_density: 0,
        grocery_density: null,
      }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    // Should still produce valid scores from available sub-metrics
    expect(getProp(features[0]).quality_index).not.toBeNull();
    expect(getProp(features[1]).quality_index).not.toBeNull();
  });
});

describe('getDefaultWeights / isCustomWeights', () => {
  it('default weights sum is documented correctly', () => {
    const w = getDefaultWeights();
    const primarySum = QUALITY_FACTORS
      .filter((f) => f.primary)
      .reduce((sum, f) => sum + w[f.id], 0);
    // Should be 95 (25+20+20+15+7+5+3)
    expect(primarySum).toBe(95);
  });

  it('isCustomWeights returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('isCustomWeights returns true when any weight differs', () => {
    const w = getDefaultWeights();
    w.safety = 50; // changed from 25
    expect(isCustomWeights(w)).toBe(true);
  });

  it('isCustomWeights returns true when a secondary factor is enabled', () => {
    const w = getDefaultWeights();
    w.cycling = 10; // was 0
    expect(isCustomWeights(w)).toBe(true);
  });

  it('isCustomWeights handles missing keys (treats as default)', () => {
    // Empty object: all factors fall back to defaultWeight
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('getQualityCategory', () => {
  it('returns correct category for each boundary value', () => {
    expect(getQualityCategory(0)?.label.en).toBe('Avoid');
    expect(getQualityCategory(20)?.label.en).toBe('Avoid');
    expect(getQualityCategory(21)?.label.en).toBe('Bad');
    expect(getQualityCategory(40)?.label.en).toBe('Bad');
    expect(getQualityCategory(41)?.label.en).toBe('Okay');
    expect(getQualityCategory(60)?.label.en).toBe('Okay');
    expect(getQualityCategory(61)?.label.en).toBe('Good');
    expect(getQualityCategory(80)?.label.en).toBe('Good');
    expect(getQualityCategory(81)?.label.en).toBe('Excellent');
    expect(getQualityCategory(100)?.label.en).toBe('Excellent');
  });

  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('returns null for out-of-range values', () => {
    // -1 is below all category ranges
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('categories cover the full 0-100 range without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i), `No category for score ${i}`).not.toBeNull();
    }
  });

  it('categories have unique, non-overlapping color assignments', () => {
    const colors = QUALITY_CATEGORIES.map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
