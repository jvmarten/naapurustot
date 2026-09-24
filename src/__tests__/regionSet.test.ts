/**
 * Tests for utils/regionSet.ts — the multi-region postal-code view's state machine,
 * URL codec, camera framing and data merge.
 *
 * Risks guarded here:
 *  - A bare CityFilter dispatch (search, deep link, CitySelector …) must keep its
 *    single-region meaning and drop added regions; a no-op switch must keep the state
 *    object's identity so React bails out of the re-render.
 *  - `{ add }` / `{ remove }` must never produce a state with the primary repeated in
 *    `extra`, duplicate extras, extras on the national view, or zero regions.
 *  - The `city` URL value must round-trip through regionKey → parseCityParam.
 *  - Merged averages must be recomputed over the union — averaging the per-region
 *    averages is wrong for every ratio metric.
 *  - "vs. seutu" baselines must come from each area's OWN region.
 */
import { describe, it, expect } from 'vitest';
import type { Feature } from 'geojson';
import {
  NO_REGIONS,
  regionReducer,
  displayedRegions,
  regionKey,
  parseCityParam,
  regionsViewport,
  mergeRegionData,
  averagesByRegion,
  type RegionSelection,
  type RegionAction,
} from '../utils/regionSet';
import { computeMetroAverages, type NeighborhoodProperties } from '../utils/metrics';
import { getQualityBands } from '../utils/qualityBands';
import { applyQualityScale } from '../utils/qualityScale';
import { CITY_VIEWPORTS } from '../utils/mapConstants';
import { REGION_IDS, type RegionId } from '../utils/regions';
import type { ProcessedData } from '../utils/dataLoader';

const sel = (city: RegionSelection['city'], extra: RegionId[] = NO_REGIONS): RegionSelection => ({ city, extra });

function feature(props: Partial<NeighborhoodProperties> & Record<string, unknown>): Feature {
  return {
    type: 'Feature',
    properties: { pno: '00000', nimi: 'Test', namn: 'Test', ...props },
    geometry: { type: 'Point', coordinates: [25, 60] },
  };
}

function processed(features: Feature[]): ProcessedData {
  return { data: { type: 'FeatureCollection', features }, metroAverages: computeMetroAverages(features) };
}

// ---------------------------------------------------------------------------
// regionReducer
// ---------------------------------------------------------------------------

describe('regionReducer — bare CityFilter switch', () => {
  it('returns the SAME state object when switching to the current single region', () => {
    const s = sel('lahti');
    expect(regionReducer(s, 'lahti')).toBe(s);
  });

  it('returns the same state object for a no-op switch to "all"', () => {
    const s = sel('all');
    expect(regionReducer(s, 'all')).toBe(s);
  });

  it('keeps identity even when the empty extra list is not the shared NO_REGIONS', () => {
    const s: RegionSelection = { city: 'turku', extra: [] };
    expect(regionReducer(s, 'turku')).toBe(s);
  });

  it('switching to a different region yields exactly that region with NO_REGIONS', () => {
    const next = regionReducer(sel('lahti'), 'turku');
    expect(next).toEqual({ city: 'turku', extra: [] });
    expect(next.extra).toBe(NO_REGIONS);
  });

  it('switching to the SAME primary drops the added regions (single-region meaning)', () => {
    const s = sel('helsinki_metro', ['lahti', 'turku']);
    const next = regionReducer(s, 'helsinki_metro');
    expect(next).not.toBe(s);
    expect(next).toEqual({ city: 'helsinki_metro', extra: [] });
    expect(next.extra).toBe(NO_REGIONS);
  });

  it('switching to a region that is currently an extra makes it the only region', () => {
    const next = regionReducer(sel('helsinki_metro', ['lahti']), 'lahti');
    expect(next).toEqual({ city: 'lahti', extra: [] });
    expect(next.extra).toBe(NO_REGIONS);
  });

  it('switching to "all" from a multi-region view drops every extra', () => {
    const next = regionReducer(sel('helsinki_metro', ['lahti']), 'all');
    expect(next).toEqual({ city: 'all', extra: [] });
    expect(next.extra).toBe(NO_REGIONS);
  });

  it('does not mutate the previous state', () => {
    const extra: RegionId[] = ['lahti'];
    const s = sel('helsinki_metro', extra);
    regionReducer(s, 'turku');
    expect(s).toEqual({ city: 'helsinki_metro', extra: ['lahti'] });
    expect(s.extra).toBe(extra);
  });
});

describe('regionReducer — { add }', () => {
  it('appends a new region after the existing ones (primary unchanged)', () => {
    const one = regionReducer(sel('helsinki_metro'), { add: 'lahti' });
    expect(one).toEqual({ city: 'helsinki_metro', extra: ['lahti'] });
    const two = regionReducer(one, { add: 'turku' });
    expect(two).toEqual({ city: 'helsinki_metro', extra: ['lahti', 'turku'] });
  });

  it('does not mutate the previous extra array', () => {
    const extra: RegionId[] = ['lahti'];
    const s = sel('helsinki_metro', extra);
    const next = regionReducer(s, { add: 'turku' });
    expect(extra).toEqual(['lahti']);
    expect(next.extra).not.toBe(extra);
  });

  it('is a no-op (same object) on the national view — "all" has no extras', () => {
    const s = sel('all');
    expect(regionReducer(s, { add: 'lahti' })).toBe(s);
  });

  it('is a no-op when adding the primary', () => {
    const s = sel('lahti');
    expect(regionReducer(s, { add: 'lahti' })).toBe(s);
    const multi = sel('lahti', ['turku']);
    expect(regionReducer(multi, { add: 'lahti' })).toBe(multi);
  });

  it('is a no-op when adding a region that is already an extra', () => {
    const s = sel('helsinki_metro', ['lahti', 'turku']);
    expect(regionReducer(s, { add: 'turku' })).toBe(s);
    expect(regionReducer(s, { add: 'lahti' })).toBe(s);
  });
});

describe('regionReducer — { remove }', () => {
  it('removes an extra and keeps the primary and the other extras in order', () => {
    const s = sel('helsinki_metro', ['lahti', 'turku', 'tampere']);
    expect(regionReducer(s, { remove: 'turku' })).toEqual({ city: 'helsinki_metro', extra: ['lahti', 'tampere'] });
  });

  it('removing the only extra leaves a single-region state', () => {
    const next = regionReducer(sel('helsinki_metro', ['lahti']), { remove: 'lahti' });
    expect(next).toEqual({ city: 'helsinki_metro', extra: [] });
    expect(displayedRegions(next)).toEqual(['helsinki_metro']);
    expect(regionKey(next)).toBe('helsinki_metro');
  });

  it('removing the primary promotes the FIRST extra and keeps the rest in order', () => {
    const next = regionReducer(sel('helsinki_metro', ['lahti', 'turku', 'tampere']), { remove: 'helsinki_metro' });
    expect(next).toEqual({ city: 'lahti', extra: ['turku', 'tampere'] });
  });

  it('removing the primary with a single extra leaves that extra alone', () => {
    const next = regionReducer(sel('helsinki_metro', ['lahti']), { remove: 'helsinki_metro' });
    expect(next).toEqual({ city: 'lahti', extra: [] });
    expect(regionKey(next)).toBe('lahti');
  });

  it('removing the only region is a no-op (same object) — the map never shows zero regions', () => {
    const s = sel('lahti');
    expect(regionReducer(s, { remove: 'lahti' })).toBe(s);
  });

  it('removing a region that is not displayed is a no-op (same object)', () => {
    const s = sel('helsinki_metro', ['lahti']);
    expect(regionReducer(s, { remove: 'turku' })).toBe(s);
    const single = sel('helsinki_metro');
    expect(regionReducer(single, { remove: 'turku' })).toBe(single);
  });

  it('removing anything on the national view is a no-op (same object)', () => {
    const s = sel('all');
    expect(regionReducer(s, { remove: 'lahti' })).toBe(s);
  });

  it('does not mutate the previous extra array', () => {
    const extra: RegionId[] = ['lahti', 'turku'];
    const s = sel('helsinki_metro', extra);
    regionReducer(s, { remove: 'lahti' });
    regionReducer(s, { remove: 'helsinki_metro' });
    expect(extra).toEqual(['lahti', 'turku']);
    expect(s.city).toBe('helsinki_metro');
  });
});

describe('regionReducer — invariants over random action sequences', () => {
  // Deterministic LCG so a failure is reproducible.
  function lcg(seed: number) {
    let x = seed >>> 0;
    return () => {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      return x / 2 ** 32;
    };
  }
  const POOL: RegionId[] = ['helsinki_metro', 'lahti', 'turku', 'tampere', 'oulu'];

  it('never duplicates, never repeats the primary in extra, never adds extras to "all", round-trips the URL', () => {
    const rnd = lcg(12345);
    const pick = () => POOL[Math.floor(rnd() * POOL.length)];
    let s: RegionSelection = sel('helsinki_metro');
    for (let i = 0; i < 2000; i++) {
      const roll = rnd();
      const action: RegionAction =
        roll < 0.1 ? 'all' : roll < 0.25 ? pick() : roll < 0.65 ? { add: pick() } : { remove: pick() };
      const prevCount = displayedRegions(s).length;
      const next = regionReducer(s, action);

      const shown = displayedRegions(next);
      expect(new Set(shown).size).toBe(shown.length);
      expect(next.extra).not.toContain(next.city);
      if (next.city === 'all') expect(next.extra).toHaveLength(0);
      else expect(shown.length).toBeGreaterThanOrEqual(1);
      // add/remove change the displayed count by at most one; a no-op keeps identity.
      if (typeof action === 'object') {
        expect(Math.abs(shown.length - prevCount)).toBeLessThanOrEqual(1);
        if (shown.length === prevCount && next.city === s.city) expect(next).toBe(s);
      }
      // The URL value decodes back to the same selection.
      expect(parseCityParam(regionKey(next))).toEqual({ city: next.city, extra: next.extra });
      s = next;
    }
  });
});

// ---------------------------------------------------------------------------
// displayedRegions / regionKey
// ---------------------------------------------------------------------------

describe('displayedRegions', () => {
  it('is the shared empty list for the national view', () => {
    expect(displayedRegions(sel('all'))).toBe(NO_REGIONS);
  });

  it('is [primary] for a single region', () => {
    expect(displayedRegions(sel('lahti'))).toEqual(['lahti']);
  });

  it('lists the primary first, then the extras in insertion order', () => {
    expect(displayedRegions(sel('turku', ['lahti', 'helsinki_metro']))).toEqual(['turku', 'lahti', 'helsinki_metro']);
  });

  it('returns a fresh array (callers cannot mutate the state through it)', () => {
    const s = sel('turku', ['lahti']);
    const shown = displayedRegions(s);
    shown.push('oulu');
    expect(s.extra).toEqual(['lahti']);
  });
});

describe('regionKey', () => {
  it("is 'all' for the national view", () => {
    expect(regionKey(sel('all'))).toBe('all');
  });

  it('is the bare id for a single region (unchanged legacy URL value)', () => {
    expect(regionKey(sel('lahti'))).toBe('lahti');
  });

  it('is a primary-first comma list for several regions', () => {
    expect(regionKey(sel('helsinki_metro', ['lahti', 'turku']))).toBe('helsinki_metro,lahti,turku');
  });

  it('is order-sensitive: the primary is part of the identity', () => {
    expect(regionKey(sel('lahti', ['helsinki_metro']))).not.toBe(regionKey(sel('helsinki_metro', ['lahti'])));
  });
});

// ---------------------------------------------------------------------------
// parseCityParam
// ---------------------------------------------------------------------------

describe('parseCityParam', () => {
  it('null and empty string → no city, shared empty extras', () => {
    for (const raw of [null, '']) {
      const r = parseCityParam(raw);
      expect(r.city).toBeNull();
      expect(r.extra).toBe(NO_REGIONS);
    }
  });

  it("'all' → the national view", () => {
    const r = parseCityParam('all');
    expect(r).toEqual({ city: 'all', extra: [] });
    expect(r.extra).toBe(NO_REGIONS);
  });

  it('every single valid region id parses to itself with NO_REGIONS', () => {
    for (const id of REGION_IDS) {
      const r = parseCityParam(id);
      expect(r.city).toBe(id);
      expect(r.extra).toBe(NO_REGIONS);
    }
  });

  it('an unknown id → null (falls back to the default city upstream)', () => {
    expect(parseCityParam('bogus')).toEqual({ city: null, extra: [] });
    expect(parseCityParam('bogus').extra).toBe(NO_REGIONS);
  });

  it('ids are case- and whitespace-sensitive (no silent normalisation)', () => {
    expect(parseCityParam('Lahti').city).toBeNull();
    expect(parseCityParam(' lahti').city).toBeNull();
    expect(parseCityParam('ALL').city).toBeNull();
  });

  it("'helsinki_metro,lahti' → primary helsinki_metro with lahti added", () => {
    expect(parseCityParam('helsinki_metro,lahti')).toEqual({ city: 'helsinki_metro', extra: ['lahti'] });
  });

  it('keeps the list order of a longer list', () => {
    expect(parseCityParam('turku,lahti,helsinki_metro')).toEqual({ city: 'turku', extra: ['lahti', 'helsinki_metro'] });
  });

  it("duplicates collapse: 'lahti,lahti' → single lahti with NO_REGIONS", () => {
    const r = parseCityParam('lahti,lahti');
    expect(r).toEqual({ city: 'lahti', extra: [] });
    expect(r.extra).toBe(NO_REGIONS);
  });

  it('a repeated extra keeps its first position and drops later repeats', () => {
    expect(parseCityParam('helsinki_metro,lahti,turku,lahti,helsinki_metro')).toEqual({
      city: 'helsinki_metro',
      extra: ['lahti', 'turku'],
    });
  });

  it("an invalid primary falls through to the next valid id: 'bogus,lahti' → lahti", () => {
    const r = parseCityParam('bogus,lahti');
    expect(r).toEqual({ city: 'lahti', extra: [] });
    expect(r.extra).toBe(NO_REGIONS);
  });

  it('unknown ids and empty segments inside a list are dropped', () => {
    expect(parseCityParam('helsinki_metro,,bogus,lahti,')).toEqual({ city: 'helsinki_metro', extra: ['lahti'] });
  });

  it('a list of only unknown ids → null', () => {
    expect(parseCityParam('bogus,nope')).toEqual({ city: null, extra: [] });
    expect(parseCityParam(',,,')).toEqual({ city: null, extra: [] });
  });

  it("'all' is only meaningful ALONE: 'all,lahti' drops 'all' and yields lahti", () => {
    // 'all' is not a region id, so inside a list it is filtered like any unknown token —
    // the national view can never carry extras.
    expect(parseCityParam('all,lahti')).toEqual({ city: 'lahti', extra: [] });
    expect(parseCityParam('lahti,all,turku')).toEqual({ city: 'lahti', extra: ['turku'] });
    expect(parseCityParam('all,all')).toEqual({ city: null, extra: [] });
  });

  it('never returns the primary inside extra', () => {
    for (const raw of ['lahti,lahti', 'lahti,turku,lahti', 'bogus,lahti,lahti,turku']) {
      const r = parseCityParam(raw);
      expect(r.extra).not.toContain(r.city);
    }
  });

  it('round-trips regionKey for single, multi and national selections', () => {
    const cases: RegionSelection[] = [
      sel('all'),
      sel('lahti'),
      sel('helsinki_metro', ['lahti']),
      sel('tampere', ['turku', 'oulu', 'helsinki_metro']),
    ];
    for (const s of cases) expect(parseCityParam(regionKey(s))).toEqual(s);
  });
});

// ---------------------------------------------------------------------------
// regionsViewport
// ---------------------------------------------------------------------------

describe('regionsViewport', () => {
  it('returns null for an empty list', () => {
    expect(regionsViewport([])).toBeNull();
  });

  it('returns null when every id is unknown', () => {
    expect(regionsViewport(['bogus', 'nope'])).toBeNull();
  });

  it('a single region frames exactly its preset bounds, centred on the bounds midpoint', () => {
    const vb = CITY_VIEWPORTS.lahti.bounds;
    const vp = regionsViewport(['lahti']);
    expect(vp).not.toBeNull();
    expect(vp!.bounds).toEqual(vb);
    expect(vp!.center[0]).toBeCloseTo((vb[0] + vb[2]) / 2, 10);
    expect(vp!.center[1]).toBeCloseTo((vb[1] + vb[3]) / 2, 10);
    // No zoom: the camera fits the bounds instead of using a single region's preset.
    expect(vp!.zoom).toBeUndefined();
  });

  it('returns a copy — mutating the result cannot corrupt CITY_VIEWPORTS', () => {
    const before = [...CITY_VIEWPORTS.lahti.bounds];
    const vp = regionsViewport(['lahti'])!;
    expect(vp.bounds).not.toBe(CITY_VIEWPORTS.lahti.bounds);
    vp.bounds[0] = 0;
    vp.bounds[3] = 99;
    expect(CITY_VIEWPORTS.lahti.bounds).toEqual(before);
  });

  it('frames the union of two regions (helsinki_metro + lahti)', () => {
    const a = CITY_VIEWPORTS.helsinki_metro.bounds;
    const b = CITY_VIEWPORTS.lahti.bounds;
    const expected: [number, number, number, number] = [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ];
    const vp = regionsViewport(['helsinki_metro', 'lahti'])!;
    expect(vp.bounds).toEqual(expected);
    expect(vp.center[0]).toBeCloseTo((expected[0] + expected[2]) / 2, 10);
    expect(vp.center[1]).toBeCloseTo((expected[1] + expected[3]) / 2, 10);
    // Contains both presets.
    for (const r of [a, b]) {
      expect(vp.bounds[0]).toBeLessThanOrEqual(r[0]);
      expect(vp.bounds[1]).toBeLessThanOrEqual(r[1]);
      expect(vp.bounds[2]).toBeGreaterThanOrEqual(r[2]);
      expect(vp.bounds[3]).toBeGreaterThanOrEqual(r[3]);
    }
  });

  it('is independent of list order', () => {
    const ab = regionsViewport(['turku', 'oulu', 'lahti']);
    const ba = regionsViewport(['lahti', 'turku', 'oulu']);
    expect(ab).toEqual(ba);
  });

  it('skips unknown ids without disturbing the union', () => {
    expect(regionsViewport(['bogus', 'lahti', 'nope'])).toEqual(regionsViewport(['lahti']));
    expect(regionsViewport(['turku', 'bogus', 'lahti'])).toEqual(regionsViewport(['turku', 'lahti']));
  });

  it('a repeated id does not change the result', () => {
    expect(regionsViewport(['lahti', 'lahti'])).toEqual(regionsViewport(['lahti']));
  });

  it('the union of every region is well-formed (min < max on both axes)', () => {
    const vp = regionsViewport(REGION_IDS)!;
    expect(vp.bounds[0]).toBeLessThan(vp.bounds[2]);
    expect(vp.bounds[1]).toBeLessThan(vp.bounds[3]);
    for (const id of REGION_IDS) {
      const r = CITY_VIEWPORTS[id].bounds;
      expect(vp.bounds[0]).toBeLessThanOrEqual(r[0]);
      expect(vp.bounds[3]).toBeGreaterThanOrEqual(r[3]);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeRegionData
// ---------------------------------------------------------------------------

describe('mergeRegionData', () => {
  // Region A: 10 % unemployed (50 / 500), 20 % foreign-language (200 / 1000), income 20k.
  const a1 = feature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, pt_vakiy: 500, pt_tyott: 50, foreign_language_pct: 20, hr_mtu: 20000 });
  // Region B: 20 % unemployed (300 / 1500), 10 % foreign-language (300 / 3000), income 40k.
  const b1 = feature({ pno: '15100', city: 'lahti', he_vakiy: 3000, pt_vakiy: 1500, pt_tyott: 300, foreign_language_pct: 10, hr_mtu: 40000 });
  const b2 = feature({ pno: '15110', city: 'lahti', he_vakiy: 1000, pt_vakiy: 500, pt_tyott: 100, foreign_language_pct: 10, hr_mtu: 40000 });

  it('concatenates the features in region order, then feature order', () => {
    const merged = mergeRegionData([processed([a1]), processed([b1, b2])]);
    expect(merged.data.type).toBe('FeatureCollection');
    expect(merged.data.features).toHaveLength(3);
    expect(merged.data.features[0]).toBe(a1);
    expect(merged.data.features[1]).toBe(b1);
    expect(merged.data.features[2]).toBe(b2);
    const reversed = mergeRegionData([processed([b1, b2]), processed([a1])]);
    expect(reversed.data.features.map((f) => f.properties?.pno)).toEqual(['15100', '15110', '00100']);
  });

  it('shares the feature objects (no copies) and does not mutate the inputs', () => {
    const ra = processed([a1]);
    const rb = processed([b1, b2]);
    const raFeatures = ra.data.features;
    const raAverages = { ...ra.metroAverages };
    const merged = mergeRegionData([ra, rb]);
    expect(merged.data).not.toBe(ra.data);
    expect(merged.data.features).not.toBe(raFeatures);
    expect(ra.data.features).toHaveLength(1);
    expect(rb.data.features).toHaveLength(2);
    expect(ra.metroAverages).toEqual(raAverages);
    expect(merged.metroAverages).not.toBe(ra.metroAverages);
  });

  it('metroAverages equals computeMetroAverages over the concatenated features', () => {
    const merged = mergeRegionData([processed([a1]), processed([b1, b2])]);
    expect(merged.metroAverages).toEqual(computeMetroAverages([a1, b1, b2]));
  });

  it('recomputes ratio metrics over the union — NOT the mean of the per-region averages', () => {
    const ra = processed([a1]);
    const rb = processed([b1]);
    expect(ra.metroAverages.unemployment_rate).toBe(10);
    expect(rb.metroAverages.unemployment_rate).toBe(20);
    const merged = mergeRegionData([ra, rb]);
    // Σ unemployed / Σ labour force = (50 + 300) / (500 + 1500) = 17.5 %, not (10 + 20) / 2 = 15 %.
    expect(merged.metroAverages.unemployment_rate).toBe(17.5);
    expect(merged.metroAverages.unemployment_rate).not.toBe(15);
    // pctOfPop: (200 + 300) / (1000 + 3000) = 12.5 %, not (20 + 10) / 2 = 15 %.
    expect(merged.metroAverages.foreign_language_pct).toBe(12.5);
    // Population-weighted: (1000·20k + 3000·40k) / 4000 = 35k, not 30k.
    expect(merged.metroAverages.hr_mtu).toBe(35000);
    expect(merged.metroAverages.he_vakiy).toBe(4000);
  });

  it('ignores the inputs’ own metroAverages (recomputes from features, never blends them)', () => {
    const stale: ProcessedData = {
      data: { type: 'FeatureCollection', features: [a1] },
      metroAverages: { unemployment_rate: 99, hr_mtu: 1 },
    };
    const merged = mergeRegionData([stale, processed([b1])]);
    expect(merged.metroAverages).toEqual(computeMetroAverages([a1, b1]));
  });

  it('a single region merges to its own features and the same averages', () => {
    const r = processed([b1, b2]);
    const merged = mergeRegionData([r]);
    expect(merged.data.features).toEqual(r.data.features);
    expect(merged.metroAverages).toEqual(r.metroAverages);
  });

  it('an empty list yields an empty FeatureCollection with the empty-set averages', () => {
    const merged = mergeRegionData([]);
    expect(merged.data).toEqual({ type: 'FeatureCollection', features: [] });
    expect(merged.metroAverages).toEqual(computeMetroAverages([]));
  });

  it('a region with no features contributes nothing', () => {
    const merged = mergeRegionData([processed([]), processed([a1])]);
    expect(merged.data.features).toEqual([a1]);
    expect(merged.metroAverages).toEqual(computeMetroAverages([a1]));
  });
});

// ---------------------------------------------------------------------------
// averagesByRegion
// ---------------------------------------------------------------------------

describe('averagesByRegion', () => {
  const h1 = feature({ pno: '00100', city: 'helsinki_metro', he_vakiy: 1000, pt_vakiy: 500, pt_tyott: 50, hr_mtu: 20000 });
  const h2 = feature({ pno: '00200', city: 'helsinki_metro', he_vakiy: 1000, pt_vakiy: 500, pt_tyott: 150, hr_mtu: 30000 });
  const l1 = feature({ pno: '15100', city: 'lahti', he_vakiy: 3000, pt_vakiy: 1500, pt_tyott: 300, hr_mtu: 40000 });

  it('groups by properties.city and computes each region over its OWN features', () => {
    // Interleaved on purpose: grouping must not depend on contiguity.
    const out = averagesByRegion([h1, l1, h2]);
    expect(Object.keys(out).sort()).toEqual(['helsinki_metro', 'lahti']);
    expect(out.helsinki_metro).toEqual(computeMetroAverages([h1, h2]));
    expect(out.lahti).toEqual(computeMetroAverages([l1]));
    // helsinki_metro: (50 + 150) / 1000 = 20 %; lahti: 300 / 1500 = 20 %; the blend would be
    // (500 / 2500) = 20 % too — so check a metric where the blend differs.
    expect(out.helsinki_metro.hr_mtu).toBe(25000);
    expect(out.lahti.hr_mtu).toBe(40000);
    expect(computeMetroAverages([h1, h2, l1]).hr_mtu).toBe(34000);
  });

  it('a region baseline is not a blend with the other regions on the map', () => {
    const out = averagesByRegion([h1, h2, l1]);
    expect(out.helsinki_metro.he_vakiy).toBe(2000);
    expect(out.lahti.he_vakiy).toBe(3000);
  });

  it('skips features without a city, or with a non-string city', () => {
    const noCity = feature({ pno: '99999', he_vakiy: 50000, hr_mtu: 1 });
    const numCity: Feature = {
      type: 'Feature',
      properties: { pno: '99998', city: 42, he_vakiy: 50000, hr_mtu: 1 },
      geometry: { type: 'Point', coordinates: [25, 60] },
    };
    const nullProps: Feature = { type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [25, 60] } };
    const out = averagesByRegion([noCity, h1, numCity, nullProps, l1]);
    expect(Object.keys(out).sort()).toEqual(['helsinki_metro', 'lahti']);
    expect(out.helsinki_metro).toEqual(computeMetroAverages([h1]));
    expect(out.lahti).toEqual(computeMetroAverages([l1]));
  });

  it('returns an empty object for no features, or none carrying a city', () => {
    expect(averagesByRegion([])).toEqual({});
    expect(averagesByRegion([feature({ he_vakiy: 100 })])).toEqual({});
  });

  it('agrees with mergeRegionData: each merged region’s group equals that region loaded alone', () => {
    const ra = processed([h1, h2]);
    const rb = processed([l1]);
    const merged = mergeRegionData([ra, rb]);
    const out = averagesByRegion(merged.data.features);
    expect(out.helsinki_metro).toEqual(ra.metroAverages);
    expect(out.lahti).toEqual(rb.metroAverages);
  });
});

describe('mergeRegionData — quality scale over the union', () => {
  it('re-derives the global quality cohort over every merged region, not the last one processed', () => {
    const a = [1, 2, 3].map((i) => feature({ pno: `0010${i}`, city: 'helsinki_metro', quality_index: 40 + i }));
    const b = [1, 2].map((i) => feature({ pno: `1510${i}`, city: 'lahti', quality_index: 60 + i }));
    // Each region's own processing points the cohort at itself; Lahti "finished last".
    applyQualityScale(a);
    applyQualityScale(b);
    expect(getQualityBands()?.n).toBe(2);
    const merged = mergeRegionData([processed(a), processed(b)]);
    expect(getQualityBands()?.n).toBe(5);
    for (const f of merged.data.features) {
      expect(typeof f.properties?.quality_display).toBe('number');
    }
  });
});

describe('averagesByRegion — prototype-safe grouping', () => {
  it('a city named like an Object.prototype member is grouped, not crashed on', () => {
    const fs = ['constructor', 'toString', '__proto__'].map((c, i) => {
      const f = feature({ pno: `0000${i}`, he_vakiy: 100 });
      f.properties!.city = c; // deliberately not a RegionId
      return f;
    });
    const out = averagesByRegion(fs);
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'constructor', 'toString']);
  });
});
