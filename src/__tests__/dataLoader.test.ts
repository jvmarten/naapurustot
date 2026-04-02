/**
 * Tests for dataLoader.ts — processTopology and data loading logic.
 *
 * This is one of the most critical modules: it's the entry point for ALL data
 * into the app. Bugs here silently corrupt every downstream calculation
 * (quality indices, metro averages, similarity, filters).
 */
import { describe, it, expect } from 'vitest';

// We can't import processTopology directly (not exported), so we test
// the numeric coercion logic in isolation and the pipeline integration
// by calling the same functions processTopology calls.

import { computeQuickWinMetrics, computeChangeMetrics, computeMetroAverages } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';

// Test the numeric coercion logic that processTopology performs
describe('processTopology — numeric coercion logic', () => {
  // Replicate the exact coercion logic from dataLoader.ts lines 43-53
  const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);

  function coerceProperties(properties: Record<string, unknown>): Record<string, unknown> {
    for (const key of Object.keys(properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) properties[key] = num;
      }
    }
    return properties;
  }

  it('converts string-typed numeric properties to numbers', () => {
    const props = coerceProperties({
      pno: '00100',
      hr_mtu: '35000',
      he_vakiy: '5000',
      unemployment_rate: '7.5',
    });
    expect(props.hr_mtu).toBe(35000);
    expect(props.he_vakiy).toBe(5000);
    expect(props.unemployment_rate).toBe(7.5);
  });

  it('preserves ID fields as strings even when they look numeric', () => {
    const props = coerceProperties({
      pno: '00100',
      postinumeroalue: '00200',
      kunta: '091',
      hr_mtu: '35000',
    });
    expect(props.pno).toBe('00100');
    expect(props.postinumeroalue).toBe('00200');
    expect(props.kunta).toBe('091');
    // Non-ID field should be converted
    expect(props.hr_mtu).toBe(35000);
  });

  it('leaves non-numeric strings as strings', () => {
    const props = coerceProperties({
      pno: '00100',
      nimi: 'Kallio',
      namn: 'Berghäll',
      city: 'helsinki_metro',
    });
    expect(props.nimi).toBe('Kallio');
    expect(props.namn).toBe('Berghäll');
    expect(props.city).toBe('helsinki_metro');
  });

  it('leaves empty strings as strings (no coercion to 0)', () => {
    const props = coerceProperties({
      pno: '00100',
      hr_mtu: '',
      some_field: '  ',
    });
    // Empty string and whitespace-only should NOT become 0
    expect(props.hr_mtu).toBe('');
    expect(props.some_field).toBe('  ');
  });

  it('handles null and undefined values without crashing', () => {
    const props = coerceProperties({
      pno: '00100',
      hr_mtu: null,
      he_vakiy: undefined,
      crime_index: 42,
    });
    expect(props.hr_mtu).toBeNull();
    expect(props.he_vakiy).toBeUndefined();
    expect(props.crime_index).toBe(42);
  });

  it('does not coerce Infinity or NaN strings', () => {
    const props = coerceProperties({
      pno: '00100',
      field_inf: 'Infinity',
      field_nan: 'NaN',
      field_neg_inf: '-Infinity',
    });
    // isFinite(Infinity) = false, isFinite(NaN) = false
    expect(props.field_inf).toBe('Infinity');
    expect(props.field_nan).toBe('NaN');
    expect(props.field_neg_inf).toBe('-Infinity');
  });

  it('correctly converts negative numeric strings', () => {
    const props = coerceProperties({
      pno: '00100',
      change_pct: '-5.2',
      alt_metric: '-0',
    });
    expect(props.change_pct).toBe(-5.2);
    expect(props.alt_metric).toBe(-0);
  });

  it('correctly converts zero as string', () => {
    const props = coerceProperties({
      pno: '00100',
      value: '0',
    });
    expect(props.value).toBe(0);
  });

  it('handles string with leading/trailing whitespace containing a number', () => {
    // ' 35000 ' — trim() !== '' and Number(' 35000 ') = 35000
    const props = coerceProperties({
      pno: '00100',
      hr_mtu: ' 35000 ',
    });
    expect(props.hr_mtu).toBe(35000);
  });

  it('preserves existing number values unchanged', () => {
    const props = coerceProperties({
      pno: '00100',
      hr_mtu: 35000,
      crime_index: 0,
    });
    expect(props.hr_mtu).toBe(35000);
    expect(props.crime_index).toBe(0);
  });

  it('preserves boolean values unchanged', () => {
    const props = coerceProperties({
      pno: '00100',
      _isMetroArea: true,
    });
    expect(props._isMetroArea).toBe(true);
  });
});

describe('processTopology — pipeline integration', () => {
  // Test that processTopology calls all pipeline steps in the right order
  // by verifying the end result has all expected computed fields

  it('produces computed fields after full pipeline', () => {
    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100',
          nimi: 'Test',
          namn: 'Test',
          kunta: '091',
          city: 'helsinki_metro',
          he_vakiy: 5000,
          hr_mtu: 35000,
          pt_tyoll: 3000,
          pt_tyott: 300,
          pt_vakiy: 4000,
          ko_ika18y: 4000,
          ko_yl_kork: 800,
          ko_al_kork: 600,
          te_taly: 2500,
          te_omis_as: 1200,
          te_vuok_as: 1100,
          pinta_ala: 2_000_000,
          he_0_2: 100,
          he_3_6: 150,
          ra_asunn: 2000,
          ra_pt_as: 300,
          pt_opisk: 400,
          pt_elakel: 500,
          unemployment_rate: 7.5,
          higher_education_rate: 35,
          crime_index: 50,
          transit_stop_density: 40,
          air_quality_index: 25,
          healthcare_density: 3,
          school_density: 2,
          daycare_density: 4,
          grocery_density: 5,
          // Quick-win source fields
          he_naiset: 2600,
          he_miehet: 2400,
          he_18_19: 150,
          he_20_24: 300,
          he_25_29: 350,
          he_65_69: 200,
          he_70_74: 150,
          he_75_79: 80,
          he_80_84: 40,
          he_85_: 30,
          te_eil_np: 100,
          te_laps: 400,
          tp_tyopy: 1000,
          tp_j_info: 100,
          tp_q_terv: 200,
          tp_jalo_bf: 150,
          tp_o_julk: 100,
          tp_palv_gu: 250,
          ra_raky: 20,
          income_history: JSON.stringify([[2019, 30000], [2020, 32000], [2021, 35000]]),
          population_history: JSON.stringify([[2019, 4500], [2020, 4800], [2021, 5000]]),
          unemployment_history: JSON.stringify([[2019, 9.0], [2020, 8.0], [2021, 7.5]]),
          // Initially null — will be computed
          quality_index: null,
          income_change_pct: null,
          population_change_pct: null,
          unemployment_change_pct: null,
          youth_ratio_pct: null,
          gender_ratio: null,
          employment_rate: null,
          elderly_ratio_pct: null,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
        },
      },
    ];

    // Run the pipeline in the same order as processTopology
    const filtered = filterSmallIslands(features);
    computeQualityIndices(filtered);
    computeChangeMetrics(filtered);
    computeQuickWinMetrics(filtered);
    const metroAverages = computeMetroAverages(filtered);

    const p = filtered[0].properties as Record<string, unknown>;

    // Quality index should be computed (single feature = 50 for all equal)
    expect(p.quality_index).toBe(50);

    // Change metrics should be computed from history
    expect(p.income_change_pct).toBeCloseTo(16.67, 0); // (35000-30000)/30000 * 100
    expect(p.population_change_pct).toBeCloseTo(11.11, 0); // (5000-4500)/4500 * 100
    expect(p.unemployment_change_pct).toBeCloseTo(-16.67, 0); // (7.5-9.0)/9.0 * 100

    // Quick-win metrics should be computed
    expect(p.youth_ratio_pct).toBeCloseTo(16.0, 0); // (150+300+350)/5000 * 100
    expect(p.gender_ratio).toBeCloseTo(1.08, 1); // 2600/2400
    expect(p.employment_rate).toBeCloseTo(75.0, 0); // 3000/4000 * 100
    expect(p.elderly_ratio_pct).toBeCloseTo(10.0, 0); // (200+150+80+40+30)/5000 * 100

    // Metro averages should include key metrics
    expect(metroAverages.he_vakiy).toBe(5000);
    expect(metroAverages.hr_mtu).toBe(35000);
  });
});

describe('resetDataCache', () => {
  it('is exported and callable', async () => {
    // Dynamic import to avoid triggering import.meta.glob issues in test
    const mod = await import('../utils/dataLoader');
    expect(typeof mod.resetDataCache).toBe('function');
    // Should not throw
    mod.resetDataCache();
  });
});
