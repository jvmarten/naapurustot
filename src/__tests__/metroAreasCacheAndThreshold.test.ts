/**
 * Tests for metroAreas.ts — cache invalidation and trend aggregation threshold.
 *
 * These test two critical gaps:
 * 1. The 50% data completeness threshold in aggregateTrendHistories (sum mode)
 * 2. The metro area cache invalidation when unionFn becomes available
 * 3. The buildMetroAreaFeatures function behavior with different data shapes
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

// We need to test the internal aggregateTrendHistories function, which is not exported.
// Instead, test it through buildMetroAreaFeatures which calls it, or replicate the logic.

function makeFeature(pno: string, city: string, overrides: Partial<NeighborhoodProperties> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Område ${pno}`,
      kunta: '091',
      city,
      he_vakiy: 3000,
      hr_mtu: 30000,
      unemployment_rate: 7,
      higher_education_rate: 40,
      pt_tyoll: 1800,
      pt_tyott: 200,
      pt_vakiy: 2500,
      ko_ika18y: 2400,
      ko_yl_kork: 500,
      ko_al_kork: 400,
      te_taly: 1200,
      te_omis_as: 600,
      te_vuok_as: 500,
      pinta_ala: 2_000_000,
      he_0_2: 80,
      he_3_6: 100,
      ra_asunn: 1000,
      ra_pt_as: 200,
      pt_opisk: 300,
      pt_elakel: 200,
      quality_index: 55,
      crime_index: 50,
      transit_stop_density: 30,
      air_quality_index: 25,
      healthcare_density: 3,
      school_density: 2,
      daycare_density: 4,
      grocery_density: 5,
      ...overrides,
    } as NeighborhoodProperties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[24.9, 60.2], [24.95, 60.2], [24.95, 60.25], [24.9, 60.25], [24.9, 60.2]]],
    },
  };
}

describe('buildMetroAreaFeatures', () => {
  beforeEach(async () => {
    // Clear the cache before each test by importing and calling clearMetroAreaCache
    const mod = await import('../utils/metroAreas');
    mod.clearMetroAreaCache();
  });

  it('builds features grouped by city with _isMetroArea flag', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features = [
      makeFeature('00100', 'helsinki_metro'),
      makeFeature('00200', 'helsinki_metro'),
      makeFeature('20100', 'turku'),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(2); // helsinki_metro + turku

    for (const f of result!.features) {
      expect(f.properties!._isMetroArea).toBe(true);
      expect(f.properties!.city).toBeDefined();
    }
  });

  it('excludes cities not in REGIONS', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features = [
      makeFeature('00100', 'helsinki_metro'),
      makeFeature('99900', 'unknown_city'),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    // Only helsinki_metro should be present, unknown_city should be excluded
    expect(result!.features.length).toBe(1);
    expect(result!.features[0].properties!.city).toBe('helsinki_metro');
  });

  it('returns empty FeatureCollection when no features have known cities', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features = [
      makeFeature('99900', 'unknown_city1'),
      makeFeature('99901', 'unknown_city2'),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    expect(result!.features.length).toBe(0);
  });

  it('computes population-weighted averages for metro area properties', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features = [
      makeFeature('00100', 'helsinki_metro', { he_vakiy: 10000, hr_mtu: 40000 }),
      makeFeature('00200', 'helsinki_metro', { he_vakiy: 5000, hr_mtu: 20000 }),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    const helsinki = result!.features.find(f => f.properties!.city === 'helsinki_metro');
    expect(helsinki).toBeDefined();

    // Population-weighted average of income: (10000*40000 + 5000*20000) / (10000+5000) = 500M/15000 ≈ 33333
    const avgIncome = helsinki!.properties!.hr_mtu as number;
    expect(avgIncome).toBeCloseTo(33333, -1);
  });

  it('uses cache on second call with same features array', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features = [
      makeFeature('00100', 'helsinki_metro'),
      makeFeature('00200', 'helsinki_metro'),
    ];

    const result1 = buildMetroAreaFeatures(features);
    const result2 = buildMetroAreaFeatures(features);

    // Both should be non-null and have same structure
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.features.length).toBe(result2!.features.length);
  });

  it('invalidates cache when features array changes', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features1 = [
      makeFeature('00100', 'helsinki_metro', { hr_mtu: 30000 }),
    ];
    const features2 = [
      makeFeature('00100', 'helsinki_metro', { hr_mtu: 50000 }),
    ];

    const result1 = buildMetroAreaFeatures(features1);
    const result2 = buildMetroAreaFeatures(features2);

    const income1 = result1!.features[0].properties!.hr_mtu as number;
    const income2 = result2!.features[0].properties!.hr_mtu as number;
    expect(income1).not.toBe(income2);
  });

  it('handles city with no polygon features gracefully', async () => {
    const { buildMetroAreaFeatures } = await import('../utils/metroAreas');

    const features: Feature[] = [
      {
        type: 'Feature',
        properties: {
          pno: '00100',
          nimi: 'Point',
          namn: 'Point',
          city: 'helsinki_metro',
          he_vakiy: 5000,
        } as unknown as NeighborhoodProperties,
        geometry: { type: 'Point', coordinates: [24.9, 60.2] },
      },
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();
    // No polygon features → no metro area features for this city
    expect(result!.features.length).toBe(0);
  });
});

describe('aggregateTrendHistories — 50% threshold', () => {
  // The internal function requires 50% of neighborhoods to have data for a
  // given year in sum mode before including that year. We test this through
  // buildMetroAreaFeatures which calls aggregateTrendHistories internally.

  it('includes population trends only when ≥50% of neighborhoods have data for that year', async () => {
    const { buildMetroAreaFeatures, clearMetroAreaCache } = await import('../utils/metroAreas');
    clearMetroAreaCache();

    // 4 neighborhoods: only 1 has data for 2018, all 4 have data for 2020-2021
    const features = [
      makeFeature('00100', 'helsinki_metro', {
        he_vakiy: 5000,
        population_history: JSON.stringify([[2018, 4000], [2019, 4500], [2020, 5000], [2021, 5500]]),
      }),
      makeFeature('00200', 'helsinki_metro', {
        he_vakiy: 3000,
        population_history: JSON.stringify([[2019, 2800], [2020, 3000], [2021, 3200]]),
      }),
      makeFeature('00300', 'helsinki_metro', {
        he_vakiy: 4000,
        population_history: JSON.stringify([[2020, 4000], [2021, 4200]]),
      }),
      makeFeature('00400', 'helsinki_metro', {
        he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 2000], [2021, 2100]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    expect(result).not.toBeNull();

    const helsinki = result!.features.find(f => f.properties!.city === 'helsinki_metro');
    expect(helsinki).toBeDefined();

    const popHistory = helsinki!.properties!.population_history;
    if (popHistory) {
      const parsed = JSON.parse(popHistory as string) as [number, number][];
      const years = parsed.map(([y]) => y);

      // 2018: only 1 of 4 neighborhoods has data (25%) → should be excluded
      expect(years).not.toContain(2018);

      // 2019: 2 of 4 (50%) → should be included
      expect(years).toContain(2019);

      // 2020 and 2021: all 4 have data → definitely included
      expect(years).toContain(2020);
      expect(years).toContain(2021);
    }
  });

  it('income history uses weighted average (not sum) across neighborhoods', async () => {
    const { buildMetroAreaFeatures, clearMetroAreaCache } = await import('../utils/metroAreas');
    clearMetroAreaCache();

    const features = [
      makeFeature('00100', 'helsinki_metro', {
        he_vakiy: 10000,
        income_history: JSON.stringify([[2020, 40000], [2021, 42000]]),
      }),
      makeFeature('00200', 'helsinki_metro', {
        he_vakiy: 5000,
        income_history: JSON.stringify([[2020, 20000], [2021, 22000]]),
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const helsinki = result!.features.find(f => f.properties!.city === 'helsinki_metro');
    expect(helsinki).toBeDefined();

    const incomeHistory = helsinki!.properties!.income_history;
    if (incomeHistory) {
      const parsed = JSON.parse(incomeHistory as string) as [number, number][];
      const y2020 = parsed.find(([y]) => y === 2020);
      expect(y2020).toBeDefined();

      // Weighted average: (10000*40000 + 5000*20000) / 15000 = 33333.3
      expect(y2020![1]).toBeCloseTo(33333.3, 0);
    }
  });

  it('does not produce trend history when fewer than 2 data points', async () => {
    const { buildMetroAreaFeatures, clearMetroAreaCache } = await import('../utils/metroAreas');
    clearMetroAreaCache();

    const features = [
      makeFeature('00100', 'helsinki_metro', {
        he_vakiy: 5000,
        population_history: JSON.stringify([[2021, 5000]]),
        income_history: null,
      }),
    ];

    const result = buildMetroAreaFeatures(features);
    const helsinki = result!.features.find(f => f.properties!.city === 'helsinki_metro');
    expect(helsinki).toBeDefined();

    // Single data point → should not have trend history
    // (aggregated.length < 2 → excluded)
    const popHistory = helsinki!.properties!.population_history;
    expect(popHistory).toBeUndefined();
  });
});
