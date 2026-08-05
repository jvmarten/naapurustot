import { describe, it, expect } from 'vitest';
import {
  computeQualityIndices,
  getQualityCategory,
  QUALITY_CATEGORIES,
  QUALITY_FACTORS,
  QUALITY_DIMENSIONS,
  FACTOR_DIMENSION,
  getPersonaWeights,
} from '../utils/qualityIndex';
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

  it('CF-8: populates per-dimension sub-scores alongside the headline index', () => {
    const features = [
      makeFeature({ hr_mtu: 10000, unemployment_rate: 20, violent_crime_rate: 200, air_quality_index: 20 }),
      makeFeature({ hr_mtu: 50000, unemployment_rate: 0, violent_crime_rate: 0, air_quality_index: 5 }),
    ];
    computeQualityIndices(features);
    const dims = features[1].properties!.quality_dimension_scores as Record<string, number>;
    expect(dims).toBeTruthy();
    // safety (violent crime) and livelihood (income/employment) are default-weighted dimensions
    expect(typeof dims.safety).toBe('number');
    expect(typeof dims.livelihood).toBe('number');
    expect(dims.safety).toBeGreaterThanOrEqual(0);
    expect(dims.safety).toBeLessThanOrEqual(100);
    // Feature 1 has the better violent crime/income/employment → higher safety + livelihood
    const dims0 = features[0].properties!.quality_dimension_scores as Record<string, number>;
    expect(dims.safety).toBeGreaterThan(dims0.safety);
    expect(dims.livelihood).toBeGreaterThan(dims0.livelihood);
  });

  it('CF-8: clears dimension scores when the index is null', () => {
    const features = [makeFeature({ hr_mtu: null, unemployment_rate: null, violent_crime_rate: null })];
    computeQualityIndices(features);
    expect(features[0].properties!.quality_index).toBeNull();
    expect(features[0].properties!.quality_dimension_scores).toBeNull();
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

describe('QW-2 opt-in health/climate factors', () => {
  it('health_index, radon, flood_risk are defaultWeight:0 and mapped to the health dimension', () => {
    for (const id of ['health_index', 'radon', 'flood_risk']) {
      const f = QUALITY_FACTORS.find((x) => x.id === id);
      expect(f, `factor ${id} exists`).toBeDefined();
      expect(f!.defaultWeight, `${id} defaultWeight`).toBe(0);
      // These three labels ("Sairastavuus", "Radon", "Tulvariski") name the raw
      // quantity, so the direction lives in `polarity`, not `invert` — and being
      // hazards they are fixed-direction, never signed.
      expect(f!.polarity, `${id} polarity`).toBe('less-is-better');
      expect(f!.invert, `${id} invert`).toBe(false);
      expect(FACTOR_DIMENSION[id], `${id} dimension`).toBe('health');
    }
  });

  it('weight-0 factors do not move the default index', () => {
    const base = { pno: '00100', violent_crime_rate: 50, hr_mtu: 25000, unemployment_rate: 5, higher_education_rate: 30 };
    const withHealth = { ...base, pno: '00200', health_index: 200, radon: 2000, flood_risk_pct: 90 };
    const mk = (p: Record<string, unknown>): Feature => ({ type: 'Feature', geometry: null as unknown as Feature['geometry'], properties: p });
    const feats = [mk(base), mk(withHealth)];
    computeQualityIndices(feats);
    expect(feats[0].properties!.quality_index).toBe(feats[1].properties!.quality_index);
  });
});

describe('PO-5 Balanced persona sums to exactly 100', () => {
  const balanced = getPersonaWeights('balanced');
  const evaluative = QUALITY_DIMENSIONS.filter((d) => d.defaultWeight !== 0).map((d) => d.id);
  const target = Math.round(100 / evaluative.length);

  it('all factor weights sum to exactly 100', () => {
    const sum = Object.values(balanced).reduce((a, b) => a + b, 0);
    expect(sum).toBe(100);
  });

  it('each evaluative dimension totals exactly the equal target (25)', () => {
    for (const dim of evaluative) {
      const dimSum = QUALITY_FACTORS
        .filter((f) => (FACTOR_DIMENSION[f.id] ?? 'demographics') === dim)
        .reduce((s, f) => s + (balanced[f.id] ?? 0), 0);
      expect(dimSum, `dimension ${dim}`).toBe(target);
    }
  });
});
