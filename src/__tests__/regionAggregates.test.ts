/**
 * CF-8: the prebuilt region_aggregates.json drives the all-Finland first paint.
 *
 * The load-bearing invariant is PARITY: the per-region records produced at build time
 * (`buildRegionAggregates`) must equal what the runtime `buildMetroAreaFeatures`
 * attaches to each metro-area feature — otherwise the view would visibly shift when it
 * later upgrades from the aggregates to the full national dataset. These tests pin that
 * parity plus the aggregate-driven feature builder and its no-data-region handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import type { NeighborhoodProperties } from '../utils/metrics';
import { aggregateTrendHistories, buildRegionAggregates } from '../utils/metroAggregation';
import {
  buildMetroAreaFeatures,
  buildMetroAreaFeaturesFromAggregates,
  clearMetroAreaCache,
  preloadUnion,
  _resetOutlinesForTests,
} from '../utils/metroAreas';

function makeFeature(city: string, pno: string, pop: number, extra: Record<string, unknown> = {}): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: {
      pno,
      nimi: `Area ${pno}`,
      namn: `Area ${pno}`,
      kunta: null,
      city,
      he_vakiy: pop,
      hr_mtu: 30000,
      te_taly: 500,
      crime_index: 5,
      population_history: JSON.stringify([[2020, pop], [2024, pop + 100]]),
      income_history: JSON.stringify([[2020, 28000], [2024, 30000]]),
      ...extra,
    } as unknown as NeighborhoodProperties,
    geometry: { type: 'Polygon', coordinates: [[[24, 60], [25, 60], [25, 61], [24, 60]]] },
  };
}

describe('aggregateTrendHistories', () => {
  it('sums population history and population-weights income history per year', () => {
    const feats = [
      makeFeature('helsinki_metro', '00100', 2000, { income_history: JSON.stringify([[2020, 40000], [2024, 50000]]) }),
      makeFeature('helsinki_metro', '00200', 1000, { income_history: JSON.stringify([[2020, 10000], [2024, 20000]]) }),
    ];
    const out = aggregateTrendHistories(feats);
    // population_history summed: 2020 → 3000, 2024 → 3200
    expect(JSON.parse(out.population_history)).toEqual([[2020, 3000], [2024, 3200]]);
    // income_history pop-weighted: 2020 → (40000*2000 + 10000*1000)/3000 = 30000
    const inc = JSON.parse(out.income_history);
    expect(inc[0]).toEqual([2020, 30000]);
  });
});

describe('buildRegionAggregates ↔ buildMetroAreaFeatures parity', () => {
  beforeEach(() => {
    _resetOutlinesForTests();
    clearMetroAreaCache();
  });

  it('produces per-region records whose metric values match the runtime metro-area feature', () => {
    const feats = [
      makeFeature('helsinki_metro', '00100', 2000, { hr_mtu: 40000 }),
      makeFeature('helsinki_metro', '00200', 1000, { hr_mtu: 20000 }),
      makeFeature('turku', '20100', 1500),
    ];

    const aggregates = buildRegionAggregates(feats);
    // Runtime build (fallback geometry — no outlines — still computes identical props).
    const runtime = buildMetroAreaFeatures(feats);

    for (const f of runtime.features) {
      const city = f.properties!.city as string;
      const record = aggregates.regions[city];
      expect(record).toBeDefined();
      // Every aggregated metric/trend/change value in the record must equal the
      // value the runtime metro-area feature carries (identity fields excluded).
      for (const key of Object.keys(record)) {
        if (['pno', 'nimi', 'namn', 'kunta', 'city', '_isMetroArea'].includes(key)) continue;
        expect(record[key]).toEqual(f.properties![key]);
      }
    }

    // National averages are the whole-set metro averages.
    expect(aggregates.national.he_vakiy).toBe(4500);
    // Population-weighted national income: (40000*2000 + 20000*1000 + 30000*1500)/4500.
    expect(aggregates.national.hr_mtu).toBeCloseTo((40000 * 2000 + 20000 * 1000 + 30000 * 1500) / 4500, 0);
  });

  it('derives the change-pct metrics into each region record', () => {
    const feats = [makeFeature('tampere', '33100', 1000)];
    const { regions } = buildRegionAggregates(feats);
    // income_history [28000→30000] ⇒ +7.1%
    expect(regions.tampere.income_change_pct).toBeCloseTo(7.1, 1);
    expect(regions.tampere.population_change_pct).toBeDefined();
  });

  it('only includes known regions', () => {
    const feats = [makeFeature('not_a_region', '99999', 1000)];
    const { regions } = buildRegionAggregates(feats);
    expect(Object.keys(regions)).toHaveLength(0);
  });
});

describe('buildMetroAreaFeaturesFromAggregates', () => {
  beforeEach(() => {
    _resetOutlinesForTests();
    clearMetroAreaCache();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _resetOutlinesForTests();
  });

  const sampleRecords = {
    helsinki_metro: { he_vakiy: 3000, hr_mtu: 35000, quality_index: 72 },
  };

  it('emits no data-region features until the outlines are loaded (no concat fallback)', () => {
    const fc = buildMetroAreaFeaturesFromAggregates(sampleRecords);
    expect(fc.features).toHaveLength(0);
  });

  it('with outlines loaded, builds region features + gray no-data regions, all _isMetroArea', async () => {
    // A minimal seutukunnat topology with two known regions.
    const topo = {
      type: 'Topology',
      objects: {
        seutukunnat: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Polygon', properties: { region: 'helsinki_metro' }, arcs: [[0]] },
            { type: 'Polygon', properties: { region: 'turku' }, arcs: [[1]] },
          ],
        },
      },
      arcs: [
        [[24, 60], [25, 60], [25, 61], [24, 61], [24, 60]],
        [[22, 60], [23, 60], [23, 61], [22, 61], [22, 60]],
      ],
    };
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(topo) }) as unknown as Promise<Response>));
    await preloadUnion();

    const fc = buildMetroAreaFeaturesFromAggregates(sampleRecords);
    const byCity = new Map(fc.features.map((f) => [f.properties!.city as string, f]));

    // The region with an aggregate record carries its values + geometry, no _noData.
    const hki = byCity.get('helsinki_metro')!;
    expect(hki).toBeDefined();
    expect(hki.properties!._isMetroArea).toBe(true);
    expect(hki.properties!._noData).toBeUndefined();
    expect(hki.properties!.quality_index).toBe(72);
    expect(hki.properties!.he_vakiy).toBe(3000);
    expect(hki.properties!.pno).toBe('helsinki_metro');
    expect(typeof hki.properties!.nimi).toBe('string');
    expect(hki.geometry).toBeTruthy();

    // The region WITHOUT a record is emitted as a gray no-data region.
    const turku = byCity.get('turku')!;
    expect(turku).toBeDefined();
    expect(turku.properties!._isMetroArea).toBe(true);
    expect(turku.properties!._noData).toBe(true);

    // Every emitted feature is a metro area (so the postal-border line layer excludes them).
    for (const f of fc.features) expect(f.properties!._isMetroArea).toBe(true);
  });
});
