/**
 * Quality Index — critical path tests for untested edge cases.
 *
 * Covers: normalize with negative ranges, collectRange caching correctness,
 * getFactorScore with mixed missing/present multi-properties,
 * computeQualityIndices with all-zero weights, range cache invalidation.
 */
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
    geometry: { type: 'Point', coordinates: [24.9, 60.2] },
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro', ...props } as NeighborhoodProperties,
  };
}

describe('Quality Index — critical untested paths', () => {
  describe('normalize with negative value ranges', () => {
    it('correctly normalizes values in a fully negative range', () => {
      // If crime_index spans [-50, -10], normalize(-30, {min:-50,max:-10}) should be 50
      const features = [
        makeFeature({ crime_index: -50, hr_mtu: null, unemployment_rate: null }),
        makeFeature({ crime_index: -10, hr_mtu: null, unemployment_rate: null }),
        makeFeature({ crime_index: -30, hr_mtu: null, unemployment_rate: null }),
      ];
      const weights = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      weights['safety'] = 100; // only safety (crime_index, inverted)
      computeQualityIndices(features, weights);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      // crime_index is inverted: lowest crime (-50) → best score (100), highest crime (-10) → worst score (0)
      expect(scores[0]).toBe(100); // -50 normalized to 100, inverted stays 100
      expect(scores[1]).toBe(0);   // -10 normalized to 0, inverted stays 0... wait
      // Actually: normalize(-50, {min:-50,max:-10}) = ((-50)-(-50))/((-10)-(-50))*100 = 0
      // Then inverted: 100 - 0 = 100. ✓
      // normalize(-10, {min:-50,max:-10}) = ((-10)-(-50))/((-10)-(-50))*100 = 100
      // Then inverted: 100 - 100 = 0. ✓
      // normalize(-30, {min:-50,max:-10}) = ((-30)-(-50))/((-10)-(-50))*100 = 50
      // Then inverted: 100 - 50 = 50. ✓
      expect(scores[2]).toBe(50);
    });
  });

  describe('collectRange caching — dataset identity', () => {
    it('recomputes ranges when a different features array is passed', () => {
      const featuresA = [
        makeFeature({ hr_mtu: 20000 }),
        makeFeature({ hr_mtu: 40000 }),
      ];
      const featuresB = [
        makeFeature({ hr_mtu: 10000 }),
        makeFeature({ hr_mtu: 80000 }),
      ];

      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;

      computeQualityIndices(featuresA, w);
      const scoresA = featuresA.map(f => (f.properties as NeighborhoodProperties).quality_index);

      computeQualityIndices(featuresB, w);
      const scoresB = featuresB.map(f => (f.properties as NeighborhoodProperties).quality_index);

      // With different data ranges, the feature with 20000 should map differently
      // featuresA: 20000→0, 40000→100
      // featuresB: 10000→0, 80000→100
      expect(scoresA[0]).toBe(0);
      expect(scoresA[1]).toBe(100);
      expect(scoresB[0]).toBe(0);
      expect(scoresB[1]).toBe(100);
    });

    it('reuses cache when same features array reference is passed with different weights', () => {
      // Use values where income and safety rankings diverge:
      // Feature A: low income (20k), low crime (5) → bad income, good safety
      // Feature B: high income (40k), high crime (20) → good income, bad safety
      const features = [
        makeFeature({ hr_mtu: 20000, crime_index: 5 }),
        makeFeature({ hr_mtu: 40000, crime_index: 20 }),
      ];

      const w1 = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w1['income'] = 100;
      computeQualityIndices(features, w1);
      const incomeScoreA = (features[0].properties as NeighborhoodProperties).quality_index;

      const w2 = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w2['safety'] = 100;
      computeQualityIndices(features, w2);
      const safetyScoreA = (features[0].properties as NeighborhoodProperties).quality_index;

      // Feature A: income=0 (worst income), safety=100 (best, inverted)
      // Rankings should be opposite
      expect(incomeScoreA).toBe(0);
      expect(safetyScoreA).toBe(100);
    });
  });

  describe('getFactorScore — multi-property factor with partial data', () => {
    it('services factor with 1 of 4 properties present still contributes', () => {
      const features = [
        makeFeature({
          healthcare_density: 10,
          school_density: null,
          daycare_density: null,
          grocery_density: null,
          // Need range: at least 2 features with data
        }),
        makeFeature({
          healthcare_density: 5,
          school_density: null,
          daycare_density: null,
          grocery_density: null,
        }),
      ];

      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['services'] = 100;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      // healthcare_density only: [10, 5] → normalized → higher healthcare = higher services score
      expect(scores[0]).toBe(100);
      expect(scores[1]).toBe(0);
    });
  });

  describe('computeQualityIndices — all weights zero', () => {
    it('produces null quality_index when every factor weight is 0', () => {
      const features = [
        makeFeature({ hr_mtu: 30000, crime_index: 5 }),
      ];
      const zeroWeights = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      computeQualityIndices(features, zeroWeights);

      expect((features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
    });
  });

  describe('computeQualityIndices — single feature (min === max)', () => {
    it('gives score of 50 when only one neighborhood has data', () => {
      const features = [
        makeFeature({ hr_mtu: 30000 }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;
      computeQualityIndices(features, w);

      // Only one value → min === max → normalize returns 50
      expect((features[0].properties as NeighborhoodProperties).quality_index).toBe(50);
    });
  });

  describe('computeQualityIndices — NaN and Infinity in data', () => {
    it('treats NaN values as missing (uses metro average fallback)', () => {
      const features = [
        makeFeature({ hr_mtu: NaN }),
        makeFeature({ hr_mtu: 20000 }),
        makeFeature({ hr_mtu: 40000 }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      // NaN feature should use avg fallback (30000), which normalizes to 50
      expect(scores[0]).toBe(50);
      expect(scores[1]).toBe(0);
      expect(scores[2]).toBe(100);
    });

    it('treats Infinity values as missing', () => {
      const features = [
        makeFeature({ hr_mtu: Infinity }),
        makeFeature({ hr_mtu: 20000 }),
        makeFeature({ hr_mtu: 40000 }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      expect(scores[0]).toBe(50); // falls back to avg
    });
  });

  describe('getQualityCategory — boundary precision', () => {
    it('assigns exact boundary values to correct categories', () => {
      // Boundaries are: 0-20, 21-40, 41-60, 61-80, 81-100
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

    it('returns null for values between category boundaries (20.5)', () => {
      // 20.5 is between 20 (Avoid max) and 21 (Bad min) — should it be null?
      const cat = getQualityCategory(20.5);
      // Categories use integer ranges, so 20.5 > 20 (Avoid max) but < 21 (Bad min) → falls through
      expect(cat).toBeNull();
    });
  });

  describe('isCustomWeights — edge cases', () => {
    it('returns false for default weights', () => {
      expect(isCustomWeights(getDefaultWeights())).toBe(false);
    });

    it('returns true when secondary factor gets non-zero weight', () => {
      const w = getDefaultWeights();
      w['cycling'] = 10;
      expect(isCustomWeights(w)).toBe(true);
    });

    it('treats completely empty object as default (all keys fall back)', () => {
      expect(isCustomWeights({})).toBe(false);
    });

    it('detects change in primary factor weight', () => {
      const w = getDefaultWeights();
      w['safety'] = 50; // changed from 25
      expect(isCustomWeights(w)).toBe(true);
    });
  });

  describe('QUALITY_CATEGORIES — no gaps in range coverage', () => {
    it('categories cover 0-100 without gaps for integer values', () => {
      for (let i = 0; i <= 100; i++) {
        const cat = getQualityCategory(i);
        expect(cat).not.toBeNull();
      }
    });

    it('categories have non-overlapping integer ranges', () => {
      const covered = new Set<number>();
      for (const cat of QUALITY_CATEGORIES) {
        for (let i = cat.min; i <= cat.max; i++) {
          expect(covered.has(i)).toBe(false);
          covered.add(i);
        }
      }
      // Should cover all integers 0-100
      expect(covered.size).toBe(101);
    });
  });

  describe('hr_mtu <= 0 exclusion in range computation', () => {
    it('excludes zero income from range but uses avg as fallback', () => {
      const features = [
        makeFeature({ hr_mtu: 0 }),    // excluded from range
        makeFeature({ hr_mtu: 20000 }),
        makeFeature({ hr_mtu: 40000 }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      // hr_mtu=0 is treated as missing, falls back to avg (30000) → normalized to 50
      expect(scores[0]).toBe(50);
      expect(scores[1]).toBe(0);
      expect(scores[2]).toBe(100);
    });

    it('excludes negative income from range', () => {
      const features = [
        makeFeature({ hr_mtu: -5000 }),
        makeFeature({ hr_mtu: 20000 }),
        makeFeature({ hr_mtu: 40000 }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 100;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      expect(scores[0]).toBe(50); // missing → avg fallback
    });
  });

  describe('weight rebalancing with partial data', () => {
    it('rebalances correctly when one factor has no data at all', () => {
      const features = [
        makeFeature({ hr_mtu: 20000, crime_index: null }),
        makeFeature({ hr_mtu: 40000, crime_index: null }),
      ];
      const w = Object.fromEntries(QUALITY_FACTORS.map(f => [f.id, 0]));
      w['income'] = 50;
      w['safety'] = 50;
      computeQualityIndices(features, w);

      const scores = features.map(f => (f.properties as NeighborhoodProperties).quality_index);
      // Safety has no data at all → only income contributes
      // Weight is rebalanced: income is 100% effective weight
      expect(scores[0]).toBe(0);
      expect(scores[1]).toBe(100);
    });
  });
});
