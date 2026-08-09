/**
 * CF-8: the prebuilt region_aggregates.json drives the all-Finland first paint.
 *
 * The load-bearing invariant is PARITY: the per-region records produced at build time
 * (`buildRegionAggregates`) must equal what the runtime `buildMetroAreaFeatures`
 * attaches to each metro-area feature — otherwise the view would visibly shift when it
 * later upgrades from the aggregates to the full national dataset. These tests pin that
 * parity plus the aggregate-driven feature builder and its no-data-region handling.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
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
import { getLayerById } from '../utils/colorScales';
import {
  applyQualityScale, getQualityScaleMode, setQualityScaleMode,
  type QualityCohortHistogram,
} from '../utils/qualityScale';

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

/**
 * The property the quality choropleth actually reads.
 *
 * This is the test that was missing when the quality_index layer was pointed at
 * `quality_display`: the all-Finland landing went grey, because only ONE of the two
 * region-feature producers had been taught to set it and the default landing paints
 * from the other one (`buildMetroAreaFeaturesFromAggregates`, fed by the prebuilt
 * region_aggregates.json). Nothing caught it — headless Chromium has no WebGL, so no
 * test in this repo renders the map.
 *
 * So these assert on the property name taken FROM the layer config, over every
 * producer that feeds the fill expression. Repoint the layer and the tests follow it;
 * miss a producer and they fail instead of the landing going grey.
 */
describe('quality choropleth — every producer sets the painted property', () => {
  const QUALITY_PROP = getLayerById('quality_index').property;

  // Two areas at 40 and 60 in one region, one at 44 in another: a cohort whose
  // stretch (min→0, max→100) is distinguishable from its raw composite.
  const COHORT: QualityCohortHistogram = [[40, 1], [44, 1], [60, 1]];
  const postalFeatures = () => [
    makeFeature('helsinki_metro', '00100', 1000, { quality_index: 40 }),
    makeFeature('helsinki_metro', '00200', 1000, { quality_index: 60 }),
    makeFeature('turku', '20100', 1000, { quality_index: 44 }),
  ];
  // The same regions as the prebuilt artifact holds them: population-weighted means
  // of the composites above, and no display value — that is derived at build time.
  const aggregateRecords = {
    helsinki_metro: { he_vakiy: 2000, quality_index: 50 },
    turku: { he_vakiy: 1000, quality_index: 44 },
  };

  const outlinesTopo = {
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

  async function withOutlines(): Promise<void> {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(outlinesTopo) }) as unknown as Promise<Response>));
    await preloadUnion();
  }

  const originalMode = getQualityScaleMode();

  beforeEach(() => {
    _resetOutlinesForTests();
    clearMetroAreaCache();
    setQualityScaleMode('raw');
    applyQualityScale([]); // empty cohort ⇒ identity transform, as before any data loads
  });
  afterEach(() => {
    vi.restoreAllMocks();
    _resetOutlinesForTests();
  });
  afterAll(() => setQualityScaleMode(originalMode));

  it('postal areas carry it (applyQualityScale)', () => {
    const feats = postalFeatures();
    applyQualityScale(feats);
    for (const f of feats) expect(f.properties![QUALITY_PROP]).toBeTypeOf('number');
  });

  it('region features built from the FULL national set carry it', () => {
    const feats = postalFeatures();
    applyQualityScale(feats);
    const fc = buildMetroAreaFeatures(feats);
    const withData = fc.features.filter((f) => !f.properties!._noData);
    expect(withData.length).toBeGreaterThan(0);
    for (const f of withData) expect(f.properties![QUALITY_PROP]).toBeTypeOf('number');
  });

  it('region features built from the PREBUILT aggregates carry it — the grey-landing regression', async () => {
    await withOutlines();
    const fc = buildMetroAreaFeaturesFromAggregates(aggregateRecords, COHORT);
    const withData = fc.features.filter((f) => !f.properties!._noData);
    expect(withData).toHaveLength(2);
    for (const f of withData) expect(f.properties![QUALITY_PROP]).toBeTypeOf('number');
  });

  it('follows the selected display scale on the aggregate landing, not just the panel', async () => {
    await withOutlines();

    const raw = buildMetroAreaFeaturesFromAggregates(aggregateRecords, COHORT);
    const rawByCity = new Map(raw.features.map((f) => [f.properties!.city, f.properties![QUALITY_PROP]]));
    expect(rawByCity.get('helsinki_metro')).toBe(50);
    expect(rawByCity.get('turku')).toBe(44);

    setQualityScaleMode('stretch');
    clearMetroAreaCache({ qualityIndexOnly: true });
    const stretched = buildMetroAreaFeaturesFromAggregates(aggregateRecords, COHORT);
    const byCity = new Map(stretched.features.map((f) => [f.properties!.city, f.properties![QUALITY_PROP]]));
    // Stretched against the POSTAL cohort (40…60), not against the two regional means:
    // 50 → 50, 44 → 20. Against the regional means (44…50) it would have been 100 / 0.
    expect(byCity.get('helsinki_metro')).toBe(50);
    expect(byCity.get('turku')).toBe(20);
    // The raw composite is untouched — it is still what exports and /api/v1 report.
    const turku = stretched.features.find((f) => f.properties!.city === 'turku')!;
    expect(turku.properties!.quality_index).toBe(44);
  });

  it('puts both producers on the same scale, so the aggregates → full-data upgrade does not shift a region', async () => {
    await withOutlines();
    setQualityScaleMode('stretch');

    const fromAggregates = buildMetroAreaFeaturesFromAggregates(aggregateRecords, COHORT);

    const feats = postalFeatures();
    applyQualityScale(feats);
    clearMetroAreaCache();
    const fromFull = buildMetroAreaFeatures(feats);

    const fullByCity = new Map(fromFull.features.map((f) => [f.properties!.city, f.properties![QUALITY_PROP]]));
    for (const f of fromAggregates.features) {
      if (f.properties!._noData) continue;
      expect(fullByCity.get(f.properties!.city)).toBe(f.properties![QUALITY_PROP]);
    }
  });

  it('falls back to the raw composite when no cohort is available', async () => {
    await withOutlines();
    setQualityScaleMode('stretch');
    // No histogram and no postal pass — a stale cached artifact from before the field
    // existed. Better a raw number than a scale invented from 69 regional means.
    const fc = buildMetroAreaFeaturesFromAggregates(aggregateRecords);
    const byCity = new Map(fc.features.map((f) => [f.properties!.city, f.properties![QUALITY_PROP]]));
    expect(byCity.get('helsinki_metro')).toBe(50);
    expect(byCity.get('turku')).toBe(44);
  });
});
