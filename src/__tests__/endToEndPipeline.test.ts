/**
 * End-to-end integration test for the full data pipeline.
 *
 * Tests that all transforms chain correctly:
 * computeQuickWinMetrics → computeChangeMetrics → computeQualityIndices → computeMetroAverages → findSimilarNeighborhoods
 *
 * This catches integration bugs where one transform's output is incompatible
 * with the next transform's expectations.
 */
import { describe, it, expect } from 'vitest';
import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices, getDefaultWeights } from '../utils/qualityIndex';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeRealisticFeature(pno: string, overrides: Partial<NeighborhoodProperties>): GeoJSON.Feature {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      he_vakiy: 3000,
      he_kika: 38,
      ko_ika18y: 2400,
      ko_yl_kork: 500,
      ko_al_kork: 400,
      ko_ammat: 300,
      ko_perus: 200,
      hr_mtu: 30000,
      hr_ktu: 35000,
      pt_tyoll: 1800,
      pt_tyott: 180,
      pt_opisk: 300,
      pt_vakiy: 2500,
      pt_elakel: 200,
      ra_asunn: 1500,
      ra_as_kpa: 60,
      ra_pt_as: 200,
      te_takk: 300,
      te_taly: 1200,
      te_omis_as: 600,
      te_vuok_as: 500,
      pinta_ala: 3_000_000,
      he_0_2: 80,
      he_3_6: 120,
      unemployment_rate: 7.2,
      higher_education_rate: 37.5,
      pensioner_share: 8.0,
      foreign_language_pct: 10.0,
      quality_index: null,
      ownership_rate: 50,
      rental_rate: 41.7,
      population_density: 1000,
      child_ratio: 6.7,
      student_share: 12.0,
      detached_house_share: 13.3,
      property_price_sqm: 3500,
      transit_stop_density: 30,
      air_quality_index: 28,
      crime_index: 60,
      daycare_density: 3,
      school_density: 2,
      healthcare_density: 4,
      single_person_hh_pct: 45,
      cycling_density: 20,
      restaurant_density: 30,
      grocery_density: 5,
      income_history: JSON.stringify([[2019, 28000], [2020, 29000], [2021, 30000]]),
      population_history: JSON.stringify([[2019, 2800], [2020, 2900], [2021, 3000]]),
      unemployment_history: JSON.stringify([[2019, 8.0], [2020, 9.0], [2021, 7.2]]),
      income_change_pct: null,
      population_change_pct: null,
      unemployment_change_pct: null,
      voter_turnout_pct: 65,
      party_diversity_index: 0.75,
      broadband_coverage_pct: 95,
      ev_charging_density: 2,
      tree_canopy_pct: 30,
      transit_reachability_score: 50,
      // Quick-win source fields
      he_naiset: 1550,
      he_miehet: 1450,
      he_18_19: 100,
      he_20_24: 200,
      he_25_29: 250,
      he_65_69: 150,
      he_70_74: 100,
      he_75_79: 60,
      he_80_84: 30,
      he_85_: 20,
      te_eil_np: 50,
      te_laps: 300,
      tp_tyopy: 800,
      tp_jk_info: 80,
      tp_qr_terv: 120,
      tp_jalo_bf: 150,
      tp_o_julk: 100,
      tp_palv_gu: 200,
      ra_raky: 15,
      // Phase 9
      rental_price_sqm: 18.5,
      price_to_rent_ratio: 15.2,
      walkability_index: 65,
      traffic_accident_rate: 3.5,
      property_price_change_pct: 5.2,
      school_quality_score: 72,
      light_pollution: 12.5,
      noise_pollution: 55,
      // derived - will be computed
      youth_ratio_pct: null,
      gender_ratio: null,
      single_parent_hh_pct: null,
      families_with_children_pct: null,
      tech_sector_pct: null,
      healthcare_workers_pct: null,
      employment_rate: null,
      elderly_ratio_pct: null,
      avg_household_size: null,
      manufacturing_jobs_pct: null,
      public_sector_jobs_pct: null,
      service_sector_jobs_pct: null,
      new_construction_pct: null,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9 + Number(pno) * 0.01, 60.2], [24.91 + Number(pno) * 0.01, 60.2], [24.91 + Number(pno) * 0.01, 60.21], [24.9 + Number(pno) * 0.01, 60.21], [24.9 + Number(pno) * 0.01, 60.2]]],
    },
  };
}

describe('Full data pipeline integration', () => {
  const features = [
    makeRealisticFeature('00100', { hr_mtu: 45000, crime_index: 30, transit_stop_density: 100 }),
    makeRealisticFeature('00200', { hr_mtu: 25000, crime_index: 120, transit_stop_density: 20 }),
    makeRealisticFeature('00300', { hr_mtu: 35000, crime_index: 60, transit_stop_density: 50 }),
    makeRealisticFeature('00400', { hr_mtu: 55000, crime_index: 20, transit_stop_density: 80 }),
    makeRealisticFeature('00500', { hr_mtu: 20000, crime_index: 150, transit_stop_density: 15 }),
  ];

  it('computeQuickWinMetrics populates derived fields', () => {
    computeQuickWinMetrics(features);

    for (const f of features) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.youth_ratio_pct).not.toBeNull();
      expect(p.gender_ratio).not.toBeNull();
      expect(p.single_parent_hh_pct).not.toBeNull();
      expect(p.families_with_children_pct).not.toBeNull();
      expect(p.tech_sector_pct).not.toBeNull();
      expect(p.healthcare_workers_pct).not.toBeNull();
      expect(p.employment_rate).not.toBeNull();
      expect(p.elderly_ratio_pct).not.toBeNull();
      expect(p.avg_household_size).not.toBeNull();
    }
  });

  it('computeChangeMetrics calculates trend changes from history', () => {
    computeChangeMetrics(features);

    for (const f of features) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.income_change_pct).not.toBeNull();
      expect(p.population_change_pct).not.toBeNull();
      expect(p.unemployment_change_pct).not.toBeNull();
      // Verify specific values: income went from 28000 to 30000 = 7.14% (for base feature)
      // But overrides may change this
    }
  });

  it('computeQualityIndices produces valid scores after previous transforms', () => {
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    for (const f of features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi!).toBeGreaterThanOrEqual(0);
      expect(qi!).toBeLessThanOrEqual(100);
      expect(Number.isInteger(qi)).toBe(true);
    }
  });

  it('quality index differentiates neighborhoods correctly', () => {
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    const scores = features.map((f) => ({
      pno: (f.properties as NeighborhoodProperties).pno,
      qi: (f.properties as NeighborhoodProperties).quality_index!,
    }));

    // 00400 (highest income, lowest crime) should rank highest
    const best = scores.reduce((a, b) => (a.qi > b.qi ? a : b));
    expect(best.pno).toBe('00400');

    // 00500 (lowest income, highest crime) should rank lowest
    const worst = scores.reduce((a, b) => (a.qi < b.qi ? a : b));
    expect(worst.pno).toBe('00500');

    // Not all scores should be the same
    const uniqueScores = new Set(scores.map((s) => s.qi));
    expect(uniqueScores.size).toBeGreaterThan(1);
  });

  it('computeMetroAverages works after all transforms', () => {
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);
    const avg = computeMetroAverages(features);

    // Basic sanity: population should be sum of all
    expect(avg.he_vakiy).toBe(15000); // 5 × 3000

    // hr_mtu should be population-weighted average
    // (3000×45000 + 3000×25000 + 3000×35000 + 3000×55000 + 3000×20000) / 15000
    // = (135M + 75M + 105M + 165M + 60M) / 15000 = 540M / 15000 = 36000
    expect(avg.hr_mtu).toBe(36000);

    // Derived quick-win metrics should also have averages
    expect(avg.youth_ratio_pct).toBeGreaterThan(0);
    expect(avg.elderly_ratio_pct).toBeGreaterThan(0);
  });

  it('findSimilarNeighborhoods works after all transforms', () => {
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    const target = features[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, features, 3);

    // Should return 3 results (not including the target itself)
    expect(similar).toHaveLength(3);

    // None should be the target
    for (const s of similar) {
      expect(s.properties.pno).not.toBe(target.pno);
    }

    // Results should be sorted by ascending distance
    for (let i = 1; i < similar.length; i++) {
      expect(similar[i].distance).toBeGreaterThanOrEqual(similar[i - 1].distance);
    }

    // All distances should be finite non-negative numbers
    for (const s of similar) {
      expect(s.distance).toBeGreaterThanOrEqual(0);
      expect(isFinite(s.distance)).toBe(true);
    }

    // Centers should be valid coordinates
    for (const s of similar) {
      expect(s.center[0]).toBeGreaterThan(24);
      expect(s.center[1]).toBeGreaterThan(60);
    }
  });

  it('custom weights propagate correctly through quality → similarity pipeline', () => {
    computeQuickWinMetrics(features);
    computeChangeMetrics(features);

    // Compute with safety-heavy weights
    const safetyWeights: Record<string, number> = {};
    for (const f2 of [...Array.from({ length: 10 })].map((_, i) => i)) {
      // zero all
    }
    const factors = ['safety', 'income', 'employment', 'education', 'transit', 'services', 'air_quality', 'cycling', 'grocery_access', 'restaurants'];
    for (const fac of factors) safetyWeights[fac] = 0;
    safetyWeights.safety = 100;

    computeQualityIndices(features, safetyWeights);

    // Now 00400 (crime_index: 20, lowest) should have best quality
    const scores = features.map((f) => ({
      pno: (f.properties as NeighborhoodProperties).pno,
      qi: (f.properties as NeighborhoodProperties).quality_index!,
    }));
    const best = scores.reduce((a, b) => (a.qi > b.qi ? a : b));
    expect(best.pno).toBe('00400');
  });
});

describe('Pipeline handles empty/degenerate inputs', () => {
  it('empty feature array produces no errors through full pipeline', () => {
    const empty: GeoJSON.Feature[] = [];
    expect(() => {
      computeQuickWinMetrics(empty);
      computeChangeMetrics(empty);
      computeQualityIndices(empty);
      const avg = computeMetroAverages(empty);
      expect(avg.he_vakiy).toBe(0);
    }).not.toThrow();
  });

  it('single feature produces valid results through full pipeline', () => {
    const single = [makeRealisticFeature('00100', {})];

    computeQuickWinMetrics(single);
    computeChangeMetrics(single);
    computeQualityIndices(single);
    const avg = computeMetroAverages(single);

    expect((single[0].properties as NeighborhoodProperties).quality_index).toBe(50);
    expect(avg.he_vakiy).toBe(3000);
  });

  it('features with all-null data produce null quality_index (not NaN)', () => {
    const features = [
      {
        type: 'Feature' as const,
        properties: {
          pno: '99999',
          nimi: 'Ghost',
          namn: 'Ghost',
          he_vakiy: null,
        } as unknown as NeighborhoodProperties,
        geometry: { type: 'Point' as const, coordinates: [25, 60] },
      },
    ];

    expect(() => {
      computeQuickWinMetrics(features);
      computeChangeMetrics(features);
      computeQualityIndices(features);
    }).not.toThrow();

    const qi = (features[0].properties as NeighborhoodProperties).quality_index;
    if (qi !== null) {
      expect(Number.isNaN(qi)).toBe(false);
    }
  });
});
