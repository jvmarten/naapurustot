/**
 * Quality Index — normalization, scoring, and category boundary tests.
 *
 * Priority 1: Core business logic. A bug here causes neighborhoods
 * to show incorrect quality scores across the entire map.
 *
 * Targets untested paths:
 * - normalize() with max===min edge case
 * - normalize() clamping to [0,100]
 * - getFactorScore() with multi-property factors (services)
 * - getFactorScore() with partial missing data across properties
 * - computeQualityIndices() cache invalidation on dataset change
 * - getQualityCategory() exact boundary values (0, 20, 40, 60, 80, 100)
 */
import { describe, it, expect } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';
import {
  computeQualityIndices,
  getQualityCategory,
  getDefaultWeights,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: null, city: null, he_vakiy: 1000, ...props },
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

describe('Quality Index — normalization edge cases', () => {
  it('assigns 50 when all features have identical values for a factor', () => {
    const features = [
      makeFeature({ hr_mtu: 30000, crime_index: 50 }),
      makeFeature({ pno: '00200', hr_mtu: 30000, crime_index: 50 }),
      makeFeature({ pno: '00300', hr_mtu: 30000, crime_index: 50 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    for (const f of features) {
      expect((f.properties as NeighborhoodProperties).quality_index).toBe(50);
    }
  });

  it('produces distinct scores when features have varied values', () => {
    const features = [
      makeFeature({ hr_mtu: 20000, crime_index: 100 }),
      makeFeature({ pno: '00200', hr_mtu: 40000, crime_index: 30 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.safety = 50;

    computeQualityIndices(features, weights);

    const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index!);
    expect(scores[0]).toBeLessThan(scores[1]);
    expect(scores[0]).toBeGreaterThanOrEqual(0);
    expect(scores[1]).toBeLessThanOrEqual(100);
  });

  it('clamps normalized values to [0, 100] range', () => {
    const features = [
      makeFeature({ hr_mtu: 10000 }),
      makeFeature({ pno: '00200', hr_mtu: 50000 }),
      makeFeature({ pno: '00300', hr_mtu: 80000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index!;
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }
  });
});

describe('Quality Index — multi-property factor (services)', () => {
  it('averages scores across all 4 service properties', () => {
    const features = [
      makeFeature({
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 1,
      }),
      makeFeature({
        pno: '00200',
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    const low = (features[0].properties as NeighborhoodProperties).quality_index!;
    const high = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(low).toBe(0);
    expect(high).toBe(100);
  });

  it('handles partial service data — uses available properties only', () => {
    const features = [
      makeFeature({ healthcare_density: 1, school_density: null, daycare_density: null, grocery_density: null }),
      makeFeature({ pno: '00200', healthcare_density: 10, school_density: null, daycare_density: null, grocery_density: null }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    const low = (features[0].properties as NeighborhoodProperties).quality_index!;
    const high = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(low).toBe(0);
    expect(high).toBe(100);
  });
});

describe('Quality Index — inverted factors', () => {
  it('inverts crime_index: lower raw = higher quality score', () => {
    const features = [
      makeFeature({ crime_index: 20 }),
      makeFeature({ pno: '00200', crime_index: 150 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);

    const safe = (features[0].properties as NeighborhoodProperties).quality_index!;
    const unsafe = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(safe).toBe(100);
    expect(unsafe).toBe(0);
  });

  it('inverts air_quality_index: lower raw = higher quality score', () => {
    const features = [
      makeFeature({ air_quality_index: 20 }),
      makeFeature({ pno: '00200', air_quality_index: 45 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.air_quality = 100;

    computeQualityIndices(features, weights);

    const clean = (features[0].properties as NeighborhoodProperties).quality_index!;
    const dirty = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(clean).toBe(100);
    expect(dirty).toBe(0);
  });
});

describe('Quality Index — income special case (hr_mtu <= 0 excluded)', () => {
  it('excludes neighborhoods with hr_mtu=0 from range calculation', () => {
    const features = [
      makeFeature({ hr_mtu: 0 }),
      makeFeature({ pno: '00200', hr_mtu: 25000 }),
      makeFeature({ pno: '00300', hr_mtu: 50000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    const zeroIncome = (features[0].properties as NeighborhoodProperties).quality_index;
    const lowIncome = (features[1].properties as NeighborhoodProperties).quality_index!;
    const highIncome = (features[2].properties as NeighborhoodProperties).quality_index!;
    expect(lowIncome).toBe(0);
    expect(highIncome).toBe(100);
    expect(zeroIncome).not.toBeNull();
  });
});

describe('Quality Index — cache invalidation', () => {
  it('recomputes when called with different feature array reference', () => {
    const featuresA = [
      makeFeature({ hr_mtu: 20000 }),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
    ];
    const featuresB = [
      makeFeature({ hr_mtu: 30000 }),
      makeFeature({ pno: '00200', hr_mtu: 60000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(featuresA, weights);
    const scoreA = (featuresA[0].properties as NeighborhoodProperties).quality_index!;

    computeQualityIndices(featuresB, weights);
    const scoreB = (featuresB[0].properties as NeighborhoodProperties).quality_index!;

    expect(scoreA).toBe(0);
    expect(scoreB).toBe(0);
  });
});

describe('getQualityCategory — boundary precision', () => {
  it('maps 0 to "Avoid" category', () => {
    expect(getQualityCategory(0)?.label.en).toBe('Avoid');
  });

  it('maps 20 to "Avoid" (inclusive upper bound for first category)', () => {
    expect(getQualityCategory(20)?.label.en).toBe('Avoid');
  });

  it('maps 20.5 to "Bad" (half-open interval)', () => {
    expect(getQualityCategory(20.5)?.label.en).toBe('Bad');
  });

  it('maps 40 to "Bad"', () => {
    expect(getQualityCategory(40)?.label.en).toBe('Bad');
  });

  it('maps 60 to "Okay"', () => {
    expect(getQualityCategory(60)?.label.en).toBe('Okay');
  });

  it('maps 80 to "Good"', () => {
    expect(getQualityCategory(80)?.label.en).toBe('Good');
  });

  it('maps 100 to "Excellent"', () => {
    expect(getQualityCategory(100)?.label.en).toBe('Excellent');
  });

  it('returns null for values below 0', () => {
    expect(getQualityCategory(-1)).toBeNull();
  });

  it('returns null for values above 100', () => {
    expect(getQualityCategory(101)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('no gap between categories — every integer 0..100 maps to a category', () => {
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      expect(cat, `No category for score ${i}`).not.toBeNull();
    }
  });

  it('no gap for fractional values between categories', () => {
    for (const v of [0.1, 19.9, 20.1, 39.9, 40.1, 59.9, 60.1, 79.9, 80.1, 99.9]) {
      const cat = getQualityCategory(v);
      expect(cat, `No category for score ${v}`).not.toBeNull();
    }
  });
});

describe('getDefaultWeights', () => {
  it('weights sum is consistent across invocations', () => {
    const w1 = getDefaultWeights();
    const w2 = getDefaultWeights();
    const sum1 = Object.values(w1).reduce((a, b) => a + b, 0);
    const sum2 = Object.values(w2).reduce((a, b) => a + b, 0);
    expect(sum1).toBe(sum2);
    expect(sum1).toBeGreaterThan(0);
  });

  it('returns a fresh object each time (not shared mutable state)', () => {
    const w1 = getDefaultWeights();
    const w2 = getDefaultWeights();
    expect(w1).not.toBe(w2);
    w1.income = 999;
    expect(w2.income).toBe(20);
  });
});
