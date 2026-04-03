/**
 * Integration tests that verify the full data pipeline:
 * raw data → computeQuickWinMetrics → computeChangeMetrics → computeQualityIndices
 *         → computeMetroAverages → colorForValue → filterUtils
 *
 * These catch bugs that only appear when modules interact.
 */
import { describe, it, expect } from 'vitest';
import { computeQualityIndices } from '../utils/qualityIndex';
import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { getLayerById, getColorForValue, rescaleLayerToData } from '../utils/colorScales';
import { computeMatchingPnos, type FilterCriterion } from '../utils/filterUtils';
import { filterSmallIslands, getFeatureCenter } from '../utils/geometryFilter';
import { findSimilarNeighborhoods } from '../utils/similarity';
import type { Feature, FeatureCollection } from 'geojson';

function makeFeature(props: Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.0, 60.0], [24.1, 60.0], [24.1, 60.1], [24.0, 60.1], [24.0, 60.0]]],
    },
    properties: props,
  };
}

/** Build a realistic feature with all Paavo fields */
function makeRealisticFeature(pno: string, overrides: Record<string, unknown> = {}): Feature {
  return makeFeature({
    pno,
    nimi: `Alue ${pno}`,
    namn: `Område ${pno}`,
    kunta: '091',
    city: 'helsinki',
    he_vakiy: 3000,
    he_kika: 38,
    ko_ika18y: 2400,
    ko_yl_kork: 400,
    ko_al_kork: 300,
    ko_ammat: 500,
    ko_perus: 300,
    hr_mtu: 30000,
    hr_ktu: 35000,
    pt_tyoll: 1800,
    pt_tyott: 200,
    pt_opisk: 300,
    pt_vakiy: 2500,
    pt_elakel: 400,
    ra_asunn: 1500,
    ra_as_kpa: 65,
    ra_pt_as: 100,
    te_takk: 400,
    te_taly: 1200,
    te_omis_as: 600,
    te_vuok_as: 500,
    pinta_ala: 2000000, // 2 km²
    he_0_2: 60,
    he_3_6: 80,
    unemployment_rate: 8,
    higher_education_rate: 29.2,
    pensioner_share: 13.3,
    foreign_language_pct: 12,
    ownership_rate: 50,
    rental_rate: 41.7,
    population_density: 1500,
    child_ratio: 4.7,
    student_share: 12,
    detached_house_share: 6.7,
    property_price_sqm: 4000,
    transit_stop_density: 30,
    air_quality_index: 28,
    crime_index: 60,
    daycare_density: 3,
    school_density: 2,
    healthcare_density: 2,
    single_person_hh_pct: 40,
    cycling_density: 15,
    restaurant_density: 20,
    grocery_density: 5,
    sports_facility_density: 3,
    income_history: JSON.stringify([[2018, 25000], [2020, 28000], [2022, 30000]]),
    population_history: JSON.stringify([[2018, 2800], [2020, 2900], [2022, 3000]]),
    unemployment_history: JSON.stringify([[2018, 10], [2020, 9], [2022, 8]]),
    // Paavo fields for quick-win metrics
    he_18_19: 80,
    he_20_24: 200,
    he_25_29: 250,
    he_naiset: 1550,
    he_miehet: 1450,
    he_65_69: 150,
    he_70_74: 100,
    he_75_79: 60,
    he_80_84: 30,
    he_85_: 20,
    te_eil_np: 50,
    te_laps: 350,
    tp_tyopy: 1500,
    tp_j_info: 150,
    tp_q_terv: 200,
    tp_jalo_bf: 100,
    tp_o_julk: 80,
    tp_palv_gu: 300,
    ra_raky: 15,
    ...overrides,
  });
}

describe('Full pipeline: metrics → quality → color → filter', () => {
  it('processes features through entire pipeline without errors', () => {
    const features = [
      makeRealisticFeature('00100'),
      makeRealisticFeature('00200', { hr_mtu: 45000, crime_index: 30, unemployment_rate: 3 }),
      makeRealisticFeature('00300', { hr_mtu: 20000, crime_index: 90, unemployment_rate: 15 }),
    ];

    // Step 1: Compute quick-win metrics
    computeQuickWinMetrics(features);
    for (const f of features) {
      expect(f.properties!.youth_ratio_pct).toBeDefined();
      expect(f.properties!.gender_ratio).toBeDefined();
      expect(f.properties!.employment_rate).toBeDefined();
    }

    // Step 2: Compute change metrics from history
    computeChangeMetrics(features);
    for (const f of features) {
      expect(f.properties!.income_change_pct).toBeDefined();
      expect(f.properties!.population_change_pct).toBeDefined();
      expect(f.properties!.unemployment_change_pct).toBeDefined();
    }

    // Step 3: Compute quality indices
    computeQualityIndices(features);
    for (const f of features) {
      const qi = f.properties!.quality_index as number;
      expect(qi).toBeGreaterThanOrEqual(0);
      expect(qi).toBeLessThanOrEqual(100);
    }

    // Step 4: Quality index ordering should reflect data
    // 00200 has highest income, lowest crime, lowest unemployment → highest quality
    // 00300 has lowest income, highest crime, highest unemployment → lowest quality
    expect(features[1].properties!.quality_index).toBeGreaterThan(
      features[2].properties!.quality_index as number,
    );

    // Step 5: Compute metro averages
    const avg = computeMetroAverages(features);
    expect(avg.hr_mtu).toBeGreaterThan(0);
    expect(avg.unemployment_rate).toBeGreaterThan(0);
    expect(avg.he_vakiy).toBe(9000); // 3000 * 3

    // Step 6: Map quality_index to color
    const layer = getLayerById('quality_index');
    for (const f of features) {
      const color = getColorForValue(layer, f.properties!.quality_index as number);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('Pipeline: filter uses quality index from computation', () => {
  it('filters neighborhoods by computed quality_index', () => {
    const features = [
      makeRealisticFeature('00100'),
      makeRealisticFeature('00200', { hr_mtu: 45000, crime_index: 30, unemployment_rate: 3 }),
      makeRealisticFeature('00300', { hr_mtu: 20000, crime_index: 90, unemployment_rate: 15 }),
    ];

    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    const data: FeatureCollection = { type: 'FeatureCollection', features };

    // Filter for high quality (≥ 60)
    const criteria: FilterCriterion[] = [{
      layerId: 'quality_index',
      min: 60,
      max: 100,
    }];

    const matches = computeMatchingPnos(data, criteria);
    // The wealthy neighborhood should pass
    expect(matches.has('00200')).toBe(true);
    // The poor neighborhood should not
    expect(matches.has('00300')).toBe(false);
  });
});

describe('Pipeline: rescale layer to actual data', () => {
  it('rescales income layer to match features, then colors still work', () => {
    const features = [
      makeRealisticFeature('00100', { hr_mtu: 25000 }),
      makeRealisticFeature('00200', { hr_mtu: 35000 }),
    ];

    const layer = getLayerById('median_income');
    const rescaled = rescaleLayerToData(layer, features);

    // Rescaled stops should span the actual data range
    expect(rescaled.stops[0]).toBe(25000);
    expect(rescaled.stops[rescaled.stops.length - 1]).toBe(35000);

    // Colors should still map correctly
    const lowColor = getColorForValue(rescaled, 25000);
    const highColor = getColorForValue(rescaled, 35000);
    expect(lowColor).toBe(rescaled.colors[0]);
    expect(highColor).toBe(rescaled.colors[rescaled.colors.length - 1]);
  });
});

describe('Pipeline: similarity uses computed metrics', () => {
  it('finds similar neighborhoods after full metric computation', () => {
    const features = [
      makeRealisticFeature('00100'),
      makeRealisticFeature('00200', { hr_mtu: 31000 }), // very similar
      makeRealisticFeature('00300', { hr_mtu: 60000, crime_index: 10 }), // very different
    ];

    computeQuickWinMetrics(features);
    computeChangeMetrics(features);
    computeQualityIndices(features);

    const target = features[0].properties as any;
    const similar = findSimilarNeighborhoods(target, features, 2);

    // 00200 should be more similar than 00300
    expect(similar[0].properties.pno).toBe('00200');
  });
});

describe('Pipeline: geometry filtering preserves data for metrics', () => {
  it('filtered features still compute valid quality indices', () => {
    const features = [
      {
        type: 'Feature' as const,
        geometry: {
          type: 'MultiPolygon' as const,
          coordinates: [
            [[[24.0, 60.0], [24.1, 60.0], [24.1, 60.1], [24.0, 60.1], [24.0, 60.0]]], // large
            [[[24.5, 60.5], [24.5001, 60.5], [24.5001, 60.5001], [24.5, 60.5001], [24.5, 60.5]]], // tiny island
          ],
        },
        properties: {
          pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki',
          he_vakiy: 3000, hr_mtu: 30000, unemployment_rate: 8,
          higher_education_rate: 50, crime_index: 60,
        },
      },
    ];

    const filtered = filterSmallIslands(features);
    // Island should be removed
    expect(filtered[0].geometry.type).toBe('Polygon');

    // Quality index should still work
    computeQualityIndices(filtered);
    expect(filtered[0].properties!.quality_index).not.toBeNull();

    // Center should still be computable
    const center = getFeatureCenter(filtered[0]);
    expect(center[0]).not.toBe(0);
    expect(center[1]).not.toBe(0);
  });
});

describe('Pipeline: metro averages include quick-win metrics', () => {
  it('metro averages contain employment_rate from quick-win computation', () => {
    const features = [
      makeRealisticFeature('00100'),
      makeRealisticFeature('00200', { pt_tyoll: 2000, pt_vakiy: 2500 }),
    ];

    computeQuickWinMetrics(features);
    const avg = computeMetroAverages(features);

    // employment_rate should be in averages (it's in METRIC_DEFS as pctOfPop)
    expect(avg.employment_rate).toBeDefined();
    expect(avg.employment_rate).toBeGreaterThan(0);
  });
});
