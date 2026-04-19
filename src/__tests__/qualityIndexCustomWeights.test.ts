import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeQualityIndices,
  getDefaultWeights,
  isCustomWeights,
  getQualityCategory,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature } from 'geojson';

function makeFeature(props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
    geometry: { type: 'Point', coordinates: [24.94, 60.17] },
  };
}

function makeDataset(overrides: Partial<NeighborhoodProperties>[]): Feature[] {
  return overrides.map((o, i) => makeFeature({ pno: String(i).padStart(5, '0'), ...o }));
}

describe('computeQualityIndices — custom weight edge cases', () => {
  it('sets quality_index to null when all factor weights are 0', () => {
    const features = makeDataset([
      { he_vakiy: 1000, hr_mtu: 40000, crime_index: 50, unemployment_rate: 5 },
    ]);
    const zeroWeights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) zeroWeights[f.id] = 0;

    computeQualityIndices(features, zeroWeights);
    expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });

  it('computes quality_index from only secondary factors when primary weights are 0', () => {
    const features = makeDataset([
      { he_vakiy: 1000, cycling_density: 10, grocery_density: 5, restaurant_density: 20 },
      { he_vakiy: 1000, cycling_density: 50, grocery_density: 25, restaurant_density: 100 },
    ]);

    const weights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) weights[f.id] = 0;
    weights['cycling'] = 50;
    weights['grocery_access'] = 30;
    weights['restaurants'] = 20;

    computeQualityIndices(features, weights);

    const qi0 = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi1 = (features[1].properties as NeighborhoodProperties).quality_index;

    expect(qi0).not.toBeNull();
    expect(qi1).not.toBeNull();
    expect(qi1!).toBeGreaterThan(qi0!);
  });

  it('produces integer quality_index values', () => {
    const features = makeDataset([
      { he_vakiy: 500, hr_mtu: 30000, crime_index: 70, unemployment_rate: 8, higher_education_rate: 40 },
      { he_vakiy: 700, hr_mtu: 45000, crime_index: 30, unemployment_rate: 3, higher_education_rate: 70 },
      { he_vakiy: 300, hr_mtu: 25000, crime_index: 100, unemployment_rate: 12, higher_education_rate: 20 },
    ]);

    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      if (qi != null) {
        expect(Number.isInteger(qi)).toBe(true);
      }
    }
  });

  it('single feature gets exactly 50 for all inverted factors (min===max normalization)', () => {
    const features = makeDataset([
      { he_vakiy: 1000, hr_mtu: 35000, crime_index: 60, unemployment_rate: 5, higher_education_rate: 50, transit_stop_density: 30, healthcare_density: 3, school_density: 2, daycare_density: 1, grocery_density: 4, air_quality_index: 25 },
    ]);

    computeQualityIndices(features);
    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    expect(qi).toBe(50);
  });

  it('recomputes when weights change for the same features', () => {
    const features = makeDataset([
      { he_vakiy: 1000, hr_mtu: 50000, crime_index: 20 },
      { he_vakiy: 1000, hr_mtu: 20000, crime_index: 100 },
    ]);

    // Income-heavy weights
    const incomeWeights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) incomeWeights[f.id] = 0;
    incomeWeights['income'] = 100;

    computeQualityIndices(features, incomeWeights);
    const qi0Income = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi1Income = (features[1].properties as NeighborhoodProperties).quality_index;

    // Safety-heavy weights
    const safetyWeights: Record<string, number> = {};
    for (const f of QUALITY_FACTORS) safetyWeights[f.id] = 0;
    safetyWeights['safety'] = 100;

    computeQualityIndices(features, safetyWeights);
    const qi0Safety = (features[0].properties as NeighborhoodProperties).quality_index;
    const qi1Safety = (features[1].properties as NeighborhoodProperties).quality_index;

    // Feature 0 has high income (good) and low crime (good) — always high
    // Feature 1 has low income (bad) and high crime (bad) — always low
    expect(qi0Income!).toBeGreaterThan(qi1Income!);
    expect(qi0Safety!).toBeGreaterThan(qi1Safety!);
  });
});

describe('isCustomWeights', () => {
  it('returns false for default weights', () => {
    expect(isCustomWeights(getDefaultWeights())).toBe(false);
  });

  it('returns true when any weight differs from default', () => {
    const w = getDefaultWeights();
    w['safety'] = w['safety'] + 1;
    expect(isCustomWeights(w)).toBe(true);
  });

  it('returns false when missing keys fall back to defaults', () => {
    expect(isCustomWeights({})).toBe(false);
  });

  it('returns true when a secondary factor gets a non-zero weight', () => {
    const w = getDefaultWeights();
    w['cycling'] = 10;
    expect(isCustomWeights(w)).toBe(true);
  });
});

describe('getQualityCategory — boundary precision', () => {
  it('returns null for null input', () => {
    expect(getQualityCategory(null)).toBeNull();
  });

  it('returns Avoid for 0', () => {
    const cat = getQualityCategory(0);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('returns Avoid for 20', () => {
    const cat = getQualityCategory(20);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Avoid');
  });

  it('returns Bad for 21', () => {
    const cat = getQualityCategory(21);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Bad');
  });

  it('returns Okay for 41', () => {
    const cat = getQualityCategory(41);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Okay');
  });

  it('returns Good for 61', () => {
    const cat = getQualityCategory(61);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Good');
  });

  it('returns Excellent for 81', () => {
    const cat = getQualityCategory(81);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Excellent');
  });

  it('returns Excellent for 100', () => {
    const cat = getQualityCategory(100);
    expect(cat).not.toBeNull();
    expect(cat!.label.en).toBe('Excellent');
  });

  it('every integer from 0 to 100 maps to exactly one category', () => {
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      expect(cat).not.toBeNull();
    }
  });

  it('categories cover the full [0, 100] range without gaps', () => {
    const seen = new Set<string>();
    for (let i = 0; i <= 100; i++) {
      const cat = getQualityCategory(i);
      if (cat) seen.add(cat.label.en);
    }
    expect(seen.size).toBe(QUALITY_CATEGORIES.length);
  });
});
