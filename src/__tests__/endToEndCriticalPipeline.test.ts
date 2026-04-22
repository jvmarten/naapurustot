import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NeighborhoodProperties } from '../utils/metrics';

/**
 * End-to-end integration test: verifies the full data pipeline from
 * raw feature properties through computed metrics, quality index,
 * filtering, similarity, and formatting.
 */
describe('end-to-end data pipeline integration', () => {
  function makeFeature(pno: string, props: Partial<NeighborhoodProperties>): GeoJSON.Feature {
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]] },
      properties: {
        pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, kunta: '091', city: 'helsinki',
        he_vakiy: 1000, hr_mtu: 30000, hr_ktu: 35000, he_kika: 38,
        ko_ika18y: 800, ko_yl_kork: 200, ko_al_kork: 100, ko_ammat: 300, ko_perus: 200,
        pt_tyoll: 500, pt_tyott: 50, pt_opisk: 80, pt_vakiy: 700, pt_elakel: 120,
        ra_asunn: 400, ra_as_kpa: 60, ra_pt_as: 50,
        te_takk: 100, te_taly: 500, te_omis_as: 250, te_vuok_as: 200,
        he_0_2: 30, he_3_6: 40, pinta_ala: 1_000_000,
        he_naiset: 520, he_miehet: 480,
        he_18_19: 30, he_20_24: 80, he_25_29: 90,
        he_65_69: 60, he_70_74: 50, he_75_79: 30, he_80_84: 15, he_85_: 10,
        te_eil_np: 40, te_laps: 80,
        tp_tyopy: 300, tp_j_info: 30, tp_q_terv: 50,
        tp_jalo_bf: 20, tp_o_julk: 25, tp_palv_gu: 100,
        ra_raky: 10,
        unemployment_rate: 7.1, higher_education_rate: 37.5, pensioner_share: 12,
        foreign_language_pct: 10, quality_index: null, ownership_rate: 50,
        rental_rate: 40, population_density: 1000, child_ratio: 7,
        student_share: 11.4, detached_house_share: 12.5,
        property_price_sqm: 4000, transit_stop_density: 20, air_quality_index: 30,
        crime_index: 50, daycare_density: 3, school_density: 2,
        healthcare_density: 3, single_person_hh_pct: 45,
        cycling_density: 10, restaurant_density: 15, grocery_density: 4,
        income_history: JSON.stringify([[2018, 28000], [2019, 29000], [2020, 30000]]),
        population_history: JSON.stringify([[2018, 950], [2019, 975], [2020, 1000]]),
        unemployment_history: JSON.stringify([[2018, 8], [2019, 7.5], [2020, 7.1]]),
        ...props,
      } as NeighborhoodProperties,
    };
  }

  it('full pipeline: computeChangeMetrics → computeQuickWinMetrics → computeQualityIndices → computeMetroAverages', async () => {
    vi.resetModules();
    const { computeChangeMetrics, computeQuickWinMetrics, computeMetroAverages } = await import('../utils/metrics');
    const { computeQualityIndices } = await import('../utils/qualityIndex');

    const features = [
      makeFeature('00100', { he_vakiy: 2000, hr_mtu: 40000, crime_index: 30, unemployment_rate: 3 }),
      makeFeature('00200', { he_vakiy: 1000, hr_mtu: 20000, crime_index: 90, unemployment_rate: 15 }),
      makeFeature('00300', { he_vakiy: 1500, hr_mtu: 30000, crime_index: 50, unemployment_rate: 7 }),
    ];

    // Step 1: Compute change metrics from trends
    computeChangeMetrics(features);
    for (const f of features) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.income_change_pct).not.toBeNull();
      expect(p.population_change_pct).not.toBeNull();
    }

    // Step 2: Compute quick-win derived metrics
    computeQuickWinMetrics(features);
    for (const f of features) {
      const p = f.properties as NeighborhoodProperties;
      expect(p.youth_ratio_pct).toBeGreaterThanOrEqual(0);
      expect(p.gender_ratio).toBeGreaterThan(0);
      expect(p.employment_rate).toBeGreaterThan(0);
    }

    // Step 3: Compute quality indices
    computeQualityIndices(features);
    const q1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const q2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    const q3 = (features[2].properties as NeighborhoodProperties).quality_index!;
    expect(q1).toBeGreaterThan(q2); // best metrics → highest score
    expect(q3).toBeGreaterThan(q2); // middle > worst
    expect(q3).toBeLessThan(q1); // middle < best

    // Step 4: Compute metro averages
    const avg = computeMetroAverages(features);
    expect(avg.he_vakiy).toBe(4500);
    // hr_mtu weighted: (40000*2000 + 20000*1000 + 30000*1500) / 4500
    const expectedIncome = (40000 * 2000 + 20000 * 1000 + 30000 * 1500) / 4500;
    expect(avg.hr_mtu).toBeCloseTo(expectedIncome, 0);
  });

  it('pipeline: similarity uses computed quality_index', async () => {
    vi.resetModules();
    const { computeQualityIndices } = await import('../utils/qualityIndex');
    const { findSimilarNeighborhoods } = await import('../utils/similarity');

    const features = [
      makeFeature('00100', { hr_mtu: 40000, crime_index: 30, unemployment_rate: 3, higher_education_rate: 60 }),
      makeFeature('00200', { hr_mtu: 40000, crime_index: 30, unemployment_rate: 3, higher_education_rate: 60 }),
      makeFeature('00300', { hr_mtu: 15000, crime_index: 100, unemployment_rate: 20, higher_education_rate: 10 }),
    ];

    computeQualityIndices(features);
    const target = features[0].properties as NeighborhoodProperties;
    const similar = findSimilarNeighborhoods(target, features, 2);

    // 00200 is identical to 00100, should be most similar
    expect(similar[0].properties.pno).toBe('00200');
    expect(similar[0].distance).toBe(0);
    // 00300 is very different
    expect(similar[1].properties.pno).toBe('00300');
    expect(similar[1].distance).toBeGreaterThan(0);
  });

  it('pipeline: filter matches respect computed metrics', async () => {
    vi.resetModules();
    const { computeQualityIndices } = await import('../utils/qualityIndex');
    const { computeMatchingPnos } = await import('../utils/filterUtils');

    const features = [
      makeFeature('00100', { hr_mtu: 40000, crime_index: 30, unemployment_rate: 3, higher_education_rate: 60 }),
      makeFeature('00200', { hr_mtu: 20000, crime_index: 90, unemployment_rate: 15, higher_education_rate: 10 }),
    ];
    computeQualityIndices(features);

    const q1 = (features[0].properties as NeighborhoodProperties).quality_index!;
    const q2 = (features[1].properties as NeighborhoodProperties).quality_index!;
    expect(q1).toBeGreaterThan(q2);

    // Filter for high quality neighborhoods
    const fc = { type: 'FeatureCollection' as const, features };
    const matches = computeMatchingPnos(fc, [
      { layerId: 'quality_index', min: 0, max: 100 },
    ]);
    // Both should match the full range
    expect(matches.has('00100')).toBe(true);
    expect(matches.has('00200')).toBe(true);
  });

  it('pipeline: formatting handles computed values correctly', async () => {
    vi.resetModules();
    const { formatPct, formatEuro, formatNumber } = await import('../utils/formatting');
    const { computeQuickWinMetrics } = await import('../utils/metrics');

    const features = [makeFeature('00100', { he_vakiy: 1000, he_18_19: 30, he_20_24: 80, he_25_29: 90 })];
    computeQuickWinMetrics(features);
    const p = features[0].properties as NeighborhoodProperties;

    expect(formatPct(p.youth_ratio_pct)).toContain('20.0');
    expect(formatEuro(p.hr_mtu)).toContain('30');
    expect(formatNumber(p.he_vakiy)).not.toBe('—');
  });
});
