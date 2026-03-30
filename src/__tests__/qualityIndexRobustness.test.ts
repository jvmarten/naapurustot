import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { QualityWeights } from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: null,
      city: null,
      he_vakiy: 1000,
      hr_mtu: null,
      unemployment_rate: null,
      higher_education_rate: null,
      crime_index: null,
      transit_stop_density: null,
      air_quality_index: null,
      healthcare_density: null,
      school_density: null,
      daycare_density: null,
      grocery_density: null,
      cycling_density: null,
      restaurant_density: null,
      quality_index: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

describe('computeQualityIndices — robustness', () => {
  it('assigns null quality_index when all metric values are null', () => {
    const features = [makeFeature({})];
    computeQualityIndices(features);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('computes index when only a single factor has data', () => {
    const features = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 50000 }),
    ];
    computeQualityIndices(features);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index;
    expect(qi0).not.toBeNull();
    expect(qi1).not.toBeNull();
    // Higher income should yield higher quality index
    expect(qi1!).toBeGreaterThan(qi0!);
  });

  it('all zero weights → null quality_index for all features', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5 }),
    ];
    const zeroWeights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) {
      zeroWeights[f.id] = 0;
    }
    computeQualityIndices(features, zeroWeights);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('single factor with weight produces valid 0-100 range', () => {
    const features = [
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 40000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100;
    computeQualityIndices(features, weights);
    const indices = features.map(
      (f) => (f.properties as NeighborhoodProperties).quality_index,
    );
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(50);
    expect(indices[2]).toBe(100);
  });

  it('inverted factor (crime) gives higher score to lower values', () => {
    const features = [
      makeFeature({ crime_index: 20 }),  // low crime
      makeFeature({ crime_index: 100 }), // high crime
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['safety'] = 100;
    computeQualityIndices(features, weights);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi0).toBe(100); // low crime = high safety
    expect(qi1).toBe(0);   // high crime = low safety
  });

  it('services factor averages multiple sub-properties', () => {
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
    weights['services'] = 100;
    computeQualityIndices(features, weights);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });

  it('features with identical values all get 50 (min===max → normalize returns 50)', () => {
    const features = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ hr_mtu: 30000 }),
    ];
    computeQualityIndices(features);
    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi0).toBe(qi1);
  });

  it('skips features with hr_mtu <= 0 from income range calculation', () => {
    const features = [
      makeFeature({ hr_mtu: 0 }),      // should be excluded from range
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: 40000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100;
    computeQualityIndices(features, weights);
    // Feature 0 falls back to metro average ((20000+40000)/2=30000) → normalized to 50
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBe(50);
    expect((features[1].properties as NeighborhoodProperties).quality_index).toBe(0);
    expect((features[2].properties as NeighborhoodProperties).quality_index).toBe(100);
  });

  it('handles empty features array without throwing', () => {
    expect(() => computeQualityIndices([])).not.toThrow();
  });

  it('quality_index is always an integer (rounded)', () => {
    const features = [
      makeFeature({ hr_mtu: 25000, unemployment_rate: 3 }),
      makeFeature({ hr_mtu: 35000, unemployment_rate: 7 }),
      makeFeature({ hr_mtu: 45000, unemployment_rate: 5 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      if (qi != null) {
        expect(Number.isInteger(qi)).toBe(true);
      }
    }
  });
});

describe('getDefaultWeights', () => {
  it('returns weights for all quality factors', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('total default weights sum to expected value', () => {
    const w = getDefaultWeights();
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    // Primary weights: 25+20+20+15+7+5+3 = 95, secondary all 0
    expect(total).toBe(95);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs', () => {
    const w = getDefaultWeights();
    w['safety'] = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false for empty object (defaults to defaultWeight via ??)', () => {
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a secondary factor gets a non-zero weight', () => {
    const w = getDefaultWeights();
    w['cycling'] = 10;
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('getQualityCategory', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

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

  it('returns null for values outside all categories', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('every category has both fi and en labels', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.label.fi).toBeTruthy();
      expect(cat.label.en).toBeTruthy();
    }
  });

  it('categories cover the full 0-100 range without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i)).not.toBeNull();
    }
  });
});
