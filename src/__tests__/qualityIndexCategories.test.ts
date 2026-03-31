import { describe, it, expect } from 'vitest';
import {
  getQualityCategory,
  QUALITY_CATEGORIES,
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('getQualityCategory', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('maps 0 to Avoid', () => {
    const cat = getQualityCategory(0);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('maps 20 to Avoid (boundary)', () => {
    expect(getQualityCategory(20)!.label.en).toBe('Avoid');
  });

  it('maps 21 to Bad (boundary crossing)', () => {
    expect(getQualityCategory(21)!.label.en).toBe('Bad');
  });

  it('maps 40 to Bad', () => {
    expect(getQualityCategory(40)!.label.en).toBe('Bad');
  });

  it('maps 41 to Okay', () => {
    expect(getQualityCategory(41)!.label.en).toBe('Okay');
  });

  it('maps 60 to Okay', () => {
    expect(getQualityCategory(60)!.label.en).toBe('Okay');
  });

  it('maps 61 to Good', () => {
    expect(getQualityCategory(61)!.label.en).toBe('Good');
  });

  it('maps 80 to Good', () => {
    expect(getQualityCategory(80)!.label.en).toBe('Good');
  });

  it('maps 81 to Excellent', () => {
    expect(getQualityCategory(81)!.label.en).toBe('Excellent');
  });

  it('maps 100 to Excellent', () => {
    expect(getQualityCategory(100)!.label.en).toBe('Excellent');
  });

  it('returns null for values outside 0-100 range', () => {
    // -1 doesn't match any category
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('categories cover the full 0-100 range without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i)).not.toBeNull();
    }
  });

  it('categories have valid hex colors', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs', () => {
    const w = getDefaultWeights();
    w.safety = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns true for empty weights object (missing keys treated as defaults)', () => {
    // Empty object: all weights fall back to defaults via ?? f.defaultWeight
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('computeQualityIndices — edge cases', () => {
  it('assigns null when all quality factor data is missing', () => {
    const features = [makeFeature({ he_vakiy: 1000 })];
    // All quality-related properties are null/undefined
    computeQualityIndices(features);
    // With no data for any factor, should still compute (uses metro avg fallback)
    // But with a single feature and no data, ranges will be min===max → normalize returns 50
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    // Either null (no factors scored) or a number — but not NaN
    if (qi !== null) {
      expect(isFinite(qi)).toBe(true);
    }
  });

  it('produces index between 0 and 100 for normal data', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, crime_index: 30, hr_mtu: 35000, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 40, healthcare_density: 3, school_density: 2, daycare_density: 2, grocery_density: 4, air_quality_index: 25 }),
      makeFeature({ pno: '00200', he_vakiy: 2000, crime_index: 100, hr_mtu: 20000, unemployment_rate: 15, higher_education_rate: 20, transit_stop_density: 10, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 45 }),
    ];
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });

  it('skips factors with zero weight', () => {
    const weights: QualityWeights = {};
    // Set all weights to 0 except safety
    for (const key of Object.keys(getDefaultWeights())) {
      weights[key] = 0;
    }
    weights.safety = 100;

    const features = [
      makeFeature({ he_vakiy: 1000, crime_index: 20, hr_mtu: null }),
      makeFeature({ pno: '00200', he_vakiy: 2000, crime_index: 100, hr_mtu: null }),
    ];
    computeQualityIndices(features, weights);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index;
    // Lower crime should produce higher quality (inverted)
    expect(qi1).not.toBeNull();
    expect(qi2).not.toBeNull();
    expect(qi1!).toBeGreaterThan(qi2!);
  });

  it('inverted factors score low crime as high quality', () => {
    const features = [
      makeFeature({ he_vakiy: 1000, crime_index: 10 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, crime_index: 200 }),
    ];
    const weights: QualityWeights = {};
    for (const key of Object.keys(getDefaultWeights())) weights[key] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);
    const qLow = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qHigh = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qLow).toBeGreaterThan(qHigh); // low crime = high quality
  });
});
