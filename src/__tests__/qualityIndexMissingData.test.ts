/**
 * Tests for uncovered branches in qualityIndex.ts (lines 200, 220, 233).
 *
 * These branches handle:
 * - Line 200: isMissing + !isFinite(range.avg) → skip factor property entirely
 * - Line 220: range not in map → skip property (factor with no valid data)
 * - Line 233: all factors skipped → quality_index = null
 *
 * A bug in missing-data handling would assign wrong quality scores to neighborhoods
 * with incomplete data — the most vulnerable entries in the dataset.
 */
import { describe, it, expect } from 'vitest';
import { computeQualityIndices, getDefaultWeights, QUALITY_FACTORS, getQualityCategory, QUALITY_CATEGORIES, isCustomWeights } from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', ...props } as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  };
}

describe('qualityIndex — missing data branches', () => {
  it('sets quality_index to null when ALL factor properties are missing', () => {
    // Feature with no metric data at all → line 233: scores.length === 0
    const features = [
      makeFeature({ pno: '00100' }),
      makeFeature({ pno: '00200' }),
    ];

    // Use weights that only reference factors whose properties are all null
    const weights = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
    // Give weight only to a factor whose property won't exist
    weights['safety'] = 50;

    computeQualityIndices(features, weights);

    // Both should get null since crime_index is undefined on all features
    for (const f of features) {
      expect((f.properties as NeighborhoodProperties).quality_index).toBeNull();
    }
  });

  it('falls back to average when a single feature has missing data but others have it', () => {
    // Feature A has data, Feature B has null → B falls back to avg
    const features = [
      makeFeature({ pno: '00100', crime_index: 10, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 3, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 2 }),
      makeFeature({ pno: '00200', crime_index: 20, hr_mtu: 40000, unemployment_rate: 3, higher_education_rate: 60, transit_stop_density: 5, healthcare_density: 2, school_density: 2, daycare_density: 2, grocery_density: 2, air_quality_index: 3 }),
      makeFeature({ pno: '00300', crime_index: null, hr_mtu: null, unemployment_rate: null, higher_education_rate: null }),
    ];

    computeQualityIndices(features);

    const a = (features[0].properties as NeighborhoodProperties).quality_index;
    const b = (features[1].properties as NeighborhoodProperties).quality_index;
    const c = (features[2].properties as NeighborhoodProperties).quality_index;

    // A and B should have valid indices
    expect(a).toBeTypeOf('number');
    expect(b).toBeTypeOf('number');
    // C has missing data, should fall back to averages and still get a score
    expect(c).toBeTypeOf('number');
  });

  it('handles feature where hr_mtu is 0 (treated as missing per requirePositive logic)', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, crime_index: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 0, crime_index: 10 }),
      makeFeature({ pno: '00300', hr_mtu: 50000, crime_index: 15 }),
    ];

    computeQualityIndices(features);

    // Feature with hr_mtu=0 should still get a quality index
    // because it falls back to average for the income factor
    const qi = (features[1].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBeTypeOf('number');
    expect(qi).toBeGreaterThanOrEqual(0);
    expect(qi).toBeLessThanOrEqual(100);
  });

  it('handles dataset where all values for a property are identical (min === max)', () => {
    const features = [
      makeFeature({ pno: '00100', crime_index: 5, hr_mtu: 30000 }),
      makeFeature({ pno: '00200', crime_index: 5, hr_mtu: 30000 }),
    ];

    computeQualityIndices(features);

    // When min === max, normalize returns 50 → all get same score
    const a = (features[0].properties as NeighborhoodProperties).quality_index;
    const b = (features[1].properties as NeighborhoodProperties).quality_index;
    expect(a).toBe(b);
  });

  it('skips factors with zero weight in custom weights', () => {
    const features = [
      makeFeature({ pno: '00100', crime_index: 5, hr_mtu: 30000, unemployment_rate: 3, higher_education_rate: 50 }),
      makeFeature({ pno: '00200', crime_index: 15, hr_mtu: 20000, unemployment_rate: 8, higher_education_rate: 20 }),
    ];

    // Only safety factor matters
    const weights = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
    weights['safety'] = 100;

    computeQualityIndices(features, weights);

    const a = (features[0].properties as NeighborhoodProperties).quality_index!;
    const b = (features[1].properties as NeighborhoodProperties).quality_index!;

    // Safety is inverted: lower crime = higher score
    // Feature A (crime=5) should score higher than Feature B (crime=15)
    expect(a).toBeGreaterThan(b);
  });

  it('handles NaN and Infinity values in properties gracefully', () => {
    const features = [
      makeFeature({ pno: '00100', crime_index: NaN, hr_mtu: Infinity }),
      makeFeature({ pno: '00200', crime_index: 5, hr_mtu: 30000 }),
      makeFeature({ pno: '00300', crime_index: 10, hr_mtu: 40000 }),
    ];

    computeQualityIndices(features);

    // Feature with NaN/Infinity should still get a score (falls back to average)
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBeTypeOf('number');
    expect(isFinite(qi!)).toBe(true);
  });
});

describe('qualityIndex — getQualityCategory boundaries', () => {
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

  it('returns non-null for fractional values within category ranges', () => {
    // Categories use continuous boundaries — no gaps between them
    // 20.5 is > 20 (Bad min) and <= 40 (Bad max), so it falls in Bad
    expect(getQualityCategory(20.5)!.label.en).toBe('Bad');
    // Values truly outside the range still return null
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('QUALITY_CATEGORIES covers all 5 bands', () => {
    expect(QUALITY_CATEGORIES).toHaveLength(5);
    // Colors should all be valid hex
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('qualityIndex — isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w['safety'] = 50; // default is 25
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false when missing keys fall back to defaults', () => {
    // Empty object → each factor falls back to f.defaultWeight via ?? operator
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a default-zero weight is set to non-zero', () => {
    const w = getDefaultWeights();
    w['cycling'] = 10; // default is 0
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('qualityIndex — services factor averages multiple properties', () => {
  it('services factor score is average of healthcare, school, daycare, grocery densities', () => {
    // Two features with different service densities
    const features = [
      makeFeature({
        pno: '00100',
        healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10,
        // Zero out other factors for isolation
        crime_index: 5, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50,
        transit_stop_density: 5, air_quality_index: 2,
      }),
      makeFeature({
        pno: '00200',
        healthcare_density: 0, school_density: 0, daycare_density: 0, grocery_density: 0,
        crime_index: 5, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 50,
        transit_stop_density: 5, air_quality_index: 2,
      }),
    ];

    // Only weight services
    const weights = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
    weights['services'] = 100;

    computeQualityIndices(features, weights);

    const a = (features[0].properties as NeighborhoodProperties).quality_index!;
    const b = (features[1].properties as NeighborhoodProperties).quality_index!;

    // Feature A with all 10s should score 100, Feature B with all 0s should score 0
    expect(a).toBe(100);
    expect(b).toBe(0);
  });
});
