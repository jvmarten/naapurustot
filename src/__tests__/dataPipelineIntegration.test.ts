/**
 * Integration test — full data pipeline from raw feature properties
 * through quality index computation, quick-win metrics, change metrics,
 * metro averages, and metro area feature building.
 *
 * Verifies that modules compose correctly end-to-end and that
 * data flows without corruption between processing stages.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeQualityIndices,
  getQualityCategory,
} from '../utils/qualityIndex';
import {
  computeQuickWinMetrics,
  computeChangeMetrics,
  computeMetroAverages,
} from '../utils/metrics';
import {
  buildMetroAreaFeatures,
  clearMetroAreaCache,
} from '../utils/metroAreas';
import { filterSmallIslands } from '../utils/geometryFilter';
import { findSimilarNeighborhoods } from '../utils/similarity';
import { computeMatchingPnos } from '../utils/filterUtils';
import type { NeighborhoodProperties } from '../utils/metrics';
import type { Feature, Polygon } from 'geojson';

function makeFeature(pno: string, city: string, props: Partial<NeighborhoodProperties>): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]],
    },
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: '091',
      city,
      he_vakiy: 5000,
      he_kika: 38,
      hr_mtu: 35000,
      hr_ktu: 40000,
      ko_yl_kork: 500,
      ko_al_kork: 300,
      ko_ika18y: 4000,
      ko_ammat: 1000,
      ko_perus: 500,
      pt_tyoll: 3000,
      pt_tyott: 200,
      pt_opisk: 500,
      pt_vakiy: 4200,
      pt_elakel: 800,
      ra_asunn: 2500,
      ra_as_kpa: 65,
      ra_pt_as: 200,
      te_takk: 400,
      te_taly: 2000,
      te_omis_as: 1200,
      te_vuok_as: 700,
      pinta_ala: 2_000_000,
      he_0_2: 150,
      he_3_6: 200,
      unemployment_rate: 4.8,
      higher_education_rate: 20.0,
      property_price_sqm: 4500,
      transit_stop_density: 12.5,
      air_quality_index: 3.2,
      crime_index: 15,
      daycare_density: 2.1,
      school_density: 1.8,
      healthcare_density: 3.5,
      grocery_density: 4.2,
      restaurant_density: 8.0,
      cycling_density: 5.0,
      sports_facility_density: 1.5,
      foreign_language_pct: 12,
      single_person_hh_pct: 45,
      ownership_rate: 60,
      rental_rate: 35,
      population_density: 2500,
      child_ratio: 7,
      student_share: 12,
      detached_house_share: 8,
      pensioner_share: 16,
      // Demographics for quick-win metrics
      he_naiset: 2600,
      he_miehet: 2400,
      he_18_19: 200,
      he_20_24: 400,
      he_25_29: 350,
      he_65_69: 300,
      he_70_74: 200,
      he_75_79: 150,
      he_80_84: 100,
      he_85_: 50,
      te_eil_np: 100,
      te_laps: 500,
      tp_tyopy: 3000,
      tp_j_info: 300,
      tp_q_terv: 450,
      tp_jalo_bf: 200,
      tp_o_julk: 150,
      tp_palv_gu: 1000,
      ra_raky: 15,
      income_history: JSON.stringify([[2020, 32000], [2021, 33000], [2022, 34000], [2023, 35000]]),
      population_history: JSON.stringify([[2020, 4800], [2021, 4900], [2022, 4950], [2023, 5000]]),
      ...props,
    } as NeighborhoodProperties,
  };
}

describe('Full data pipeline integration', () => {
  let features: Feature[];

  beforeEach(() => {
    clearMetroAreaCache();
    features = [
      makeFeature('00100', 'helsinki_metro', { hr_mtu: 45000, crime_index: 5, transit_stop_density: 20 }),
      makeFeature('00200', 'helsinki_metro', { hr_mtu: 25000, crime_index: 30, transit_stop_density: 8 }),
      makeFeature('00300', 'helsinki_metro', { hr_mtu: 35000, crime_index: 15, transit_stop_density: 15 }),
      makeFeature('20100', 'turku', { hr_mtu: 30000, crime_index: 10, transit_stop_density: 10 }),
      makeFeature('20200', 'turku', { hr_mtu: 28000, crime_index: 12, transit_stop_density: 9 }),
    ];
  });

  it('stage 1: filterSmallIslands preserves all features (no MultiPolygons)', () => {
    const filtered = filterSmallIslands(features);
    expect(filtered).toHaveLength(5);
    // Same references since no MultiPolygon features
    for (let i = 0; i < 5; i++) {
      expect(filtered[i]).toBe(features[i]);
    }
  });

  it('stage 2: computeQuickWinMetrics derives demographic metrics', () => {
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.youth_ratio_pct).toBeTypeOf('number');
    expect(p.gender_ratio).toBeTypeOf('number');
    expect(p.elderly_ratio_pct).toBeTypeOf('number');
    expect(p.avg_household_size).toBeTypeOf('number');
    expect(p.employment_rate).toBeTypeOf('number');
    expect(p.tech_sector_pct).toBeTypeOf('number');
  });

  it('stage 3: computeChangeMetrics derives trend changes', () => {
    computeChangeMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(p.income_change_pct).toBeTypeOf('number');
    expect(p.population_change_pct).toBeTypeOf('number');
    // Should be positive (values increased over time)
    expect(p.income_change_pct!).toBeGreaterThan(0);
    expect(p.population_change_pct!).toBeGreaterThan(0);
  });

  it('stage 4: computeQualityIndices produces valid 0-100 scores', () => {
    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).toBeTypeOf('number');
      expect(qi!).toBeGreaterThanOrEqual(0);
      expect(qi!).toBeLessThanOrEqual(100);
    }
  });

  it('stage 4b: quality index ranking makes sense', () => {
    computeQualityIndices(features);

    const scores = features.map(f => ({
      pno: (f.properties as NeighborhoodProperties).pno,
      qi: (f.properties as NeighborhoodProperties).quality_index!,
    }));

    // 00100 has highest income (45000) and lowest crime (5) → should rank highest
    const best = scores.find(s => s.pno === '00100')!;
    // 00200 has lowest income (25000) and highest crime (30) → should rank lowest
    const worst = scores.find(s => s.pno === '00200')!;
    expect(best.qi).toBeGreaterThan(worst.qi);
  });

  it('stage 5: computeMetroAverages produces population-weighted stats', () => {
    computeQualityIndices(features);
    const avg = computeMetroAverages(features);

    expect(avg.he_vakiy).toBe(25000); // 5 × 5000
    expect(avg.hr_mtu).toBeTypeOf('number');
    expect(avg.hr_mtu).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeTypeOf('number');
    expect(avg.higher_education_rate).toBeTypeOf('number');
  });

  it('stage 6: buildMetroAreaFeatures produces city-level aggregation', () => {
    computeQualityIndices(features);
    const result = buildMetroAreaFeatures(features);

    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(2); // helsinki_metro, turku

    const helsinki = result!.features.find(f => f.properties!.city === 'helsinki_metro')!;
    const turku = result!.features.find(f => f.properties!.city === 'turku')!;

    expect(helsinki.properties!._isMetroArea).toBe(true);
    expect(turku.properties!._isMetroArea).toBe(true);

    // Helsinki has 3 neighborhoods × 5000 = 15000 total pop
    expect(helsinki.properties!.he_vakiy).toBe(15000);
    // Turku has 2 neighborhoods × 5000 = 10000 total pop
    expect(turku.properties!.he_vakiy).toBe(10000);
  });

  it('stage 7: similarity search works on processed data', () => {
    computeQualityIndices(features);
    const target = features[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, features, 3);

    expect(similar).toHaveLength(3); // 4 other features, requesting top 3
    // Should not include the target itself
    for (const s of similar) {
      expect(s.properties.pno).not.toBe('00100');
    }
    // Should be sorted by ascending distance
    for (let i = 1; i < similar.length; i++) {
      expect(similar[i].distance).toBeGreaterThanOrEqual(similar[i - 1].distance);
    }
  });

  it('stage 8: filter matching works on processed data', () => {
    computeQualityIndices(features);
    const data = { type: 'FeatureCollection' as const, features };

    // Filter for high-quality neighborhoods
    const result = computeMatchingPnos(data, [{
      layerId: 'quality_index',
      min: 60,
      max: 100,
    }]);

    // At least one should match, not all (otherwise the filter is useless)
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBeLessThan(5);
  });

  it('full pipeline: quality index recomputation with custom weights invalidates metro cache', () => {
    computeQualityIndices(features);
    const result1 = buildMetroAreaFeatures(features);
    const qi1 = result1!.features[0].properties!.quality_index;

    // Recompute with custom weights (only safety matters)
    const safetyOnly = Object.fromEntries(
      ['safety', 'income', 'employment', 'education', 'transit', 'services', 'air_quality', 'cycling', 'grocery_access', 'restaurants']
        .map(id => [id, id === 'safety' ? 100 : 0])
    );
    clearMetroAreaCache(); // Must clear before recompute
    computeQualityIndices(features, safetyOnly);
    const result2 = buildMetroAreaFeatures(features);
    const qi2 = result2!.features[0].properties!.quality_index;

    // Quality index should be different with different weights
    expect(qi1).not.toBe(qi2);
  });

  it('pipeline handles feature with all null optional properties', () => {
    const sparseFeature = makeFeature('00400', 'helsinki_metro', {
      hr_mtu: null,
      crime_index: null,
      transit_stop_density: null,
      air_quality_index: null,
      unemployment_rate: null,
      higher_education_rate: null,
      healthcare_density: null,
      school_density: null,
      daycare_density: null,
      grocery_density: null,
    });
    const allFeatures = [...features, sparseFeature];

    computeQuickWinMetrics(allFeatures);
    computeChangeMetrics(allFeatures);
    computeQualityIndices(allFeatures);

    // Sparse feature should have null quality_index (no data for any factor)
    const sparseQI = (sparseFeature.properties as NeighborhoodProperties).quality_index;
    // It may not be null if it falls back to averages, but it should not be NaN
    if (sparseQI !== null) {
      expect(isFinite(sparseQI)).toBe(true);
    }

    // Other features should still have valid scores
    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(isFinite(qi!)).toBe(true);
    }
  });
});
