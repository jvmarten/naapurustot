/**
 * Critical tests for qualityIndex.ts — focuses on edge cases that would
 * cause the worst user-facing bugs if broken.
 */
import { describe, it, expect } from 'vitest';
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

/** Build a minimal GeoJSON feature with specified properties. */
function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
  };
}

describe('computeQualityIndices — critical edge cases', () => {
  it('inverted metrics: higher crime should yield lower quality score', () => {
    const low = makeFeature({ pno: '00100', crime_index: 1 });
    const high = makeFeature({ pno: '00200', crime_index: 100 });
    const features = [low, high];

    // Use only safety weight (crime_index, inverted)
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.safety = 100;

    computeQualityIndices(features, weights);

    const lowScore = (low.properties as NeighborhoodProperties).quality_index;
    const highScore = (high.properties as NeighborhoodProperties).quality_index;

    // Low crime → high quality; high crime → low quality
    expect(lowScore).toBeGreaterThan(highScore!);
    expect(lowScore).toBe(100); // normalized to top
    expect(highScore).toBe(0); // normalized to bottom
  });

  it('non-inverted metrics: higher income should yield higher quality score', () => {
    const low = makeFeature({ pno: '00100', hr_mtu: 20000 });
    const high = makeFeature({ pno: '00200', hr_mtu: 60000 });
    const features = [low, high];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    const lowScore = (low.properties as NeighborhoodProperties).quality_index;
    const highScore = (high.properties as NeighborhoodProperties).quality_index;

    expect(highScore).toBeGreaterThan(lowScore!);
    expect(highScore).toBe(100);
    expect(lowScore).toBe(0);
  });

  it('hr_mtu <= 0 is excluded from range computation (treated as missing)', () => {
    const zero = makeFeature({ pno: '00100', hr_mtu: 0 });
    const valid1 = makeFeature({ pno: '00200', hr_mtu: 30000 });
    const valid2 = makeFeature({ pno: '00300', hr_mtu: 50000 });
    const features = [zero, valid1, valid2];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(features, weights);

    // Zero-income feature falls back to metro average ((30000+50000)/2=40000) → normalized to 50
    expect((zero.properties as NeighborhoodProperties).quality_index).toBe(50);
    // Valid features should have scores
    expect((valid1.properties as NeighborhoodProperties).quality_index).toBe(0);
    expect((valid2.properties as NeighborhoodProperties).quality_index).toBe(100);
  });

  it('multi-property factor (services) averages sub-scores correctly', () => {
    // Services factor uses: healthcare_density, school_density, daycare_density, grocery_density
    const a = makeFeature({
      pno: '00100',
      healthcare_density: 10,
      school_density: 10,
      daycare_density: 10,
      grocery_density: 10,
    });
    const b = makeFeature({
      pno: '00200',
      healthcare_density: 0,
      school_density: 0,
      daycare_density: 0,
      grocery_density: 0,
    });
    const features = [a, b];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.services = 100;

    computeQualityIndices(features, weights);

    expect((a.properties as NeighborhoodProperties).quality_index).toBe(100);
    expect((b.properties as NeighborhoodProperties).quality_index).toBe(0);
  });

  it('partial data: feature missing some factor properties still gets a score', () => {
    // Feature with income but no crime data
    const a = makeFeature({ pno: '00100', hr_mtu: 50000 });
    const b = makeFeature({ pno: '00200', hr_mtu: 30000, crime_index: 5 });
    const features = [a, b];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.safety = 50;

    computeQualityIndices(features, weights);

    // Feature a: income=100 (max), safety falls back to metro avg (crime_index=5, range {5,5}) → 50
    // quality_index = (100*50 + 50*50) / 100 = 75
    const scoreA = (a.properties as NeighborhoodProperties).quality_index;
    expect(scoreA).not.toBeNull();
    expect(scoreA).toBe(75);
  });

  it('all features missing data for a factor → factor is skipped', () => {
    const a = makeFeature({ pno: '00100', hr_mtu: 40000 });
    const b = makeFeature({ pno: '00200', hr_mtu: 20000 });
    // Neither has crime_index

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 50;
    weights.safety = 50;

    const features = [a, b];
    computeQualityIndices(features, weights);
    expect((a.properties as NeighborhoodProperties).quality_index).toBe(100);
    expect((b.properties as NeighborhoodProperties).quality_index).toBe(0);
  });

  it('range cache invalidation: new dataset reference recomputes ranges', () => {
    const dataset1 = [
      makeFeature({ pno: '00100', hr_mtu: 20000 }),
      makeFeature({ pno: '00200', hr_mtu: 40000 }),
    ];
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices(dataset1, weights);
    expect((dataset1[0].properties as NeighborhoodProperties).quality_index).toBe(0);

    // New dataset with different range
    const dataset2 = [
      makeFeature({ pno: '00100', hr_mtu: 20000 }),
      makeFeature({ pno: '00200', hr_mtu: 80000 }),
    ];

    computeQualityIndices(dataset2, weights);
    // 20000 should still normalize to 0 (min of new dataset)
    expect((dataset2[0].properties as NeighborhoodProperties).quality_index).toBe(0);
    // 80000 should normalize to 100 (max of new dataset)
    expect((dataset2[1].properties as NeighborhoodProperties).quality_index).toBe(100);
  });

  it('same dataset reference with different weights reuses cached ranges', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 30000, crime_index: 10 }),
      makeFeature({ pno: '00200', hr_mtu: 50000, crime_index: 50 }),
    ];

    // First call with income only
    const w1: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w1[f.id] = 0;
    w1.income = 100;
    computeQualityIndices(features, w1);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBe(0);

    // Second call with safety only — should still work correctly
    const w2: QualityWeights = {};
    for (const f of QUALITY_FACTORS) w2[f.id] = 0;
    w2.safety = 100;
    computeQualityIndices(features, w2);
    // Lower crime → higher score (inverted)
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBe(100);
    expect((features[1].properties as NeighborhoodProperties).quality_index).toBe(0);
  });

  it('single feature gets score of 50 (min==max → normalize returns 50)', () => {
    const single = makeFeature({ pno: '00100', hr_mtu: 40000 });
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 100;

    computeQualityIndices([single], weights);
    expect((single.properties as NeighborhoodProperties).quality_index).toBe(50);
  });
});

describe('getQualityCategory — boundary values', () => {
  it('maps exact boundary values to correct categories', () => {
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

  it('returns null for values outside 0-100 range', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });

  it('every integer 0-100 maps to exactly one category', () => {
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      expect(cat).not.toBeNull();
    }
  });

  it('categories have no gaps (contiguous coverage from 0 to 100)', () => {
    const sorted = [...QUALITY_CATEGORIES].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    expect(sorted[sorted.length - 1].max).toBe(100);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max);
    }
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w.safety = 50; // default is 25
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns true when a default-0 weight is set to non-zero', () => {
    const w = getDefaultWeights();
    w.cycling = 10; // default is 0
    expect(isCustomWeights(w)).toBe(true);
  });

  it('treats missing keys as default (undefined falls back to defaultWeight)', () => {
    // Empty object: all keys missing → treated as defaults
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('getDefaultWeights', () => {
  it('sums primary weights to 95 (not 100, leaving room for secondary)', () => {
    const w = getDefaultWeights();
    const primarySum = QUALITY_FACTORS
      .filter((f) => f.primary)
      .reduce((sum, f) => sum + w[f.id], 0);
    expect(primarySum).toBe(95);
  });

  it('secondary factors have zero default weight', () => {
    const w = getDefaultWeights();
    const secondary = QUALITY_FACTORS.filter((f) => !f.primary);
    for (const f of secondary) {
      expect(w[f.id]).toBe(0);
    }
  });
});
