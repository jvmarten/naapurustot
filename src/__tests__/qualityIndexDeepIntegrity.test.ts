/**
 * Deep integrity tests for qualityIndex.ts — the most user-visible computed metric.
 *
 * Covers: weight normalization, factor inversion correctness, missing data fallback,
 * custom weights edge cases, and category boundary classification.
 */
import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100',
      nimi: 'Test',
      namn: 'Test',
      he_vakiy: 5000,
      hr_mtu: 30000,
      unemployment_rate: 7,
      higher_education_rate: 40,
      crime_index: 50,
      transit_stop_density: 30,
      air_quality_index: 25,
      healthcare_density: 3,
      school_density: 2,
      daycare_density: 4,
      grocery_density: 5,
      cycling_density: 20,
      restaurant_density: 10,
      quality_index: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
  };
}

describe('getDefaultWeights — structural integrity', () => {
  it('primary factor weights sum to 95', () => {
    const primary = QUALITY_FACTORS.filter(f => f.primary);
    const sum = primary.reduce((acc, f) => acc + f.defaultWeight, 0);
    expect(sum).toBe(95);
  });

  it('secondary factor default weights are all 0', () => {
    const secondary = QUALITY_FACTORS.filter(f => !f.primary);
    for (const f of secondary) {
      expect(f.defaultWeight).toBe(0);
    }
  });
});

describe('isCustomWeights — edge cases', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs', () => {
    const w = getDefaultWeights();
    w.safety = 50;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns true when a secondary factor is activated', () => {
    const w = getDefaultWeights();
    w.cycling = 10;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('handles missing keys (falls back to defaultWeight)', () => {
    expect(isCustomWeights({})).toBe(false);
  });
});

describe('computeQualityIndices — factor inversion', () => {
  it('inverted factors: lower raw values → higher quality score', () => {
    const features = [
      makeFeature({ pno: '00100', crime_index: 10 }),
      makeFeature({ pno: '00200', crime_index: 100 }),
    ];

    const w: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.safety = 100;

    computeQualityIndices(features, w);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;

    expect(qi1).toBeGreaterThan(qi2);
    expect(qi1).toBe(100);
    expect(qi2).toBe(0);
  });

  it('non-inverted factors: higher raw values → higher quality score', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 50000 }),
      makeFeature({ pno: '00200', hr_mtu: 20000 }),
    ];

    const w: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.income = 100;

    computeQualityIndices(features, w);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;

    expect(qi1).toBe(100);
    expect(qi2).toBe(0);
  });
});

describe('computeQualityIndices — missing data handling', () => {
  it('uses metro average as fallback for missing values', () => {
    const features = [
      makeFeature({ pno: '00100', crime_index: 30 }),
      makeFeature({ pno: '00200', crime_index: 60 }),
      makeFeature({ pno: '00300', crime_index: null }),
    ];

    const w: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.safety = 100;

    computeQualityIndices(features, w);

    const qi = (features[2].properties as NeighborhoodProperties).quality_index;
    expect(qi).not.toBeNull();
    expect(qi!).toBeGreaterThan(0);
    expect(qi!).toBeLessThan(100);
  });

  it('all features get score 50 when values are identical', () => {
    const features = [
      makeFeature({ pno: '00100' }),
      makeFeature({ pno: '00200' }),
      makeFeature({ pno: '00300' }),
    ];

    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).toBe(50);
    }
  });
});

describe('computeQualityIndices — services factor averages multiple properties', () => {
  it('services factor averages 4 sub-metrics correctly', () => {
    const features = [
      makeFeature({
        pno: '00100',
        healthcare_density: 10,
        school_density: 10,
        daycare_density: 10,
        grocery_density: 10,
      }),
      makeFeature({
        pno: '00200',
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 1,
      }),
    ];

    const w: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.services = 100;

    computeQualityIndices(features, w);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;

    expect(qi1).toBe(100);
    expect(qi2).toBe(0);
  });
});

describe('computeQualityIndices — zero-weight factors', () => {
  it('factors with weight 0 do not affect score', () => {
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 50000, crime_index: 100 }),
      makeFeature({ pno: '00200', hr_mtu: 20000, crime_index: 10 }),
    ];

    const w: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) w[f.id] = 0;
    w.income = 100;

    computeQualityIndices(features, w);

    const qi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi1).toBeGreaterThan(qi2);
  });
});

describe('computeQualityIndices — weighted combination', () => {
  it('different weights produce different rankings', () => {
    // Neighborhood A: high income, high crime
    // Neighborhood B: low income, low crime
    const features = [
      makeFeature({ pno: '00100', hr_mtu: 60000, crime_index: 100 }),
      makeFeature({ pno: '00200', hr_mtu: 20000, crime_index: 10 }),
    ];

    // Income-heavy weights
    const wIncome: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) wIncome[f.id] = 0;
    wIncome.income = 80;
    wIncome.safety = 20;

    computeQualityIndices(features, wIncome);
    const incomeQi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const incomeQi2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    // A should win: high income outweighs safety
    expect(incomeQi1).toBeGreaterThan(incomeQi2);

    // Safety-heavy weights
    const wSafety: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) wSafety[f.id] = 0;
    wSafety.income = 20;
    wSafety.safety = 80;

    computeQualityIndices(features, wSafety);
    const safetyQi1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const safetyQi2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    // B should win: low crime outweighs low income
    expect(safetyQi2).toBeGreaterThan(safetyQi1);
  });
});

describe('QUALITY_CATEGORIES — full range coverage', () => {
  it('covers 0-100 without gaps or overlaps', () => {
    const sorted = [...QUALITY_CATEGORIES].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    expect(sorted[sorted.length - 1].max).toBe(100);

    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max);
    }
  });

  it('each category has valid color hex', () => {
    for (const cat of QUALITY_CATEGORIES) {
      expect(cat.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('getQualityCategory — boundary values', () => {
  it('returns correct category at each boundary', () => {
    expect(getQualityCategory(0)!.label.en).toBe('Avoid');
    expect(getQualityCategory(20)!.label.en).toBe('Avoid');
    expect(getQualityCategory(21)!.label.en).toBe('Bad');
    expect(getQualityCategory(40)!.label.en).toBe('Bad');
    expect(getQualityCategory(41)!.label.en).toBe('Okay');
    expect(getQualityCategory(60)!.label.en).toBe('Okay');
    expect(getQualityCategory(61)!.label.en).toBe('Good');
    expect(getQualityCategory(80)!.label.en).toBe('Good');
    expect(getQualityCategory(81)!.label.en).toBe('Excellent');
    expect(getQualityCategory(100)!.label.en).toBe('Excellent');
  });

  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('returns null for out-of-range values', () => {
    expect(getQualityCategory(-1)).toBeNull();
    expect(getQualityCategory(101)).toBeNull();
  });
});
