import { describe, it, expect } from 'vitest';
import { computeQualityIndices, getQualityCategory, QUALITY_CATEGORIES } from '../utils/qualityIndex';
import type { Feature } from 'geojson';

function makeFeature(props: Record<string, any>): Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  };
}

describe('computeQualityIndices', () => {
  it('assigns quality_index to each feature based on weighted normalized scores', () => {
    const features = [
      makeFeature({ hr_mtu: 20000, unemployment_rate: 5, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 40000, unemployment_rate: 15, higher_education_rate: 70 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];

    computeQualityIndices(features);

    // Feature with highest income, lowest unemployment, highest education → highest index
    expect(features[1].properties!.quality_index).toBeGreaterThan(features[2].properties!.quality_index);
    // Feature with lowest income, highest unemployment, lowest education → lowest index
    expect(features[0].properties!.quality_index).toBeLessThan(features[2].properties!.quality_index);
    // All indices between 0 and 100
    for (const f of features) {
      expect(f.properties!.quality_index).toBeGreaterThanOrEqual(0);
      expect(f.properties!.quality_index).toBeLessThanOrEqual(100);
    }
  });

  it('computes exact values for two-feature min/max scenario', () => {
    const features = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 0, higher_education_rate: 0 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 100 }),
    ];

    computeQualityIndices(features);

    // Feature 0: income=0(min), unemployment=100(inverted, lowest=best), education=0(min)
    // income: normalize(10000, {10000,50000}) = 0, weighted = 0 * 0.35
    // unemployment: 100 - normalize(0, {0,20}) = 100 - 0 = 100, weighted = 100 * 0.35
    // education: normalize(0, {0,100}) = 0, weighted = 0 * 0.30
    // total = (0*0.35 + 100*0.35 + 0*0.30) / 1.0 = 35
    expect(features[0].properties!.quality_index).toBe(35);

    // Feature 1: income=100(max), unemployment=100-100=0(worst), education=100(max)
    // total = (100*0.35 + 0*0.35 + 100*0.30) / 1.0 = 65
    expect(features[1].properties!.quality_index).toBe(65);
  });

  it('sets quality_index to null when all metrics are missing', () => {
    const features = [makeFeature({ hr_mtu: null, unemployment_rate: null, higher_education_rate: null })];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('handles partial data by reweighting available scores', () => {
    // Only income available — should still compute
    const features = [
      makeFeature({ hr_mtu: 20000, unemployment_rate: null, higher_education_rate: null }),
      makeFeature({ hr_mtu: 40000, unemployment_rate: null, higher_education_rate: null }),
    ];
    computeQualityIndices(features);

    // min income → 0, max income → 100
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
  });

  it('returns 50 when all features have the same metric values', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    computeQualityIndices(features);
    // normalize returns 50 when min===max
    expect(features[0].properties!.quality_index).toBe(50);
    expect(features[1].properties!.quality_index).toBe(50);
  });

  it('treats hr_mtu of 0 as missing', () => {
    const features = [
      makeFeature({ hr_mtu: 0, unemployment_rate: 5, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    computeQualityIndices(features);
    // Feature 0 has no income data, so quality_index computed from unemployment + education only
    expect(features[0].properties!.quality_index).not.toBeNull();
  });
});

describe('getQualityCategory', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('returns correct category for each range boundary', () => {
    expect(getQualityCategory(0)!.label.en).toBe('Avoid');
    expect(getQualityCategory(20)!.label.en).toBe('Avoid');
    expect(getQualityCategory(21)!.label.en).toBe('Bad');
    expect(getQualityCategory(40)!.label.en).toBe('Bad');
    expect(getQualityCategory(41)!.label.en).toBe('Okay');
    expect(getQualityCategory(60)!.label.en).toBe('Okay');
    expect(getQualityCategory(61)!.label.en).toBe('Good');
    expect(getQualityCategory(80)!.label.en).toBe('Good');
    expect(getQualityCategory(81)!.label.en).toBe('Peaceful');
    expect(getQualityCategory(100)!.label.en).toBe('Peaceful');
  });

  it('returns correct colors', () => {
    expect(getQualityCategory(10)!.color).toBe('#a855f7');
    expect(getQualityCategory(90)!.color).toBe('#22c55e');
  });
});

describe('QUALITY_CATEGORIES', () => {
  it('covers full 0-100 range with no gaps', () => {
    expect(QUALITY_CATEGORIES[0].min).toBe(0);
    expect(QUALITY_CATEGORIES[QUALITY_CATEGORIES.length - 1].max).toBe(100);
    for (let i = 1; i < QUALITY_CATEGORIES.length; i++) {
      expect(QUALITY_CATEGORIES[i].min).toBe(QUALITY_CATEGORIES[i - 1].max + 1);
    }
  });
});
