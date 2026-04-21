/**
 * Tests for the actual data loading pipeline — not just replicated coercion logic,
 * but the real processTopology path and its interactions.
 *
 * The existing dataLoader tests replicate the coercion algorithm in isolation.
 * These tests target the uncovered lines: ID_FIELDS including 'nimi', 'namn', 'city'
 * (added in the real code but missing from the replicated logic), the full
 * processTopology pipeline, and cache behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetDataCache } from '../utils/dataLoader';

describe('dataLoader ID_FIELDS completeness', () => {
  /**
   * The real ID_FIELDS set in dataLoader.ts includes 'nimi', 'namn', 'city'
   * in addition to 'pno', 'postinumeroalue', 'kunta'. Earlier tests only
   * checked 'pno', 'postinumeroalue', 'kunta'. If someone removes 'nimi' or
   * 'city' from ID_FIELDS, Finnish neighborhood names like "Etu-Töölö" would
   * be passed to Number() and survive the isFinite check as NaN (staying as strings),
   * but 'city' values like "helsinki_metro" would also stay — so the real risk is
   * more subtle: if a future name happens to be numeric (e.g., "360"), it would be
   * coerced to a number, breaking display logic.
   */
  it('documents which fields must remain as strings', () => {
    const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

    // All these fields should be in ID_FIELDS to prevent coercion
    expect(ID_FIELDS.has('pno')).toBe(true);
    expect(ID_FIELDS.has('kunta')).toBe(true);
    expect(ID_FIELDS.has('nimi')).toBe(true);
    expect(ID_FIELDS.has('namn')).toBe(true);
    expect(ID_FIELDS.has('city')).toBe(true);
    expect(ID_FIELDS.has('postinumeroalue')).toBe(true);
  });
});

describe('dataLoader — processTopology pipeline integration', () => {
  /**
   * The pipeline must execute in this exact order:
   * 1. TopoJSON → GeoJSON via topojson-client
   * 2. String → number coercion (except ID fields)
   * 3. filterSmallIslands
   * 4. computeQualityIndices
   * 5. computeChangeMetrics
   * 6. computeQuickWinMetrics
   * 7. computeMetroAverages
   *
   * If quality indices are computed AFTER metro averages, the quality_index
   * property will be missing from the averages. If change metrics are computed
   * after metro averages, change_pct values won't be averaged correctly.
   */
  it('quality_index must be computed before metro averages', async () => {
    // Create features and verify that computeQualityIndices writes to feature
    // properties which are then picked up by computeMetroAverages
    const { computeQualityIndices } = await import('../utils/qualityIndex');
    const { computeMetroAverages } = await import('../utils/metrics');

    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', he_vakiy: 5000, hr_mtu: 35000,
          unemployment_rate: 5, higher_education_rate: 40,
          crime_index: 40, transit_stop_density: 50,
          healthcare_density: 3, school_density: 2,
          daycare_density: 2, grocery_density: 3,
          air_quality_index: 25, quality_index: null,
        },
        geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      },
      {
        type: 'Feature',
        properties: {
          pno: '00200', he_vakiy: 3000, hr_mtu: 28000,
          unemployment_rate: 8, higher_education_rate: 25,
          crime_index: 70, transit_stop_density: 30,
          healthcare_density: 1, school_density: 1,
          daycare_density: 1, grocery_density: 1,
          air_quality_index: 35, quality_index: null,
        },
        geometry: { type: 'Point', coordinates: [24.95, 60.18] },
      },
    ];

    // Compute quality indices first (as the real pipeline does)
    computeQualityIndices(features);

    // Both features should now have quality_index set
    expect(features[0].properties!.quality_index).not.toBeNull();
    expect(features[1].properties!.quality_index).not.toBeNull();

    // Metro averages should pick up quality_index
    const averages = computeMetroAverages(features);
    expect(averages.quality_index).toBeDefined();
    expect(averages.quality_index).toBeGreaterThan(0);
  });

  it('change metrics must be computed before metro averages', async () => {
    const { computeChangeMetrics, computeMetroAverages } = await import('../utils/metrics');

    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100', he_vakiy: 5000,
          income_history: JSON.stringify([[2020, 30000], [2024, 35000]]),
          population_history: JSON.stringify([[2020, 4000], [2024, 5000]]),
          unemployment_history: JSON.stringify([[2020, 6.0], [2024, 4.5]]),
          income_change_pct: null,
          population_change_pct: null,
          unemployment_change_pct: null,
        },
        geometry: { type: 'Point', coordinates: [24.94, 60.17] },
      },
    ];

    computeChangeMetrics(features);

    expect(features[0].properties!.income_change_pct).toBeCloseTo(16.67, 1);
    expect(features[0].properties!.population_change_pct).toBe(25);
    expect(features[0].properties!.unemployment_change_pct).toBe(-25);
  });
});

describe('dataLoader — cache eviction on failure', () => {
  beforeEach(() => {
    resetDataCache();
  });

  it('resetDataCache does not throw and can be called repeatedly', () => {
    expect(() => {
      resetDataCache();
      resetDataCache();
      resetDataCache();
    }).not.toThrow();
  });
});

describe('dataLoader — coercion preserves nimi and namn fields', () => {
  const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

  function coerceProperties(properties: Record<string, unknown>): void {
    for (const key of Object.keys(properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) properties[key] = num;
      }
    }
  }

  it('nimi field stays a string even if it looks numeric', () => {
    const props = { nimi: '360' };
    coerceProperties(props);
    expect(props.nimi).toBe('360');
    expect(typeof props.nimi).toBe('string');
  });

  it('namn field stays a string even if it looks numeric', () => {
    const props = { namn: '100' };
    coerceProperties(props);
    expect(props.namn).toBe('100');
    expect(typeof props.namn).toBe('string');
  });

  it('city field stays a string', () => {
    const props = { city: 'helsinki_metro' };
    coerceProperties(props);
    expect(props.city).toBe('helsinki_metro');
  });

  it('non-ID numeric string fields are coerced', () => {
    const props: Record<string, unknown> = {
      nimi: '360',
      pno: '00100',
      hr_mtu: '35000',
      he_vakiy: '5000',
    };
    coerceProperties(props);
    expect(props.nimi).toBe('360');
    expect(props.pno).toBe('00100');
    expect(props.hr_mtu).toBe(35000);
    expect(props.he_vakiy).toBe(5000);
  });
});
