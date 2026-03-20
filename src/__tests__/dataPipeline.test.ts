import { describe, it, expect, vi } from 'vitest';
import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices, getQualityCategory } from '../utils/qualityIndex';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import type { Feature, FeatureCollection } from 'geojson';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00100', nimi: 'Test', namn: 'Test', ...props },
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
  };
}

describe('Full data pipeline integration', () => {
  it('processes features through quickWin → change → quality → similarity pipeline', () => {
    const features = [
      makeFeature({
        pno: '00100',
        he_vakiy: 5000,
        he_18_19: 100,
        he_20_24: 200,
        he_25_29: 300,
        he_naiset: 2600,
        he_miehet: 2400,
        te_taly: 2000,
        te_eil_np: 100,
        te_laps: 400,
        tp_tyopy: 1000,
        tp_jk_info: 150,
        tp_qr_terv: 80,
        hr_mtu: 35000,
        pt_tyott: 400,
        unemployment_rate: 8,
        higher_education_rate: 55,
        crime_index: 45,
        transit_stop_density: 30,
        property_price_sqm: 5000,
        foreign_language_pct: 15,
        ownership_rate: 40,
        population_density: 5000,
        child_ratio: 8,
        income_history: '[[2018,30000],[2019,32000],[2020,33000],[2021,35000]]',
        population_history: '[[2018,4500],[2019,4700],[2020,4900],[2021,5000]]',
        unemployment_history: '[[2018,10],[2019,9],[2020,9.5],[2021,8]]',
      }),
      makeFeature({
        pno: '00200',
        he_vakiy: 3000,
        he_18_19: 50,
        he_20_24: 100,
        he_25_29: 150,
        he_naiset: 1500,
        he_miehet: 1500,
        te_taly: 1200,
        te_eil_np: 60,
        te_laps: 200,
        tp_tyopy: 600,
        tp_jk_info: 30,
        tp_qr_terv: 120,
        hr_mtu: 28000,
        pt_tyott: 360,
        unemployment_rate: 12,
        higher_education_rate: 35,
        crime_index: 80,
        transit_stop_density: 15,
        property_price_sqm: 3000,
        foreign_language_pct: 25,
        ownership_rate: 55,
        population_density: 3000,
        child_ratio: 10,
        income_history: '[[2018,25000],[2019,26000],[2020,27000],[2021,28000]]',
        population_history: '[[2018,2800],[2019,2900],[2020,2950],[2021,3000]]',
        unemployment_history: '[[2018,15],[2019,14],[2020,13],[2021,12]]',
      }),
      makeFeature({
        pno: '00300',
        he_vakiy: 8000,
        he_18_19: 200,
        he_20_24: 400,
        he_25_29: 500,
        he_naiset: 4200,
        he_miehet: 3800,
        te_taly: 3500,
        te_eil_np: 200,
        te_laps: 700,
        tp_tyopy: 2000,
        tp_jk_info: 400,
        tp_qr_terv: 150,
        hr_mtu: 42000,
        pt_tyott: 400,
        unemployment_rate: 5,
        higher_education_rate: 70,
        crime_index: 25,
        transit_stop_density: 50,
        property_price_sqm: 7000,
        foreign_language_pct: 8,
        ownership_rate: 65,
        population_density: 8000,
        child_ratio: 6,
        income_history: '[[2018,38000],[2019,39000],[2020,40000],[2021,42000]]',
        population_history: '[[2018,7500],[2019,7700],[2020,7900],[2021,8000]]',
        unemployment_history: '[[2018,7],[2019,6.5],[2020,6],[2021,5]]',
      }),
    ];

    // Step 1: Quick-win metrics
    computeQuickWinMetrics(features);
    const p0 = features[0].properties as any;
    expect(p0.youth_ratio_pct).toBeDefined();
    expect(p0.gender_ratio).toBeDefined();
    expect(p0.single_parent_hh_pct).toBeDefined();
    expect(p0.tech_sector_pct).toBeDefined();

    // Step 2: Change metrics
    computeChangeMetrics(features);
    expect(p0.income_change_pct).toBeCloseTo(((35000 - 30000) / 30000) * 100, 1);
    expect(p0.population_change_pct).toBeCloseTo(((5000 - 4500) / 4500) * 100, 1);
    expect(p0.unemployment_change_pct).toBeCloseTo(((8 - 10) / 10) * 100, 1);

    // Step 3: Quality index computation
    computeQualityIndices(features);
    for (const f of features) {
      const qi = (f.properties as any).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }

    // Best area (00300: highest income, lowest crime, highest education) should score highest
    const qi0 = (features[0].properties as any).quality_index;
    const qi2 = (features[2].properties as any).quality_index;
    expect(qi2).toBeGreaterThan(qi0);

    // Step 4: Quality category
    const cat = getQualityCategory(qi2);
    expect(cat).not.toBeNull();

    // Step 5: Similarity search
    const similar = findSimilarNeighborhoods(
      features[0].properties as any,
      features,
      2,
    );
    expect(similar).toHaveLength(2);
    // Each result should have distance and center
    for (const s of similar) {
      expect(s.distance).toBeGreaterThanOrEqual(0);
      expect(s.center).toHaveLength(2);
    }

    // Step 6: Metro averages
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(16000);
    expect(avg.hr_mtu).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeGreaterThan(0);
  });

  it('filter pipeline works with computed quality indices', () => {
    const features = [
      makeFeature({ pno: '00100', he_vakiy: 1000, hr_mtu: 20000 }),
      makeFeature({ pno: '00200', he_vakiy: 1000, hr_mtu: 40000 }),
      makeFeature({ pno: '00300', he_vakiy: 1000, hr_mtu: 30000 }),
    ];

    computeQualityIndices(features);

    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    // Filter for high income areas
    const criteria: FilterCriterion[] = [
      { layerId: 'median_income', min: 25000, max: 55000 },
    ];

    const matching = computeMatchingPnos(data, criteria);
    expect(matching.has('00200')).toBe(true); // 40000 >= 25000
    expect(matching.has('00300')).toBe(true); // 30000 >= 25000
    expect(matching.has('00100')).toBe(false); // 20000 < 25000
  });

  it('handles completely empty dataset without crashing', () => {
    const features: Feature[] = [];

    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(0);

    const similar = findSimilarNeighborhoods(
      { pno: '00100' } as any,
      features,
    );
    expect(similar).toEqual([]);
  });

  it('handles features with all null properties', () => {
    const features = [
      makeFeature({
        pno: '00100',
        he_vakiy: null,
        hr_mtu: null,
        unemployment_rate: null,
        higher_education_rate: null,
        crime_index: null,
      }),
      makeFeature({
        pno: '00200',
        he_vakiy: null,
        hr_mtu: null,
        unemployment_rate: null,
        higher_education_rate: null,
        crime_index: null,
      }),
    ];

    // Should not throw
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    expect((features[0].properties as any).quality_index).toBeNull();

    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(0);
  });
});
