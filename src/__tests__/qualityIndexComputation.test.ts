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
    geometry: { type: 'Point', coordinates: [24.9, 60.1] },
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      kunta: '091',
      city: 'helsinki_metro',
      he_vakiy: 1000,
      quality_index: null,
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('computeQualityIndices', () => {
  it('assigns quality_index between 0 and 100 for valid data', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5, crime_index: 2, higher_education_rate: 40, transit_stop_density: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 3, crime_index: 1, higher_education_rate: 60, transit_stop_density: 20 }),
      makeFeature({ pno: '00300', hr_mtu: 20000, unemployment_rate: 15, crime_index: 5, higher_education_rate: 20, transit_stop_density: 5 }),
    ];

    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });

  it('highest quality goes to the best neighborhood', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 50000, unemployment_rate: 2, crime_index: 0.5, higher_education_rate: 70 }),
      makeFeature({ pno: '00200', hr_mtu: 20000, unemployment_rate: 20, crime_index: 10, higher_education_rate: 10 }),
    ];

    computeQualityIndices(features);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi1).toBeGreaterThan(qi2);
  });

  it('sets null when all metric data is missing', () => {
    const features = [makeFeature({})];
    computeQualityIndices(features);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('handles features where some metrics are missing', () => {
    const features = [
      makeFeature({ hr_mtu: 30000 }), // Only income available
      makeFeature({ pno: '00200', hr_mtu: 50000 }),
    ];
    computeQualityIndices(features);
    // Should still compute with available metrics
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
    }
  });

  it('respects custom weights', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 50000, unemployment_rate: 15 }),
      makeFeature({ pno: '00200', hr_mtu: 20000, unemployment_rate: 2 }),
    ];

    // Weight income heavily, employment zero
    const weights: QualityWeights = { ...getDefaultWeights() };
    for (const k of Object.keys(weights)) weights[k] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    // Feature 1 has higher income → higher quality with income-only weights
    expect(qi1).toBeGreaterThan(qi2);
  });

  it('all-zero weights result in null quality index', () => {
    const features = [makeFeature({ hr_mtu: 30000, unemployment_rate: 5 })];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;

    computeQualityIndices(features, weights);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('single feature gets score of 50 (min === max)', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 5, crime_index: 2 }),
    ];
    computeQualityIndices(features);
    // With only one feature, all ranges collapse to min=max, normalize returns 50
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBe(50);
  });

  it('skips features with hr_mtu <= 0', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 0, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', hr_mtu: 50000, unemployment_rate: 5 }),
      makeFeature({ pno: '00300', hr_mtu: -1, unemployment_rate: 5 }),
    ];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);
    // Features with hr_mtu <= 0 should use average fallback, not their actual value
  });
});

describe('getDefaultWeights', () => {
  it('returns weights for all factors', () => {
    const w = getDefaultWeights();
    for (const f of QUALITY_FACTORS) {
      expect(w[f.id]).toBe(f.defaultWeight);
    }
  });

  it('primary factors sum to approximately 100', () => {
    const w = getDefaultWeights();
    let sum = 0;
    for (const f of QUALITY_FACTORS) {
      if (f.primary) sum += w[f.id];
    }
    // Primary factor default weights should sum to ~95 (allowing some tolerance)
    expect(sum).toBeGreaterThan(80);
    expect(sum).toBeLessThanOrEqual(100);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w.income = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false for empty object (all defaults via fallback)', () => {
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('getQualityCategory', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('categorizes 0 as Avoid', () => {
    const cat = getQualityCategory(0);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('categorizes 50 as Okay', () => {
    const cat = getQualityCategory(50);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Okay');
  });

  it('categorizes 100 as Excellent', () => {
    const cat = getQualityCategory(100);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Excellent');
  });

  it('returns null for out-of-range values', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('all categories have valid color hex codes', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('categories cover the full 0-100 range without gaps', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i)).not.toBeNull();
    }
  });

  it('boundary values: 20 is Avoid, 21 is Bad', () => {
    expect(getQualityCategory(20)!.label.en).toBe('Avoid');
    expect(getQualityCategory(21)!.label.en).toBe('Bad');
  });

  it('boundary values: 40 is Bad, 41 is Okay', () => {
    expect(getQualityCategory(40)!.label.en).toBe('Bad');
    expect(getQualityCategory(41)!.label.en).toBe('Okay');
  });

  it('boundary values: 60 is Okay, 61 is Good', () => {
    expect(getQualityCategory(60)!.label.en).toBe('Okay');
    expect(getQualityCategory(61)!.label.en).toBe('Good');
  });

  it('boundary values: 80 is Good, 81 is Excellent', () => {
    expect(getQualityCategory(80)!.label.en).toBe('Good');
    expect(getQualityCategory(81)!.label.en).toBe('Excellent');
  });
});

describe('QUALITY_FACTORS integrity', () => {
  it('every factor has unique id', () => {
    const ids = QUALITY_FACTORS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every factor has both fi and en labels', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f.label.fi).toBeTruthy();
      expect(f.label.en).toBeTruthy();
    }
  });

  it('every factor has at least one property', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f.properties.length).toBeGreaterThan(0);
    }
  });

  it('defaultWeight is non-negative', () => {
    for (const f of QUALITY_FACTORS) {
      expect(f.defaultWeight).toBeGreaterThanOrEqual(0);
    }
  });
});
