import { describe, it, expect, vi } from 'vitest';

// Mock i18n
vi.mock('../utils/i18n', () => ({
  t: (key: string) => key,
  getLang: () => 'fi',
  setLang: () => {},
}));

import { computeQualityIndices, getQualityCategory } from '../utils/qualityIndex';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from '../utils/metrics';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import { filterSmallIslands } from '../utils/geometryFilter';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature, FeatureCollection } from 'geojson';

function makeFeature(pno: string, props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
    properties: { pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, ...props },
  };
}

describe('full data pipeline integration', () => {
  it('runs the complete pipeline: quickWin → change → quality → filter → similarity', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: 5000,
        hr_mtu: 40000,
        hr_ktu: 35000,
        unemployment_rate: 5,
        higher_education_rate: 65,
        crime_index: 30,
        transit_stop_density: 80,
        air_quality_index: 22,
        healthcare_density: 5,
        school_density: 3,
        daycare_density: 4,
        grocery_density: 6,
        property_price_sqm: 6000,
        ownership_rate: 55,
        he_18_19: 100,
        he_20_24: 300,
        he_25_29: 400,
        he_naiset: 2600,
        he_miehet: 2400,
        te_taly: 2500,
        te_eil_np: 100,
        te_laps: 500,
        tp_tyopy: 2000,
        tp_j_info: 400,
        tp_q_terv: 200,
        pt_tyoll: 3000,
        pt_vakiy: 4000,
        he_65_69: 200,
        he_70_74: 150,
        he_75_79: 100,
        he_80_84: 50,
        he_85_: 30,
        income_history: JSON.stringify([[2020, 35000], [2024, 40000]]),
        population_history: JSON.stringify([[2020, 4500], [2024, 5000]]),
        unemployment_history: null,
        pinta_ala: 2_000_000,
      }),
      makeFeature('00200', {
        he_vakiy: 3000,
        hr_mtu: 25000,
        hr_ktu: 22000,
        unemployment_rate: 15,
        higher_education_rate: 30,
        crime_index: 100,
        transit_stop_density: 20,
        air_quality_index: 40,
        healthcare_density: 1,
        school_density: 1,
        daycare_density: 1,
        grocery_density: 2,
        property_price_sqm: 2500,
        ownership_rate: 30,
        he_18_19: 50,
        he_20_24: 100,
        he_25_29: 150,
        he_naiset: 1500,
        he_miehet: 1500,
        te_taly: 1800,
        te_eil_np: 200,
        te_laps: 200,
        tp_tyopy: 800,
        tp_j_info: 50,
        tp_q_terv: 100,
        pt_tyoll: 1500,
        pt_vakiy: 2500,
        he_65_69: 100,
        he_70_74: 80,
        he_75_79: 60,
        he_80_84: 30,
        he_85_: 20,
        income_history: JSON.stringify([[2020, 26000], [2024, 25000]]),
        population_history: JSON.stringify([[2020, 3200], [2024, 3000]]),
        unemployment_history: null,
        pinta_ala: 5_000_000,
      }),
    ];

    // Step 1: Quick wins
    computeQuickWinMetrics(features);
    const p1 = features[0].properties!;
    expect(p1.youth_ratio_pct).toBeDefined();
    expect(p1.gender_ratio).toBeDefined();
    expect(p1.employment_rate).toBeDefined();
    expect(p1.elderly_ratio_pct).toBeDefined();

    // Step 2: Change metrics
    computeChangeMetrics(features);
    expect(features[0].properties!.income_change_pct).toBeCloseTo(14.29, 1);
    expect(features[1].properties!.income_change_pct).toBeCloseTo(-3.85, 1);

    // Step 3: Quality indices
    computeQualityIndices(features);
    const qi1 = features[0].properties!.quality_index as number;
    const qi2 = features[1].properties!.quality_index as number;
    expect(qi1).toBeGreaterThan(qi2); // 00100 is objectively better
    expect(qi1).toBeGreaterThanOrEqual(0);
    expect(qi1).toBeLessThanOrEqual(100);

    // Step 4: Quality categories
    const cat1 = getQualityCategory(qi1);
    const cat2 = getQualityCategory(qi2);
    expect(cat1).not.toBeNull();
    expect(cat2).not.toBeNull();

    // Step 5: Metro averages
    const averages = computeMetroAverages(features);
    expect(averages.he_vakiy).toBe(8000);
    expect(averages.hr_mtu).toBeGreaterThan(25000);
    expect(averages.hr_mtu).toBeLessThan(40000);

    // Step 6: Filter
    const fc: FeatureCollection = { type: 'FeatureCollection', features };
    const filters: FilterCriterion[] = [
      { layerId: 'median_income', min: 30000, max: 55000 },
    ];
    const matchingPnos = computeMatchingPnos(fc, filters);
    expect(matchingPnos.has('00100')).toBe(true);
    expect(matchingPnos.has('00200')).toBe(false);

    // Step 7: Similarity
    const similar = findSimilarNeighborhoods(
      features[0].properties as any,
      features,
      5,
    );
    expect(similar.length).toBe(1);
    expect(similar[0].properties.pno).toBe('00200');
  });

  it('handles a feature with all null data through the full pipeline', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: null,
        hr_mtu: null,
        unemployment_rate: null,
        higher_education_rate: null,
        income_history: null,
        population_history: null,
        unemployment_history: null,
      }),
      makeFeature('00200', {
        he_vakiy: 1000,
        hr_mtu: 30000,
        unemployment_rate: 10,
        higher_education_rate: 50,
        income_history: JSON.stringify([[2020, 28000], [2024, 30000]]),
        population_history: null,
        unemployment_history: null,
      }),
    ];

    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);
    const averages = computeMetroAverages(features);

    // Null feature should have null quality index
    expect(features[0].properties!.quality_index).toBeNull();
    // Valid feature should have a quality index
    expect(features[1].properties!.quality_index).not.toBeNull();
    // Metro averages should only reflect the valid feature
    expect(averages.hr_mtu).toBe(30000);
  });

  it('geometry filter → quality index pipeline works correctly', () => {
    const features = [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: [
            // Large polygon (10x10 area)
            [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
            // Tiny island (1x1 area, 1% of max)
            [[[20, 20], [21, 20], [21, 21], [20, 21], [20, 20]]],
          ],
        },
        properties: {
          pno: '00100',
          nimi: 'Test',
          namn: 'Test',
          he_vakiy: 1000,
          hr_mtu: 30000,
          unemployment_rate: 10,
        },
      },
    ] as Feature[];

    // Step 1: Filter islands
    const filtered = filterSmallIslands(features);
    expect(filtered[0].geometry.type).toBe('Polygon'); // Tiny island removed

    // Step 2: Compute quality indices on filtered features
    computeQualityIndices(filtered);
    expect(filtered[0].properties!.quality_index).not.toBeNull();
  });
});
