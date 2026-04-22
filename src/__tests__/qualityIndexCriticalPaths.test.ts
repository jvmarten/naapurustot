import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeQualityIndices,
  getQualityCategory,
  getDefaultWeights,
  isCustomWeights,
  QUALITY_FACTORS,
  QUALITY_CATEGORIES,
} from '../utils/qualityIndex';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: null, he_vakiy: 1000, ...props } as NeighborhoodProperties,
  };
}

describe('qualityIndex critical paths', () => {
  describe('normalize: min === max', () => {
    it('returns 50 when all neighborhoods have identical values', () => {
      const features = [
        makeFeature({ hr_mtu: 30000, crime_index: 50, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 10, healthcare_density: 3, school_density: 2, daycare_density: 2, grocery_density: 3, air_quality_index: 30 }),
        makeFeature({ pno: '00200', hr_mtu: 30000, crime_index: 50, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 10, healthcare_density: 3, school_density: 2, daycare_density: 2, grocery_density: 3, air_quality_index: 30 }),
      ];
      computeQualityIndices(features);
      const qi1 = (features[0].properties as NeighborhoodProperties).quality_index;
      const qi2 = (features[1].properties as NeighborhoodProperties).quality_index;
      expect(qi1).toBe(qi2);
      expect(qi1).toBe(50);
    });
  });

  describe('quality_index = null when no scorable factors', () => {
    it('sets null when all metric values are missing', () => {
      const features = [makeFeature({ hr_mtu: null, crime_index: null, unemployment_rate: null, higher_education_rate: null, transit_stop_density: null, healthcare_density: null, school_density: null, daycare_density: null, grocery_density: null, air_quality_index: null })];
      computeQualityIndices(features);
      expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
    });

    it('sets null for feature where only dataset-spanning ranges lack data', () => {
      const f1 = makeFeature({ pno: '00100' });
      const f2 = makeFeature({ pno: '00200' });
      // If every feature has null for every factor property, ranges will be {min:0, max:0}
      // and getFactorScore will return null for all factors
      for (const factor of QUALITY_FACTORS) {
        for (const prop of factor.properties) {
          (f1.properties as Record<string, unknown>)[prop] = null;
          (f2.properties as Record<string, unknown>)[prop] = null;
        }
      }
      computeQualityIndices([f1, f2]);
      expect((f1.properties as NeighborhoodProperties).quality_index).toBeNull();
    });
  });

  describe('hr_mtu <= 0 filtering in collectRange', () => {
    it('excludes hr_mtu <= 0 from range computation', () => {
      const features = [
        makeFeature({ pno: '00100', hr_mtu: -1, crime_index: 10, unemployment_rate: 3, higher_education_rate: 50, transit_stop_density: 20, healthcare_density: 5, school_density: 5, daycare_density: 5, grocery_density: 5, air_quality_index: 25 }),
        makeFeature({ pno: '00200', hr_mtu: 0, crime_index: 90, unemployment_rate: 15, higher_education_rate: 10, transit_stop_density: 2, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 45 }),
        makeFeature({ pno: '00300', hr_mtu: 30000, crime_index: 50, unemployment_rate: 8, higher_education_rate: 30, transit_stop_density: 10, healthcare_density: 3, school_density: 3, daycare_density: 3, grocery_density: 3, air_quality_index: 35 }),
        makeFeature({ pno: '00400', hr_mtu: 50000, crime_index: 30, unemployment_rate: 4, higher_education_rate: 60, transit_stop_density: 30, healthcare_density: 7, school_density: 7, daycare_density: 7, grocery_density: 7, air_quality_index: 20 }),
      ];
      computeQualityIndices(features);
      // Feature with hr_mtu=0 should use fallback (range avg) for income factor, not get 0-based score
      const q0 = (features[0].properties as NeighborhoodProperties).quality_index;
      const q1 = (features[1].properties as NeighborhoodProperties).quality_index;
      // Both should still get a quality_index (not null) because other factors have data
      expect(q0).not.toBeNull();
      expect(q1).not.toBeNull();
    });
  });

  describe('custom weights', () => {
    it('zero-weighted factors are excluded from computation', () => {
      const weights = getDefaultWeights();
      // Zero out everything except income
      for (const f of QUALITY_FACTORS) {
        weights[f.id] = 0;
      }
      weights['income'] = 100;

      const features = [
        makeFeature({ pno: '00100', hr_mtu: 50000 }),
        makeFeature({ pno: '00200', hr_mtu: 20000 }),
      ];
      computeQualityIndices(features, weights);
      const q1 = (features[0].properties as NeighborhoodProperties).quality_index!;
      const q2 = (features[1].properties as NeighborhoodProperties).quality_index!;
      expect(q1).toBeGreaterThan(q2);
      expect(q1).toBe(100); // highest income = max score
      expect(q2).toBe(0);   // lowest income = min score
    });

    it('isCustomWeights detects differences from defaults', () => {
      const defaults = getDefaultWeights();
      expect(isCustomWeights(defaults)).toBe(false);
      expect(isCustomWeights({ ...defaults, safety: 50 })).toBe(true);
    });

    it('isCustomWeights treats missing keys as default values', () => {
      expect(isCustomWeights({})).toBe(false);
    });
  });

  describe('getQualityCategory boundary precision', () => {
    it('maps exact boundary values correctly', () => {
      // 0 → first category (Avoid)
      expect(getQualityCategory(0)?.label.en).toBe('Avoid');
      // 20 → still first category (20 is the max of first, but tested via <=)
      expect(getQualityCategory(20)?.label.en).toBe('Avoid');
      // 20.1 → second category
      expect(getQualityCategory(20.1)?.label.en).toBe('Bad');
      // 40 → second category (max of Bad)
      expect(getQualityCategory(40)?.label.en).toBe('Bad');
      // 60 → third category (max of Okay)
      expect(getQualityCategory(60)?.label.en).toBe('Okay');
      // 80 → fourth category (max of Good)
      expect(getQualityCategory(80)?.label.en).toBe('Good');
      // 100 → fifth category (max of Excellent)
      expect(getQualityCategory(100)?.label.en).toBe('Excellent');
    });

    it('returns null for null input', () => {
      expect(getQualityCategory(null)).toBeNull();
    });

    it('returns null for values outside 0-100 range', () => {
      expect(getQualityCategory(-1)).toBeNull();
      expect(getQualityCategory(101)).toBeNull();
    });

    it('handles fractional values within each category', () => {
      expect(getQualityCategory(0.5)?.label.en).toBe('Avoid');
      expect(getQualityCategory(19.9)?.label.en).toBe('Avoid');
      expect(getQualityCategory(50)?.label.en).toBe('Okay');
      expect(getQualityCategory(79.9)?.label.en).toBe('Good');
      expect(getQualityCategory(99.9)?.label.en).toBe('Excellent');
    });

    it('all categories have contiguous, non-overlapping ranges', () => {
      for (let i = 1; i < QUALITY_CATEGORIES.length; i++) {
        expect(QUALITY_CATEGORIES[i].min).toBe(QUALITY_CATEGORIES[i - 1].max);
      }
    });
  });

  describe('cache invalidation on dataset change', () => {
    it('recomputes when passed different feature arrays', () => {
      const f1 = [
        makeFeature({ pno: '00100', hr_mtu: 20000, crime_index: 80, unemployment_rate: 15, higher_education_rate: 10, transit_stop_density: 2, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 45 }),
        makeFeature({ pno: '00200', hr_mtu: 50000, crime_index: 20, unemployment_rate: 3, higher_education_rate: 70, transit_stop_density: 50, healthcare_density: 8, school_density: 8, daycare_density: 8, grocery_density: 8, air_quality_index: 18 }),
      ];
      computeQualityIndices(f1);
      const q1_first = (f1[0].properties as NeighborhoodProperties).quality_index!;

      // Different dataset with reversed values
      const f2 = [
        makeFeature({ pno: '00100', hr_mtu: 50000, crime_index: 20, unemployment_rate: 3, higher_education_rate: 70, transit_stop_density: 50, healthcare_density: 8, school_density: 8, daycare_density: 8, grocery_density: 8, air_quality_index: 18 }),
        makeFeature({ pno: '00200', hr_mtu: 20000, crime_index: 80, unemployment_rate: 15, higher_education_rate: 10, transit_stop_density: 2, healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1, air_quality_index: 45 }),
      ];
      computeQualityIndices(f2);
      const q1_second = (f2[0].properties as NeighborhoodProperties).quality_index!;

      // Same pno but with high values should now score high
      expect(q1_second).toBeGreaterThan(q1_first);
    });
  });

  describe('inverted factors score correctly', () => {
    it('lower crime_index yields higher quality score', () => {
      const features = [
        makeFeature({ pno: '00100', crime_index: 10, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 10, healthcare_density: 3, school_density: 3, daycare_density: 3, grocery_density: 3, air_quality_index: 30 }),
        makeFeature({ pno: '00200', crime_index: 100, hr_mtu: 30000, unemployment_rate: 5, higher_education_rate: 40, transit_stop_density: 10, healthcare_density: 3, school_density: 3, daycare_density: 3, grocery_density: 3, air_quality_index: 30 }),
      ];
      computeQualityIndices(features);
      const qLowCrime = (features[0].properties as NeighborhoodProperties).quality_index!;
      const qHighCrime = (features[1].properties as NeighborhoodProperties).quality_index!;
      expect(qLowCrime).toBeGreaterThan(qHighCrime);
    });
  });

  describe('multi-property factor averaging (services)', () => {
    it('services factor averages healthcare, school, daycare, and grocery densities', () => {
      const weights = getDefaultWeights();
      for (const f of QUALITY_FACTORS) weights[f.id] = 0;
      weights['services'] = 100;

      const features = [
        makeFeature({ pno: '00100', healthcare_density: 10, school_density: 10, daycare_density: 10, grocery_density: 10 }),
        makeFeature({ pno: '00200', healthcare_density: 1, school_density: 1, daycare_density: 1, grocery_density: 1 }),
        makeFeature({ pno: '00300', healthcare_density: 10, school_density: 1, daycare_density: 1, grocery_density: 1 }),
      ];
      computeQualityIndices(features, weights);
      const qHigh = (features[0].properties as NeighborhoodProperties).quality_index!;
      const qLow = (features[1].properties as NeighborhoodProperties).quality_index!;
      const qMixed = (features[2].properties as NeighborhoodProperties).quality_index!;
      expect(qHigh).toBe(100);
      expect(qLow).toBe(0);
      expect(qMixed).toBeGreaterThan(qLow);
      expect(qMixed).toBeLessThan(qHigh);
    });
  });
});
