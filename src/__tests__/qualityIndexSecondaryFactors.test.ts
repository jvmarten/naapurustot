/**
 * Tests for qualityIndex secondary factor activation.
 *
 * Secondary factors (cycling, grocery_access, restaurants) have defaultWeight=0
 * and are hidden by default. Users can activate them via "Show more" sliders.
 * These tests verify:
 * 1. Secondary factors with weight 0 are excluded from computation
 * 2. Secondary factors with weight > 0 are included and affect scores
 * 3. Mixed primary + secondary weights rebalance correctly
 * 4. isCustomWeights correctly detects secondary factor activation
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  type QualityWeights,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props } as NeighborhoodProperties,
  };
}

function getQI(f: GeoJSON.Feature): number | null {
  return (f.properties as NeighborhoodProperties).quality_index;
}

describe('secondary factors — activation and computation', () => {
  it('secondary factors with default weight 0 do not affect scores', () => {
    const a = makeFeature({ pno: '00100', hr_mtu: 40000, cycling_density: 100 });
    const b = makeFeature({ pno: '00200', hr_mtu: 40000, cycling_density: 0 });
    const features = [a, b];

    // With default weights, cycling (secondary) should be ignored
    computeQualityIndices(features, getDefaultWeights());
    // Both should have equal scores since cycling is excluded
    expect(getQI(a)).toBe(getQI(b));
  });

  it('activating cycling factor changes scores for neighborhoods with different cycling density', () => {
    const a = makeFeature({ pno: '00100', cycling_density: 100 });
    const b = makeFeature({ pno: '00200', cycling_density: 1 });
    const features = [a, b];

    // Only enable cycling
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.cycling = 50;

    computeQualityIndices(features, weights);
    // High cycling density → high score
    expect(getQI(a)).toBe(100);
    expect(getQI(b)).toBe(0);
  });

  it('activating restaurant factor differentiates neighborhoods', () => {
    const a = makeFeature({ pno: '00100', restaurant_density: 50 });
    const b = makeFeature({ pno: '00200', restaurant_density: 5 });
    const features = [a, b];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.restaurants = 30;

    computeQualityIndices(features, weights);
    expect(getQI(a)).toBeGreaterThan(getQI(b)!);
    expect(getQI(a)).toBe(100);
    expect(getQI(b)).toBe(0);
  });

  it('activating grocery_access factor differentiates neighborhoods', () => {
    const a = makeFeature({ pno: '00100', grocery_density: 20 });
    const b = makeFeature({ pno: '00200', grocery_density: 2 });
    const features = [a, b];

    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.grocery_access = 40;

    computeQualityIndices(features, weights);
    expect(getQI(a)).toBe(100);
    expect(getQI(b)).toBe(0);
  });
});

describe('secondary factors — mixed with primary factors', () => {
  it('adding secondary factor rebalances total weight correctly', () => {
    // Two neighborhoods: A is better on income, B is better on cycling
    const a = makeFeature({ pno: '00100', hr_mtu: 60000, cycling_density: 1 });
    const b = makeFeature({ pno: '00200', hr_mtu: 20000, cycling_density: 100 });
    const features = [a, b];

    // Only income: A wins
    const incomeOnly: QualityWeights = {};
    for (const f of QUALITY_FACTORS) incomeOnly[f.id] = 0;
    incomeOnly.income = 100;

    computeQualityIndices(features, incomeOnly);
    expect(getQI(a)).toBe(100);
    expect(getQI(b)).toBe(0);

    // Equal weight income + cycling: scores should be 50/50 for both
    const mixed: QualityWeights = {};
    for (const f of QUALITY_FACTORS) mixed[f.id] = 0;
    mixed.income = 50;
    mixed.cycling = 50;

    computeQualityIndices(features, mixed);
    // A: income=100, cycling=0 → weighted = (100*50 + 0*50)/(50+50) = 50
    // B: income=0, cycling=100 → weighted = (0*50 + 100*50)/(50+50) = 50
    expect(getQI(a)).toBe(50);
    expect(getQI(b)).toBe(50);
  });

  it('heavily weighted secondary factor dominates score', () => {
    const a = makeFeature({ pno: '00100', hr_mtu: 60000, cycling_density: 1 });
    const b = makeFeature({ pno: '00200', hr_mtu: 20000, cycling_density: 100 });
    const features = [a, b];

    // Cycling weight 90, income weight 10
    const weights: QualityWeights = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights.income = 10;
    weights.cycling = 90;

    computeQualityIndices(features, weights);
    // B should win because cycling dominates
    expect(getQI(b)).toBeGreaterThan(getQI(a)!);
    // A: (100*10 + 0*90)/100 = 10
    expect(getQI(a)).toBe(10);
    // B: (0*10 + 100*90)/100 = 90
    expect(getQI(b)).toBe(90);
  });
});

describe('isCustomWeights — secondary factor detection', () => {
  it('default weights are not custom', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('activating a secondary factor is detected as custom', () => {
    const w = getDefaultWeights();
    w.cycling = 10;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('activating grocery_access is detected as custom', () => {
    const w = getDefaultWeights();
    w.grocery_access = 5;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('activating restaurants is detected as custom', () => {
    const w = getDefaultWeights();
    w.restaurants = 1;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('changing a primary factor weight is detected as custom', () => {
    const w = getDefaultWeights();
    w.safety = 50; // default is 25
    expect(isCustomWeights(w)).toBe(true);
  });

  it('setting primary factor to 0 is detected as custom', () => {
    const w = getDefaultWeights();
    w.income = 0;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('missing factor key uses default (not custom)', () => {
    // Partial weights object — missing keys should fall back to defaults
    const w: QualityWeights = {};
    expect(isCustomWeights(w)).toBe(false);
  });
});
