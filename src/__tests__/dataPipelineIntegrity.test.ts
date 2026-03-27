import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices, getDefaultWeights, type QualityWeights } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';
import { computeMatchingPnos } from '../utils/filterUtils';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

/**
 * Integration test: validates the full data processing pipeline
 * as executed in useMapData: filterIslands → qualityIndices → changeMetrics → quickWinMetrics → metroAverages
 */

function makeFeature(props: Partial<NeighborhoodProperties>, geom?: GeoJSON.Geometry): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki_metro',
      he_vakiy: 5000, ...props,
    } as NeighborhoodProperties,
    geometry: geom ?? {
      type: 'Polygon',
      coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]],
    },
  };
}

function buildRealisticDataset(): GeoJSON.Feature[] {
  return [
    makeFeature({
      pno: '00100', nimi: 'Kruununhaka',
      he_vakiy: 8000, hr_mtu: 45000, hr_ktu: 50000,
      unemployment_rate: 3, higher_education_rate: 70,
      ko_ika18y: 6500, ko_yl_kork: 3000, ko_al_kork: 1500,
      pt_tyott: 200, pt_vakiy: 7000, pt_tyoll: 5800,
      te_omis_as: 1200, te_taly: 4000, te_vuok_as: 2500,
      he_0_2: 200, he_3_6: 250, pinta_ala: 1_500_000,
      ra_pt_as: 50, ra_asunn: 3000,
      crime_index: 80, transit_stop_density: 100, air_quality_index: 30,
      healthcare_density: 8, school_density: 5, daycare_density: 6, grocery_density: 4,
      property_price_sqm: 7000, foreign_language_pct: 12,
      income_history: JSON.stringify([[2020, 40000], [2023, 45000]]),
      population_history: JSON.stringify([[2020, 7500], [2023, 8000]]),
      he_18_19: 100, he_20_24: 500, he_25_29: 800,
      he_naiset: 4200, he_miehet: 3800,
      he_65_69: 400, he_70_74: 300, he_75_79: 200, he_80_84: 100, he_85_: 50,
      te_eil_np: 300, te_laps: 800,
      tp_tyopy: 5000, tp_j_info: 500, tp_q_terv: 400,
    }),
    makeFeature({
      pno: '01600', nimi: 'Mellunmäki',
      he_vakiy: 12000, hr_mtu: 22000, hr_ktu: 24000,
      unemployment_rate: 12, higher_education_rate: 25,
      ko_ika18y: 9000, ko_yl_kork: 1000, ko_al_kork: 1200,
      pt_tyott: 1200, pt_vakiy: 10000, pt_tyoll: 7000,
      te_omis_as: 2000, te_taly: 5500, te_vuok_as: 3000,
      he_0_2: 600, he_3_6: 700, pinta_ala: 3_000_000,
      ra_pt_as: 200, ra_asunn: 4500,
      crime_index: 120, transit_stop_density: 30, air_quality_index: 38,
      healthcare_density: 3, school_density: 2, daycare_density: 3, grocery_density: 2,
      property_price_sqm: 2500, foreign_language_pct: 35,
      income_history: JSON.stringify([[2020, 20000], [2023, 22000]]),
      population_history: JSON.stringify([[2020, 11000], [2023, 12000]]),
      he_18_19: 300, he_20_24: 1000, he_25_29: 1200,
      he_naiset: 6200, he_miehet: 5800,
      he_65_69: 600, he_70_74: 500, he_75_79: 400, he_80_84: 200, he_85_: 100,
      te_eil_np: 800, te_laps: 1500,
      tp_tyopy: 3000, tp_j_info: 100, tp_q_terv: 600,
    }),
    makeFeature({
      pno: '02100', nimi: 'Tapiola',
      he_vakiy: 10000, hr_mtu: 38000, hr_ktu: 42000,
      unemployment_rate: 5, higher_education_rate: 55,
      ko_ika18y: 8000, ko_yl_kork: 2500, ko_al_kork: 1900,
      pt_tyott: 400, pt_vakiy: 8500, pt_tyoll: 7200,
      te_omis_as: 3000, te_taly: 4500, te_vuok_as: 1200,
      he_0_2: 400, he_3_6: 450, pinta_ala: 4_000_000,
      ra_pt_as: 500, ra_asunn: 3500,
      crime_index: 40, transit_stop_density: 60, air_quality_index: 24,
      healthcare_density: 6, school_density: 4, daycare_density: 5, grocery_density: 3,
      property_price_sqm: 5000, foreign_language_pct: 8,
      income_history: JSON.stringify([[2020, 35000], [2023, 38000]]),
      population_history: JSON.stringify([[2020, 9500], [2023, 10000]]),
      he_18_19: 150, he_20_24: 600, he_25_29: 700,
      he_naiset: 5100, he_miehet: 4900,
      he_65_69: 500, he_70_74: 400, he_75_79: 300, he_80_84: 150, he_85_: 80,
      te_eil_np: 400, te_laps: 1000,
      tp_tyopy: 4000, tp_j_info: 800, tp_q_terv: 300,
    }),
  ];
}

describe('full data pipeline integration', () => {
  it('pipeline: filterIslands → qualityIndices → changeMetrics → quickWin → metroAvg', () => {
    const features = buildRealisticDataset();

    // Step 1: Filter islands (no MultiPolygons here, so pass-through)
    const filtered = filterSmallIslands(features);
    expect(filtered.length).toBe(3);

    // Step 2: Quality indices
    computeQualityIndices(filtered);
    for (const f of filtered) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).toBeTypeOf('number');
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }

    // Tapiola (lowest crime, decent income, good transit) should score higher than Mellunmäki
    const tapiola = filtered.find(f => (f.properties as NeighborhoodProperties).pno === '02100')!;
    const mellunmaki = filtered.find(f => (f.properties as NeighborhoodProperties).pno === '01600')!;
    expect((tapiola.properties as NeighborhoodProperties).quality_index!)
      .toBeGreaterThan((mellunmaki.properties as NeighborhoodProperties).quality_index!);

    // Step 3: Change metrics
    computeChangeMetrics(filtered);
    for (const f of filtered) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.income_change_pct).toBeTypeOf('number');
      expect(p.population_change_pct).toBeTypeOf('number');
    }

    // Step 4: Quick-win metrics
    computeQuickWinMetrics(filtered);
    for (const f of filtered) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.youth_ratio_pct).toBeTypeOf('number');
      expect(p.gender_ratio).toBeTypeOf('number');
      expect(p.elderly_ratio_pct).toBeTypeOf('number');
      expect(p.employment_rate).toBeTypeOf('number');
    }

    // Step 5: Metro averages
    const avg = computeMetroAverages(filtered);
    expect(avg.he_vakiy).toBe(30000); // 8000 + 12000 + 10000
    expect(avg.hr_mtu).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeGreaterThan(0);
    expect(avg.higher_education_rate).toBeGreaterThan(0);
  });

  it('quality index rankings change with custom weights', () => {
    const features = buildRealisticDataset();
    computeQualityIndices(features);

    const getQI = (pno: string) =>
      (features.find(f => (f.properties as NeighborhoodProperties).pno === pno)!.properties as NeighborhoodProperties).quality_index!;

    // Verify default weights produce valid scores before switching
    expect(getQI('00100')).toBeGreaterThanOrEqual(0);
    expect(getQI('01600')).toBeGreaterThanOrEqual(0);

    // Now recompute with only safety weight (crime_index inverted)
    const safetyOnly: QualityWeights = {};
    for (const f of Object.keys(getDefaultWeights())) safetyOnly[f] = 0;
    safetyOnly['safety'] = 100;

    computeQualityIndices(features, safetyOnly);
    // Tapiola has lowest crime → should be ranked #1
    expect(getQI('02100')).toBe(100);
    expect(getQI('01600')).toBe(0); // highest crime

    // With only employment weight
    const employmentOnly: QualityWeights = {};
    for (const f of Object.keys(getDefaultWeights())) employmentOnly[f] = 0;
    employmentOnly['employment'] = 100;

    computeQualityIndices(features, employmentOnly);
    // Kruununhaka has lowest unemployment (3%) → best
    expect(getQI('00100')).toBe(100);
    // Mellunmäki has highest unemployment (12%) → worst
    expect(getQI('01600')).toBe(0);
  });

  it('filter → similarity pipeline works end-to-end', () => {
    const features = buildRealisticDataset();
    computeQualityIndices(features);
    computeQuickWinMetrics(features);

    // Filter to find areas with low unemployment
    const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
    const matching = computeMatchingPnos(data, [
      { layerId: 'unemployment', min: 1, max: 6 },
    ]);
    // Kruununhaka (3%) and Tapiola (5%) match, Mellunmäki (12%) doesn't
    expect(matching.has('00100')).toBe(true);
    expect(matching.has('02100')).toBe(true);
    expect(matching.has('01600')).toBe(false);

    // Find neighborhoods similar to Tapiola
    const tapiolaProps = features.find(f =>
      (f.properties as NeighborhoodProperties).pno === '02100',
    )!.properties as NeighborhoodProperties;

    const similar = findSimilarNeighborhoods(tapiolaProps, features, 2);
    expect(similar.length).toBe(2);
    // Kruununhaka should be more similar to Tapiola than Mellunmäki
    expect(similar[0].properties.pno).toBe('00100');
  });

  it('no NaN values leak through the entire pipeline', () => {
    const features = buildRealisticDataset();
    filterSmallIslands(features);
    computeQualityIndices(features);
    computeChangeMetrics(features);
    computeQuickWinMetrics(features);
    const avg = computeMetroAverages(features);

    // Check no NaN in quality indices
    for (const f of features) {
      const p = f.properties as NeighborhoodProperties;
      if (p.quality_index != null) {
        expect(Number.isNaN(p.quality_index)).toBe(false);
      }
    }

    // Check no NaN in metro averages
    for (const entry of Object.entries(avg)) {
      const value = entry[1];
      expect(Number.isNaN(value)).toBe(false);
    }
  });
});
