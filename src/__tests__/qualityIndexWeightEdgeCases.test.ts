import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

function fullProps(overrides: Record<string, unknown> = {}) {
  return {
    hr_mtu: 30000,
    unemployment_rate: 10,
    higher_education_rate: 40,
    crime_index: 5,
    transit_stop_density: 20,
    healthcare_density: 3,
    school_density: 2,
    daycare_density: 4,
    grocery_density: 5,
    air_quality_index: 2,
    cycling_density: 1,
    restaurant_density: 6,
    ...overrides,
  };
}

describe('quality index — weight edge cases', () => {
  it('handles all weights set to zero → quality_index is null', () => {
    const features = [makeFeature(fullProps())];
    const zeroWeights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) zeroWeights[f.id] = 0;
    computeQualityIndices(features, zeroWeights);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('handles a single factor with weight=100', () => {
    const features = [
      makeFeature(fullProps({ hr_mtu: 10000 })),
      makeFeature(fullProps({ hr_mtu: 50000 })),
    ];
    const w: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.income = 100;
    computeQualityIndices(features, w);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('inverted factor scoring: lower crime → higher score', () => {
    const features = [
      makeFeature(fullProps({ crime_index: 1 })),
      makeFeature(fullProps({ crime_index: 10 })),
    ];
    const w: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.safety = 100;
    computeQualityIndices(features, w);
    expect(features[0].properties!.quality_index).toBe(100);
    expect(features[1].properties!.quality_index).toBe(0);
  });

  it('services factor averages multiple properties', () => {
    const features = [
      makeFeature(fullProps({
        healthcare_density: 0, school_density: 0, daycare_density: 0, grocery_density: 0,
      })),
      makeFeature(fullProps({
        healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10,
      })),
    ];
    const w: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.services = 100;
    computeQualityIndices(features, w);
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('handles NaN metric values gracefully', () => {
    const features = [
      makeFeature(fullProps({ hr_mtu: NaN })),
      makeFeature(fullProps({ hr_mtu: 40000 })),
    ];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).not.toBeNull();
    expect(typeof features[0].properties!.quality_index).toBe('number');
  });

  it('large dataset: all neighborhoods same values → all get 50', () => {
    const features = Array.from({ length: 100 }, () => makeFeature(fullProps()));
    computeQualityIndices(features);
    for (const f of features) {
      expect(f.properties!.quality_index).toBe(50);
    }
  });

  it('single neighborhood dataset → quality_index is 50', () => {
    const features = [makeFeature(fullProps())];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).toBe(50);
  });

  it('isCustomWeights treats missing keys as default', () => {
    expect(isCustomWeights({})).toBe(false);
  });

  it('default weights sum to a reasonable total', () => {
    const defaults = getDefaultWeights();
    const total = Object.values(defaults).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(200);
  });
});

describe('getQualityCategory — boundary precision', () => {
  it('handles fractional values at boundaries', () => {
    expect(getQualityCategory(20.5)?.label.en).toBe('Bad');
    expect(getQualityCategory(40.1)?.label.en).toBe('Okay');
    expect(getQualityCategory(60.01)?.label.en).toBe('Good');
    expect(getQualityCategory(80.001)?.label.en).toBe('Excellent');
  });

  it('returns null for out-of-range values', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('every integer 0-100 maps to exactly one category', () => {
    for (let i = 0; i <= 100; i++) {
      expect(getQualityCategory(i)).not.toBeNull();
    }
  });
});
