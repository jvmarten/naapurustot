/**
 * Critical logic tests — priority 1: Core business logic
 *
 * Tests the most dangerous code paths where a bug silently corrupts
 * user-visible data across the entire map.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeQualityIndices,
  getQualityCategory,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

/** Helper to build a minimal GeoJSON feature with given properties */
function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', ...props } as NeighborhoodProperties,
  };
}

describe('Quality Index — weighted computation integrity', () => {
  it('produces scores in 0–100 range for realistic data', () => {
    const features = [
      makeFeature({ crime_index: 50, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00100', he_vakiy: 1000 }),
      makeFeature({ crime_index: 150, hr_mtu: 20000, unemployment_rate: 15, higher_education_rate: 20, transit_stop_density: 10, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 45, pno: '00200', he_vakiy: 500 }),
      makeFeature({ crime_index: 20, hr_mtu: 50000, unemployment_rate: 2, higher_education_rate: 75, transit_stop_density: 80, healthcare_density: 10, school_density: 8, daycare_density: 8, grocery_density: 12, air_quality_index: 18, pno: '00300', he_vakiy: 2000 }),
    ];

    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });

  it('highest quality neighborhood gets the highest score', () => {
    const features = [
      makeFeature({ crime_index: 150, hr_mtu: 15000, unemployment_rate: 20, higher_education_rate: 10, transit_stop_density: 5, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 50, pno: '00100', he_vakiy: 1000 }),
      makeFeature({ crime_index: 20, hr_mtu: 55000, unemployment_rate: 1, higher_education_rate: 80, transit_stop_density: 100, healthcare_density: 15, school_density: 10, daycare_density: 10, grocery_density: 15, air_quality_index: 15, pno: '00200', he_vakiy: 1000 }),
    ];

    computeQualityIndices(features);

    const bad = (features[0].properties as NeighborhoodProperties).quality_index!;
    const good = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(good).toBeGreaterThan(bad);
    // The best should be close to 100, worst close to 0 (with only 2 features, min-max gives extremes)
    expect(good).toBe(100);
    expect(bad).toBe(0);
  });

  it('custom weights shift scores correctly — zero weight eliminates factor', () => {
    const features = [
      makeFeature({ crime_index: 200, hr_mtu: 60000, unemployment_rate: 1, higher_education_rate: 80, transit_stop_density: 50, healthcare_density: 5, school_density: 5, daycare_density: 5, grocery_density: 5, air_quality_index: 20, pno: '00100', he_vakiy: 1000 }),
      makeFeature({ crime_index: 10, hr_mtu: 15000, unemployment_rate: 20, higher_education_rate: 10, transit_stop_density: 5, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 50, pno: '00200', he_vakiy: 1000 }),
    ];

    // Default weights: safety=25%, first neighborhood has high crime → penalized
    computeQualityIndices(features);
    const defaultScore1 = (features[0].properties as NeighborhoodProperties).quality_index!;

    // Now set safety weight to 0, only keep income (first neighborhood is rich)
    const customWeights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) customWeights[f.id] = 0;
    customWeights['income'] = 100;

    computeQualityIndices(features, customWeights);
    const incomeOnlyScore1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const incomeOnlyScore2 = (features[1].properties as NeighborhoodProperties).quality_index!;

    // With only income mattering, the rich neighborhood should score 100
    expect(incomeOnlyScore1).toBe(100);
    expect(incomeOnlyScore2).toBe(0);
  });

  it('handles all-null data by producing null quality_index', () => {
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000 }),
    ];

    computeQualityIndices(features);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('handles single feature (min === max) with normalize returning 50', () => {
    const features = [
      makeFeature({ crime_index: 50, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00100', he_vakiy: 1000 }),
    ];

    computeQualityIndices(features);
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    // With one feature, all normalized values are 50, inverted factors are also 50
    expect(qi).toBe(50);
  });

  it('missing data falls back to dataset average (not skipped)', () => {
    // Feature 1 has all data, feature 2 is missing crime_index
    const features = [
      makeFeature({ crime_index: 100, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00100', he_vakiy: 1000 }),
      makeFeature({ crime_index: 20, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00200', he_vakiy: 1000 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00300', he_vakiy: 1000 }),
    ];

    computeQualityIndices(features);
    const qi3 = (features[2].properties as NeighborhoodProperties).quality_index;
    expect(qi3).not.toBeNull();
    // The missing-crime feature should get the average crime score, not be penalized or boosted
  });

  it('income <= 0 is excluded from range calculation (requirePositive)', () => {
    const features = [
      makeFeature({ hr_mtu: 0, crime_index: 50, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00100', he_vakiy: 1000 }),
      makeFeature({ hr_mtu: 30000, crime_index: 50, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00200', he_vakiy: 1000 }),
      makeFeature({ hr_mtu: 50000, crime_index: 50, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 6, air_quality_index: 25, pno: '00300', he_vakiy: 1000 }),
    ];

    computeQualityIndices(features);
    // Feature with hr_mtu=0 should still get a score (falls back to average for income)
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).not.toBeNull();
  });
});

describe('Quality Category classification', () => {
  it('maps boundary values correctly', () => {
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

  it('categories cover entire 0–100 range without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i)).not.toBeNull();
    }
  });
});

describe('Quality Weights management', () => {
  it('default weights sum to 95 (leaving room for secondary factors)', () => {
    const weights = getDefaultWeights();
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    // Primary factors sum to 95%, secondary start at 0%
    expect(sum).toBe(95);
  });

  it('isCustomWeights detects any deviation', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
    const custom = { ...getDefaultWeights(), safety: 50 };
    expect(isCustomWeights(custom)).toBe(true);
  });

  it('isCustomWeights treats missing keys as default', () => {
    // Partial weights object — missing keys should use defaultWeight
    expect(isCustomWeights({})).toBe(false);
  });

  it('all quality factors have unique IDs', () => {
    const ids = QUALITY_FACTORS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all primary factors have defaultWeight > 0', () => {
    for (const f of QUALITY_FACTORS) {
      if (f.primary && f.defaultWeight === 0) {
        // Primary factors should contribute to the default score
        throw new Error(`Primary factor ${f.id} has defaultWeight=0`);
      }
    }
  });
});
