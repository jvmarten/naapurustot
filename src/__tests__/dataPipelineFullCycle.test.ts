/**
 * Full-cycle integration tests for the data processing pipeline.
 *
 * Tests the complete chain: raw properties → coercion → island filtering →
 * quality indices → change metrics → quick-win metrics → metro averages.
 *
 * This catches regressions where individual functions work in isolation
 * but the combined pipeline produces wrong results (e.g., quality indices
 * computed before change metrics are available).
 */
import { describe, it, expect } from 'vitest';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';
import type { Feature, FeatureCollection } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

function makeFeature(pno: string, props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]]],
    },
    properties: { pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, kunta: '091', city: 'helsinki_metro', ...props },
  };
}

/**
 * Replicate the exact processing pipeline from dataLoader.ts processTopology.
 */
function processFeatures(features: Feature[]): { data: FeatureCollection; metroAverages: Record<string, number> } {
  // Step 1: Numeric coercion (simulated)
  const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);
  for (const feat of features) {
    if (!feat.properties) continue;
    for (const key of Object.keys(feat.properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = feat.properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) feat.properties[key] = num;
      }
    }
  }

  // Step 2: Island filtering
  features = filterSmallIslands(features);

  // Step 3: Quality indices
  computeQualityIndices(features);

  // Step 4: Change metrics
  computeChangeMetrics(features);

  // Step 5: Quick-win metrics
  computeQuickWinMetrics(features);

  // Step 6: Metro averages
  const metroAverages = computeMetroAverages(features);

  return {
    data: { type: 'FeatureCollection', features },
    metroAverages,
  };
}

describe('full data pipeline integration', () => {
  it('produces valid quality indices from realistic data', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: 5000, hr_mtu: 35000, unemployment_rate: 5,
        higher_education_rate: 55, crime_index: 8, transit_stop_density: 12,
        air_quality_index: 3, healthcare_density: 2, school_density: 1.5,
        daycare_density: 1.8, grocery_density: 2.5,
        pt_tyott: 250, ko_yl_kork: 1500, ko_al_kork: 1250, ko_ika18y: 4000,
        te_omis_as: 1500, te_taly: 2000, te_vuok_as: 400,
        pt_opisk: 500, pt_vakiy: 4000, he_0_2: 200, he_3_6: 300,
        pinta_ala: 2000000, ra_pt_as: 100, ra_asunn: 2500,
        pt_elakel: 500,
      }),
      makeFeature('00200', {
        he_vakiy: 3000, hr_mtu: 25000, unemployment_rate: 12,
        higher_education_rate: 30, crime_index: 25, transit_stop_density: 5,
        air_quality_index: 8, healthcare_density: 0.5, school_density: 0.5,
        daycare_density: 0.5, grocery_density: 1,
        pt_tyott: 360, ko_yl_kork: 500, ko_al_kork: 400, ko_ika18y: 2400,
        te_omis_as: 400, te_taly: 1200, te_vuok_as: 600,
        pt_opisk: 200, pt_vakiy: 2400, he_0_2: 100, he_3_6: 150,
        pinta_ala: 3000000, ra_pt_as: 200, ra_asunn: 1500,
        pt_elakel: 300,
      }),
    ];

    const result = processFeatures(features);

    // Quality indices should be assigned
    for (const f of result.data.features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }

    // Feature 1 (higher income, lower crime, better services) should score higher
    const qi1 = (result.data.features[0].properties as NeighborhoodProperties).quality_index!;
    const qi2 = (result.data.features[1].properties as NeighborhoodProperties).quality_index!;
    expect(qi1).toBeGreaterThan(qi2);
  });

  it('produces valid metro averages from the pipeline output', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: 2000, hr_mtu: 30000, unemployment_rate: 6,
        pt_tyott: 120, pt_vakiy: 1600, ko_yl_kork: 400, ko_al_kork: 200,
        ko_ika18y: 1500, te_omis_as: 500, te_taly: 800,
        te_vuok_as: 250, pt_opisk: 150, he_0_2: 80, he_3_6: 100,
        pinta_ala: 1000000, ra_pt_as: 50, ra_asunn: 1000, pt_elakel: 200,
      }),
      makeFeature('00200', {
        he_vakiy: 3000, hr_mtu: 40000, unemployment_rate: 4,
        pt_tyott: 120, pt_vakiy: 2400, ko_yl_kork: 600, ko_al_kork: 400,
        ko_ika18y: 2300, te_omis_as: 800, te_taly: 1200,
        te_vuok_as: 300, pt_opisk: 200, he_0_2: 120, he_3_6: 180,
        pinta_ala: 2000000, ra_pt_as: 100, ra_asunn: 1500, pt_elakel: 300,
      }),
    ];

    const result = processFeatures(features);

    // Metro averages should include key metrics
    expect(result.metroAverages.he_vakiy).toBe(5000);
    // Unemployment: (120+120) / (1600+2400) * 100 = 6%
    expect(result.metroAverages.unemployment_rate).toBeCloseTo(6.0, 1);
    // Higher ed: (400+200+600+400) / (1500+2300) * 100 = 42.1%
    expect(result.metroAverages.higher_education_rate).toBeCloseTo(42.1, 1);
  });

  it('handles string-typed numeric properties via coercion', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: '3000', hr_mtu: '35000', unemployment_rate: '5',
        higher_education_rate: '50', crime_index: '10',
        pt_tyott: '150', pt_vakiy: '2400', ko_yl_kork: '800', ko_al_kork: '700',
        ko_ika18y: '2400', te_taly: '1200',
      }),
      makeFeature('00200', {
        he_vakiy: '2000', hr_mtu: '25000', unemployment_rate: '10',
        higher_education_rate: '30', crime_index: '20',
        pt_tyott: '200', pt_vakiy: '1600', ko_yl_kork: '300', ko_al_kork: '200',
        ko_ika18y: '1600', te_taly: '800',
      }),
    ];

    const result = processFeatures(features);

    // After coercion, quality indices should work
    for (const f of result.data.features) {
      const qi = (f.properties as NeighborhoodProperties).quality_index;
      expect(qi).not.toBeNull();
    }
    // PNO should NOT be coerced to number
    expect(typeof result.data.features[0].properties!.pno).toBe('string');
  });

  it('computes change metrics from history arrays in the pipeline', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: 1000,
        income_history: JSON.stringify([[2018, 30000], [2020, 33000]]),
        population_history: JSON.stringify([[2018, 900], [2020, 1000]]),
        unemployment_history: JSON.stringify([[2018, 8], [2020, 6]]),
      }),
    ];

    const result = processFeatures(features);
    const p = result.data.features[0].properties as NeighborhoodProperties;

    // Income change: (33000-30000)/30000*100 = 10%
    expect(p.income_change_pct).toBeCloseTo(10, 1);
    // Population change: (1000-900)/900*100 ≈ 11.1%
    expect(p.population_change_pct).toBeCloseTo(11.1, 1);
    // Unemployment change: (6-8)/8*100 = -25%
    expect(p.unemployment_change_pct).toBeCloseTo(-25, 1);
  });

  it('computes quick-win metrics from Paavo fields in the pipeline', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: 1000,
        he_18_19: 30, he_20_24: 80, he_25_29: 90,
        he_naiset: 520, he_miehet: 480,
        pt_tyoll: 600, pt_vakiy: 800,
        he_65_69: 40, he_70_74: 30, he_75_79: 20, he_80_84: 10, he_85_: 5,
        te_taly: 500,
        te_eil_np: 30, te_laps: 120,
        tp_tyopy: 400, tp_j_info: 80, tp_q_terv: 60,
        tp_jalo_bf: 50, tp_o_julk: 40, tp_palv_gu: 100,
        ra_raky: 10, ra_asunn: 500,
      }),
    ];

    const result = processFeatures(features);
    const p = result.data.features[0].properties as NeighborhoodProperties;

    expect(p.youth_ratio_pct).toBeCloseTo(20.0, 1); // (30+80+90)/1000*100
    expect(p.gender_ratio).toBeCloseTo(1.08, 2); // 520/480
    expect(p.employment_rate).toBeCloseTo(75.0, 1); // 600/800*100
    expect(p.elderly_ratio_pct).toBeCloseTo(10.5, 1); // (40+30+20+10+5)/1000*100
    expect(p.avg_household_size).toBe(2.0); // 1000/500
    expect(p.tech_sector_pct).toBeCloseTo(20.0, 1); // 80/400*100
    expect(p.new_construction_pct).toBeCloseTo(2.0, 1); // 10/500*100
  });
});

describe('pipeline edge cases', () => {
  it('handles empty feature array without crashing', () => {
    const result = processFeatures([]);
    expect(result.data.features).toEqual([]);
    expect(result.metroAverages.he_vakiy).toBe(0);
  });

  it('features with null properties are skipped by quality index (properties: null)', () => {
    // The real pipeline always has properties, but let's verify the coercion
    // step handles it gracefully. computeQualityIndices reads properties,
    // so null properties will throw — this is expected and caught at load time.
    const features: Feature[] = [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: null,
    }];
    // The coercion step skips null properties, but computeQualityIndices will throw
    expect(() => processFeatures(features)).toThrow();
  });

  it('handles features with all null numeric fields', () => {
    const features = [
      makeFeature('00100', {
        he_vakiy: null, hr_mtu: null, unemployment_rate: null,
      }),
    ];
    const result = processFeatures(features);
    expect((result.data.features[0].properties as NeighborhoodProperties).quality_index).toBeNull();
  });
});
