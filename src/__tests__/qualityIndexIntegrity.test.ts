import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  getQualityCategory,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

describe('quality index — weight normalization with partial data', () => {
  it('reweights correctly when a feature is missing one factor', () => {
    // Feature A has all factors, Feature B missing crime_index
    const featureA = makeFeature({
      crime_index: 50, hr_mtu: 40000, unemployment_rate: 5,
      higher_education_rate: 60, transit_stop_density: 20,
      healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 2,
      air_quality_index: 25,
    });
    const featureB = makeFeature({
      pno: '00200',
      crime_index: null, hr_mtu: 40000, unemployment_rate: 5,
      higher_education_rate: 60, transit_stop_density: 20,
      healthcare_density: 5, school_density: 3, daycare_density: 4, grocery_density: 2,
      air_quality_index: 25,
    });

    computeQualityIndices([featureA, featureB]);
    const qiA = (featureA.properties as NeighborhoodProperties).quality_index;
    const qiB = (featureB.properties as NeighborhoodProperties).quality_index;

    // Both should get valid scores, not null
    expect(qiA).toBeTypeOf('number');
    expect(qiB).toBeTypeOf('number');
    // B's score is reweighted from remaining factors, should still be 0-100
    expect(qiB).toBeGreaterThanOrEqual(0);
    expect(qiB).toBeLessThanOrEqual(100);
  });

  it('produces null when ALL weighted factors are missing', () => {
    const feature = makeFeature({
      crime_index: null, hr_mtu: null, unemployment_rate: null,
      higher_education_rate: null, transit_stop_density: null,
      healthcare_density: null, school_density: null, daycare_density: null, grocery_density: null,
      air_quality_index: null,
    });
    computeQualityIndices([feature]);
    expect((feature.properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('handles NaN values in properties without crashing', () => {
    const features = [
      makeFeature({ crime_index: NaN, hr_mtu: 30000, unemployment_rate: 8 }),
      makeFeature({ pno: '00200', crime_index: 50, hr_mtu: 40000, unemployment_rate: 4 }),
    ];
    computeQualityIndices(features);
    // NaN crime_index should be treated as missing, not corrupt the score
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBeTypeOf('number');
    expect(Number.isNaN(qi)).toBe(false);
  });

  it('Infinity in properties is treated as missing', () => {
    const features = [
      makeFeature({ crime_index: Infinity, hr_mtu: 30000, unemployment_rate: 5 }),
      makeFeature({ pno: '00200', crime_index: 50, hr_mtu: 35000, unemployment_rate: 6 }),
    ];
    computeQualityIndices(features);
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBeTypeOf('number');
    expect(Number.isFinite(qi)).toBe(true);
  });
});

describe('quality index — custom weight edge cases', () => {
  it('single factor at weight 100, all others 0 → score based on that factor only', () => {
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 100;

    const low = makeFeature({ hr_mtu: 15000 });
    const high = makeFeature({ pno: '00200', hr_mtu: 55000 });
    computeQualityIndices([low, high], weights);

    const qiLow = (low.properties as NeighborhoodProperties).quality_index!;
    const qiHigh = (high.properties as NeighborhoodProperties).quality_index!;
    expect(qiLow).toBe(0);
    expect(qiHigh).toBe(100);
  });

  it('inverted factor: lowest crime → highest score', () => {
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['safety'] = 100;

    const safest = makeFeature({ crime_index: 10 });
    const riskiest = makeFeature({ pno: '00200', crime_index: 200 });
    computeQualityIndices([safest, riskiest], weights);

    const qiSafe = (safest.properties as NeighborhoodProperties).quality_index!;
    const qiRisky = (riskiest.properties as NeighborhoodProperties).quality_index!;
    expect(qiSafe).toBe(100); // lowest crime → highest score (inverted)
    expect(qiRisky).toBe(0);
  });

  it('two factors with equal weight produce averaged score', () => {
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['income'] = 50;
    weights['employment'] = 50; // inverted (unemployment)

    // Best income, worst unemployment
    const mixed = makeFeature({ hr_mtu: 50000, unemployment_rate: 15 });
    // Worst income, best unemployment
    const mixedOpposite = makeFeature({ pno: '00200', hr_mtu: 20000, unemployment_rate: 2 });
    computeQualityIndices([mixed, mixedOpposite], weights);

    const qi1 = (mixed.properties as NeighborhoodProperties).quality_index!;
    const qi2 = (mixedOpposite.properties as NeighborhoodProperties).quality_index!;
    // Both should be around 50 since one factor is 100 and the other is 0
    expect(qi1).toBe(50);
    expect(qi2).toBe(50);
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

  it('returns false for empty object (falls back to defaults)', () => {
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a secondary factor gets non-zero weight', () => {
    const w = getDefaultWeights();
    w.cycling = 10;
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('getQualityCategory boundary precision', () => {
  it('returns correct category at exact boundaries', () => {
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

  it('returns null for values outside 0–100 range', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('handles fractional values (quality_index is always rounded to integer)', () => {
    // Categories use continuous boundaries — no gaps between them
    // 20.5 is > 20 (Bad min) and <= 40 (Bad max), so it falls in Bad
    expect(getQualityCategory(20.5)!.label.en).toBe('Bad');
  });
});
