import { describe, it, expect } from 'vitest';
import { computeQualityIndices, getQualityCategory, NATIONAL_QUALITY_RANGES, QUALITY_CATEGORIES } from '../utils/qualityIndex';
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

  it('computes exact values for two-feature min/max scenario with explicit weights', () => {
    const features = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 0, higher_education_rate: 0 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 20, higher_education_rate: 100 }),
    ];

    // Use explicit weights to test calculation precisely
    const weights: Record<string, number> = {
      safety: 0, employment: 35, income: 35, education: 30,
      transit: 0, services: 0, air_quality: 0, quietness: 0,
      walkability: 0, school_quality: 0, life_expectancy: 0, commute_time: 0,
      cycling: 0, grocery_access: 0, restaurants: 0,
    };

    computeQualityIndices(features, weights);

    // Feature 0: income=0(min), unemployment=100(inverted, lowest=best), education=0(min)
    // total = (0*35 + 100*35 + 0*30) / 100 = 35
    expect(features[0].properties!.quality_index).toBe(35);

    // Feature 1: income=100(max), unemployment=0(worst), education=100(max)
    // total = (100*35 + 0*35 + 100*30) / 100 = 65
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

  it('treats hr_mtu of 0 as missing and uses metro average', () => {
    const features = [
      makeFeature({ hr_mtu: 0, unemployment_rate: 5, higher_education_rate: 30 }),
      makeFeature({ hr_mtu: 30000, unemployment_rate: 10, higher_education_rate: 50 }),
    ];
    computeQualityIndices(features);
    // Feature 0 income falls back to metro average (30000) instead of being skipped
    expect(features[0].properties!.quality_index).not.toBeNull();
  });

  it('uses metro average for missing data instead of crushing the score', () => {
    // Feature 0 is missing income; features 1 and 2 have income data
    const features = [
      makeFeature({ hr_mtu: null, unemployment_rate: 5, higher_education_rate: 50 }),
      makeFeature({ hr_mtu: 20000, unemployment_rate: 10, higher_education_rate: 40 }),
      makeFeature({ hr_mtu: 40000, unemployment_rate: 15, higher_education_rate: 60 }),
    ];

    const weights: Record<string, number> = {
      safety: 0, employment: 0, income: 50, education: 50,
      transit: 0, services: 0, air_quality: 0,
      cycling: 0, grocery_access: 0, restaurants: 0,
    };

    computeQualityIndices(features, weights);

    // Metro average income = (20000+40000)/2 = 30000 → normalized to 50
    // Feature 0: income=50 (from avg), education=(50-40)/(60-40)*100=50 → weighted avg = 50
    expect(features[0].properties!.quality_index).toBe(50);
  });

  it('normalizes against national ranges when supplied, not the feature set', () => {
    const nationalRanges = { hr_mtu: { min: 10000, max: 50000, avg: 30000 } };
    const features = [makeFeature({ hr_mtu: 20000 }), makeFeature({ hr_mtu: 40000 })];
    computeQualityIndices(features, { income: 100 }, nationalRanges);
    // (20000-10000)/40000*100 = 25 ; (40000-10000)/40000*100 = 75
    expect(features[0].properties!.quality_index).toBe(25);
    expect(features[1].properties!.quality_index).toBe(75);
  });

  it('keeps scores comparable across separately-computed regions with national ranges', () => {
    const nationalRanges = { hr_mtu: { min: 10000, max: 50000, avg: 30000 } };
    const region1 = [makeFeature({ hr_mtu: 25000 }), makeFeature({ hr_mtu: 35000 })];
    const region2 = [makeFeature({ hr_mtu: 40000 }), makeFeature({ hr_mtu: 48000 })];
    computeQualityIndices(region1, { income: 100 }, nationalRanges);
    computeQualityIndices(region2, { income: 100 }, nationalRanges);
    // Every region-2 postal code outscores every region-1 one — the whole point.
    const r1 = region1.map((f) => f.properties!.quality_index as number);
    const r2 = region2.map((f) => f.properties!.quality_index as number);
    expect(Math.max(...r1)).toBeLessThan(Math.min(...r2));
  });

  it('without national ranges, region-relative scope makes regions non-comparable', () => {
    // Each region independently spans 0..100, so region 1's richest postal code
    // ties region 2's poorest despite being far poorer — what national ranges fix.
    const region1 = [makeFeature({ hr_mtu: 25000 }), makeFeature({ hr_mtu: 35000 })];
    const region2 = [makeFeature({ hr_mtu: 40000 }), makeFeature({ hr_mtu: 48000 })];
    computeQualityIndices(region1, { income: 100 });
    computeQualityIndices(region2, { income: 100 });
    expect(region1[1].properties!.quality_index).toBe(100);
    expect(region2[0].properties!.quality_index).toBe(0);
  });

  it('falls back to a feature scan for metrics missing from national ranges', () => {
    const features = [makeFeature({ hr_mtu: 20000 }), makeFeature({ hr_mtu: 40000 })];
    // hr_mtu absent from the supplied ranges → scan the features instead.
    computeQualityIndices(features, { income: 100 }, {});
    expect(features[0].properties!.quality_index).toBe(0);
    expect(features[1].properties!.quality_index).toBe(100);
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
    expect(getQualityCategory(81)!.label.en).toBe('Excellent');
    expect(getQualityCategory(100)!.label.en).toBe('Excellent');
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
      expect(QUALITY_CATEGORIES[i].min).toBe(QUALITY_CATEGORIES[i - 1].max);
    }
  });
});

describe('NATIONAL_QUALITY_RANGES', () => {
  it('provides finite, ordered min/max/avg for the primary quality metrics', () => {
    for (const key of ['crime_index', 'hr_mtu', 'unemployment_rate', 'higher_education_rate', 'air_quality_index']) {
      const r = NATIONAL_QUALITY_RANGES[key];
      expect(r, `missing range for ${key}`).toBeDefined();
      expect(Number.isFinite(r.min) && Number.isFinite(r.max) && Number.isFinite(r.avg)).toBe(true);
      expect(r.max).toBeGreaterThanOrEqual(r.min);
    }
  });
});
