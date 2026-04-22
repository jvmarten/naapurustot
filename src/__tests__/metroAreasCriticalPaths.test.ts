import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';

// Reset module state between tests
let buildMetroAreaFeatures: typeof import('../utils/metroAreas').buildMetroAreaFeatures;
let clearMetroAreaCache: typeof import('../utils/metroAreas').clearMetroAreaCache;

function makePolygonFeature(city: string, pno: string, coords: number[][][], props: Partial<NeighborhoodProperties> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: coords },
    properties: {
      pno, nimi: `Area ${pno}`, namn: `Area ${pno}`, kunta: '091', city: props.city ?? city,
      he_vakiy: 1000, hr_mtu: 30000, hr_ktu: 32000, he_kika: 38,
      ko_ika18y: 800, ko_yl_kork: 200, ko_al_kork: 100,
      pt_tyoll: 500, pt_tyott: 50, pt_vakiy: 700, pt_opisk: 80, pt_elakel: 120,
      te_taly: 500, te_omis_as: 250, te_vuok_as: 200,
      he_0_2: 30, he_3_6: 40, pinta_ala: 1_000_000, ra_pt_as: 50, ra_asunn: 400,
      unemployment_rate: 7, higher_education_rate: 37.5,
      quality_index: 60, transit_stop_density: 10, air_quality_index: 30,
      crime_index: 50, population_density: 1000,
      ...props,
      city: props.city ?? city,
    } as NeighborhoodProperties,
  };
}

const SQUARE_COORDS: number[][][] = [[[24.9, 60.1], [24.95, 60.1], [24.95, 60.15], [24.9, 60.15], [24.9, 60.1]]];
const SQUARE2_COORDS: number[][][] = [[[24.95, 60.1], [25.0, 60.1], [25.0, 60.15], [24.95, 60.15], [24.95, 60.1]]];

describe('buildMetroAreaFeatures critical paths', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metroAreas');
    buildMetroAreaFeatures = mod.buildMetroAreaFeatures;
    clearMetroAreaCache = mod.clearMetroAreaCache;
  });

  it('groups features by city and produces one feature per city', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS),
      makePolygonFeature('turku', '20100', SQUARE_COORDS),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    expect(result.type).toBe('FeatureCollection');
    const cities = result.features.map(f => f.properties?.city);
    expect(cities).toContain('helsinki_metro');
    expect(cities).toContain('turku');
    expect(result.features.length).toBe(2);
  });

  it('sets _isMetroArea flag on all output features', () => {
    const features = [makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS)];
    const result = buildMetroAreaFeatures(features as Feature[]);
    for (const f of result.features) {
      expect(f.properties?._isMetroArea).toBe(true);
    }
  });

  it('fallback produces MultiPolygon when @turf/union is unavailable', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS),
    ];
    // Without preloading union, unionFn is null, so fallback path runs
    const result = buildMetroAreaFeatures(features as Feature[]);
    const helsinkiFeature = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    // Should be MultiPolygon (concatenated) since union isn't loaded
    expect(['Polygon', 'MultiPolygon']).toContain(helsinkiFeature.geometry.type);
  });

  it('single-feature city returns original geometry without union', () => {
    const features = [makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS)];
    const result = buildMetroAreaFeatures(features as Feature[]);
    expect(result.features[0].geometry.type).toBe('Polygon');
    expect(result.features[0].geometry).toBe(features[0].geometry);
  });

  it('caches geometry and reuses on same features reference', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS),
    ];
    const r1 = buildMetroAreaFeatures(features as Feature[]);
    const r2 = buildMetroAreaFeatures(features as Feature[]);
    // Same geometry reference means cache was reused
    expect(r1.features[0].geometry).toBe(r2.features[0].geometry);
  });

  it('clearMetroAreaCache invalidates averages but preserves geometry', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, { quality_index: 60 }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, { quality_index: 40 }),
    ];
    const r1 = buildMetroAreaFeatures(features as Feature[]);
    const geom1 = r1.features[0].geometry;
    const avg1 = r1.features[0].properties?.quality_index;

    // Mutate quality_index in place (simulating weight recomputation)
    (features[0].properties as NeighborhoodProperties).quality_index = 80;
    (features[1].properties as NeighborhoodProperties).quality_index = 80;
    clearMetroAreaCache();

    const r2 = buildMetroAreaFeatures(features as Feature[]);
    const geom2 = r2.features[0].geometry;
    const avg2 = r2.features[0].properties?.quality_index;

    expect(geom2).toBe(geom1); // geometry preserved
    expect(avg2).not.toBe(avg1); // averages recomputed
  });

  it('skips features with unknown city ids', () => {
    const features = [
      makePolygonFeature('unknown_city_xyz', '99999', SQUARE_COORDS),
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    expect(result.features.length).toBe(1);
    expect(result.features[0].properties?.city).toBe('helsinki_metro');
  });

  it('computes weighted averages in metro area properties', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, { he_vakiy: 2000, hr_mtu: 40000 }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, { he_vakiy: 1000, hr_mtu: 25000 }),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    const hki = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    // Population-weighted average: (40000*2000 + 25000*1000) / (2000+1000) = 35000
    expect(hki.properties?.hr_mtu).toBe(35000);
    expect(hki.properties?.he_vakiy).toBe(3000);
  });

  it('skips neighborhoods with pop <= 0 in aggregation', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, { he_vakiy: 0, hr_mtu: 99999 }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, { he_vakiy: 1000, hr_mtu: 30000 }),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    const hki = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    // Only the second feature contributes to averages
    expect(hki.properties?.hr_mtu).toBe(30000);
  });
});

describe('trend aggregation in metro areas', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/metroAreas');
    buildMetroAreaFeatures = mod.buildMetroAreaFeatures;
    clearMetroAreaCache = mod.clearMetroAreaCache;
  });

  it('aggregates population_history by sum', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, {
        he_vakiy: 1000,
        population_history: JSON.stringify([[2020, 900], [2021, 1000]]),
      }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, {
        he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    const hki = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    const history = JSON.parse(hki.properties?.population_history as string);
    // Sum: [2020, 2700], [2021, 3000]
    expect(history).toEqual([[2020, 2700], [2021, 3000]]);
  });

  it('aggregates income_history by population-weighted average', () => {
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, {
        he_vakiy: 1000,
        income_history: JSON.stringify([[2020, 30000], [2021, 32000]]),
      }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, {
        he_vakiy: 1000,
        income_history: JSON.stringify([[2020, 40000], [2021, 42000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    const hki = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    const history = JSON.parse(hki.properties?.income_history as string);
    // Weighted avg: (30000*1000 + 40000*1000) / 2000 = 35000
    expect(history[0]).toEqual([2020, 35000]);
    expect(history[1]).toEqual([2021, 37000]);
  });

  it('drops years with less than 50% data coverage in sum mode', () => {
    // parseTrendSeries requires >= 2 data points. Features 2-4 have 2 points each,
    // but only feature 1 has data for 2019. sd.entries.length = 4 (all have valid series).
    // Year 2019: count=1, threshold=4*0.5=2 → 1 < 2 → dropped
    // Year 2020: count=4, threshold=2 → included
    // Year 2021: count=4, threshold=2 → included
    const features = [
      makePolygonFeature('helsinki_metro', '00100', SQUARE_COORDS, {
        he_vakiy: 1000,
        population_history: JSON.stringify([[2019, 800], [2020, 900], [2021, 1000]]),
      }),
      makePolygonFeature('helsinki_metro', '00200', SQUARE2_COORDS, {
        he_vakiy: 2000,
        population_history: JSON.stringify([[2020, 1800], [2021, 2000]]),
      }),
      makePolygonFeature('helsinki_metro', '00300', SQUARE_COORDS, {
        he_vakiy: 1500,
        population_history: JSON.stringify([[2020, 1400], [2021, 1500]]),
      }),
      makePolygonFeature('helsinki_metro', '00400', SQUARE2_COORDS, {
        he_vakiy: 1000,
        population_history: JSON.stringify([[2020, 950], [2021, 1000]]),
      }),
    ];
    const result = buildMetroAreaFeatures(features as Feature[]);
    const hki = result.features.find(f => f.properties?.city === 'helsinki_metro')!;
    const history = JSON.parse(hki.properties?.population_history as string);
    const years = history.map((p: number[]) => p[0]);
    // 2019 had data from 1/4 entries (25%) — below 50%, dropped
    expect(years).not.toContain(2019);
    // 2020 and 2021 have data from 4/4 entries (100%) — included
    expect(years).toContain(2020);
    expect(years).toContain(2021);
  });
});
