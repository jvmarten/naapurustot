/**
 * Tests for quality index computation with custom weights, including zero-weight
 * factors, all-zero weights, and edge cases in the normalization/scoring pipeline.
 *
 * These tests catch bugs that would cause wrong quality scores on the map when
 * users adjust sliders in the CustomQualityPanel.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';

function makeFeature(props: Record<string, unknown>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100',
      nimi: 'Test',
      he_vakiy: 5000,
      ...props,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
    },
  };
}

describe('computeQualityIndices — zero-weight factors', () => {
  it('factors with weight 0 are excluded from the score', () => {
    const features = [
      makeFeature({ hr_mtu: 40000, crime_index: 100 }),
      makeFeature({ hr_mtu: 20000, crime_index: 0 }),
    ];

    const incomeOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) incomeOnly[f.id] = 0;
    incomeOnly['income'] = 100;

    computeQualityIndices(features, incomeOnly);

    const qi0 = features[0].properties!.quality_index as number;
    const qi1 = features[1].properties!.quality_index as number;

    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });

  it('all weights at zero produces null quality index', () => {
    const features = [makeFeature({ hr_mtu: 35000, crime_index: 50 })];

    const zeroWeights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) zeroWeights[f.id] = 0;

    computeQualityIndices(features, zeroWeights);

    expect(features[0].properties!.quality_index).toBeNull();
  });

  it('single factor at non-zero weight produces valid score', () => {
    const features = [
      makeFeature({ transit_stop_density: 50 }),
      makeFeature({ transit_stop_density: 10 }),
    ];

    const transitOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) transitOnly[f.id] = 0;
    transitOnly['transit'] = 50;

    computeQualityIndices(features, transitOnly);

    const qi0 = features[0].properties!.quality_index as number;
    const qi1 = features[1].properties!.quality_index as number;
    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });
});

describe('computeQualityIndices — inverted factors', () => {
  it('crime_index is inverted: lower crime = higher quality', () => {
    const features = [
      makeFeature({ crime_index: 10 }),
      makeFeature({ crime_index: 90 }),
    ];

    const safetyOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) safetyOnly[f.id] = 0;
    safetyOnly['safety'] = 100;

    computeQualityIndices(features, safetyOnly);

    const qiLowCrime = features[0].properties!.quality_index as number;
    const qiHighCrime = features[1].properties!.quality_index as number;
    expect(qiLowCrime).toBeGreaterThan(qiHighCrime);
    expect(qiLowCrime).toBe(100);
    expect(qiHighCrime).toBe(0);
  });

  it('unemployment_rate is inverted: lower unemployment = higher quality', () => {
    const features = [
      makeFeature({ unemployment_rate: 3 }),
      makeFeature({ unemployment_rate: 15 }),
    ];

    const empOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) empOnly[f.id] = 0;
    empOnly['employment'] = 100;

    computeQualityIndices(features, empOnly);

    const qiLow = features[0].properties!.quality_index as number;
    const qiHigh = features[1].properties!.quality_index as number;
    expect(qiLow).toBeGreaterThan(qiHigh);
  });
});

describe('computeQualityIndices — missing data fallback', () => {
  it('uses per-metric average when a feature is missing a property', () => {
    const features = [
      makeFeature({ hr_mtu: 40000 }),
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ hr_mtu: null }),
    ];

    const incomeOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) incomeOnly[f.id] = 0;
    incomeOnly['income'] = 100;

    computeQualityIndices(features, incomeOnly);

    const qiMissing = features[2].properties!.quality_index as number;
    expect(qiMissing).toBe(50);
  });

  it('features where ALL factor data is missing get null quality_index', () => {
    const features = [
      makeFeature({}),
    ];

    const safetyOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) safetyOnly[f.id] = 0;
    safetyOnly['safety'] = 100;

    computeQualityIndices(features, safetyOnly);

    expect(features[0].properties!.quality_index).toBeNull();
  });
});

describe('computeQualityIndices — multi-property factors', () => {
  it('services factor averages across multiple properties', () => {
    const features = [
      makeFeature({
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
      makeFeature({
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 1,
      }),
    ];

    const servicesOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) servicesOnly[f.id] = 0;
    servicesOnly['services'] = 100;

    computeQualityIndices(features, servicesOnly);

    const qi0 = features[0].properties!.quality_index as number;
    const qi1 = features[1].properties!.quality_index as number;
    expect(qi0).toBe(100);
    expect(qi1).toBe(0);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w['safety'] = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false when weights object is empty (nullish coalescing falls back to defaults)', () => {
    const w: QualityWeights = {};
    expect(isCustomWeights(w)).toBe(false);
  });
});

describe('getQualityCategory — boundary values', () => {
  it('maps 0 to Avoid', () => {
    expect(getQualityCategory(0)?.label.en).toBe('Avoid');
  });

  it('maps 20 to Avoid (upper boundary is inclusive for first category)', () => {
    expect(getQualityCategory(20)?.label.en).toBe('Avoid');
  });

  it('maps 20.5 to Bad (half-open intervals: (20, 40])', () => {
    expect(getQualityCategory(20.5)?.label.en).toBe('Bad');
  });

  it('maps 100 to Excellent', () => {
    expect(getQualityCategory(100)?.label.en).toBe('Excellent');
  });

  it('maps 50 to Okay', () => {
    expect(getQualityCategory(50)?.label.en).toBe('Okay');
  });

  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('maps negative value to null (out of range)', () => {
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('maps >100 to null (out of range)', () => {
    expect(getQualityCategory(101)).toBeNull();
  });
});
