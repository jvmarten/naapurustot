/**
 * Tests for src/utils/regionHit.ts — "which seutukunta is this point in?".
 *
 * regionAt is what turns a tap on no postal area (single-region view) into the
 * "switch / show both" prompt, and what App's findRegionForCoords trusts before the
 * narrowed viewport bboxes (which misfile Hyvinkää and Lohja). So the risks are:
 *  - point-in-polygon correctness: holes honoured, every polygon of a MultiPolygon
 *    tested, [lng, lat] argument order, rays through vertices not double-counted;
 *  - a region the click is NOT in must never be returned (null for sea / abroad);
 *  - the module-level outline cache: one fetch shared by concurrent callers, null on
 *    failure with a retry on the next call, and getRegionOutlines never fetching.
 * Plus a sanity pass over the REAL committed seutukunnat.topojson.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { feature as topoFeature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { regionAt } from '../utils/regionHit';
import { REGION_IDS } from '../utils/regions';

type FetchMock = ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Synthetic GeoJSON helpers
// ---------------------------------------------------------------------------

/** Closed axis-aligned rectangle ring. */
function rect(x0: number, y0: number, x1: number, y1: number): Position[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

function feat(properties: Feature['properties'], geometry: Geometry | null): Feature {
  return { type: 'Feature', properties, geometry: geometry as Geometry };
}

function polygon(region: unknown, rings: Position[][]): Feature {
  return feat({ region }, { type: 'Polygon', coordinates: rings });
}

function multiPolygon(region: unknown, polys: Position[][][]): Feature {
  return feat({ region }, { type: 'MultiPolygon', coordinates: polys });
}

function fc(...features: Feature[]): FeatureCollection {
  return { type: 'FeatureCollection', features };
}

describe('regionAt — point-in-polygon', () => {
  it('returns null for a null FeatureCollection (outlines not loaded yet)', () => {
    expect(regionAt(null, 25, 61)).toBeNull();
  });

  it('returns null for an empty FeatureCollection', () => {
    expect(regionAt(fc(), 25, 61)).toBeNull();
  });

  it('resolves a point inside a simple Polygon', () => {
    const data = fc(polygon('alpha', [rect(0, 0, 10, 10)]));
    expect(regionAt(data, 5, 5)).toBe('alpha');
    expect(regionAt(data, 0.001, 9.999)).toBe('alpha');
  });

  it('returns null for a point outside every feature', () => {
    const data = fc(polygon('alpha', [rect(0, 0, 10, 10)]), polygon('beta', [rect(20, 0, 30, 10)]));
    expect(regionAt(data, 15, 5)).toBeNull(); // the gap between them
    expect(regionAt(data, 5, 11)).toBeNull(); // above alpha
    expect(regionAt(data, -1, 5)).toBeNull(); // left of alpha
    expect(regionAt(data, 31, 5)).toBeNull(); // right of beta
  });

  it('reads the arguments as (lng, lat), i.e. x = lng, y = lat', () => {
    // A wide, short box: lng 20..30, lat 60..62. Swapping the arguments must miss.
    const data = fc(polygon('wide', [rect(20, 60, 30, 62)]));
    expect(regionAt(data, 25, 61)).toBe('wide');
    expect(regionAt(data, 61, 25)).toBeNull();
  });

  it('honours holes: a point in a hole is NOT inside the polygon', () => {
    const data = fc(polygon('donut', [rect(0, 0, 10, 10), rect(4, 4, 6, 6)]));
    expect(regionAt(data, 5, 5)).toBeNull(); // in the hole
    expect(regionAt(data, 2, 2)).toBe('donut'); // in the ring of land
    expect(regionAt(data, 5, 8)).toBe('donut'); // directly above the hole
  });

  it('honours holes regardless of the hole ring winding (even-odd, not winding number)', () => {
    // Same hole, drawn in the opposite direction.
    const hole = rect(4, 4, 6, 6).slice().reverse();
    const data = fc(polygon('donut', [rect(0, 0, 10, 10), hole]));
    expect(regionAt(data, 5, 5)).toBeNull();
    expect(regionAt(data, 2, 2)).toBe('donut');
  });

  it('honours several holes in one polygon', () => {
    const data = fc(polygon('swiss', [rect(0, 0, 10, 10), rect(1, 1, 3, 3), rect(6, 6, 8, 8)]));
    expect(regionAt(data, 2, 2)).toBeNull();
    expect(regionAt(data, 7, 7)).toBeNull();
    expect(regionAt(data, 5, 5)).toBe('swiss');
  });

  it('finds a point on the SECOND polygon of a MultiPolygon', () => {
    const data = fc(multiPolygon('archipelago', [[rect(0, 0, 10, 10)], [rect(20, 20, 30, 30)]]));
    expect(regionAt(data, 25, 25)).toBe('archipelago');
    expect(regionAt(data, 5, 5)).toBe('archipelago');
    expect(regionAt(data, 15, 15)).toBeNull(); // between the two parts
  });

  it('honours a hole in one part of a MultiPolygon, and an island sitting in that hole', () => {
    // Part 1 is a lake-with-hole; part 2 is an island inside the lake's hole.
    // A point on the island must be inside even though part 1 rejects it.
    const data = fc(
      multiPolygon('lakeland', [
        [rect(0, 0, 10, 10), rect(2, 2, 8, 8)],
        [rect(4, 4, 6, 6)],
      ]),
    );
    expect(regionAt(data, 5, 5)).toBe('lakeland'); // on the island
    expect(regionAt(data, 3, 3)).toBeNull(); // in the water between shore and island
    expect(regionAt(data, 1, 1)).toBe('lakeland'); // on the outer shore
  });

  it('resolves a point in one feature\'s hole to the feature that fills the hole', () => {
    // An enclave: region "inner" sits inside a hole in region "outer".
    const data = fc(polygon('outer', [rect(0, 0, 10, 10), rect(4, 4, 6, 6)]), polygon('inner', [rect(4, 4, 6, 6)]));
    expect(regionAt(data, 5, 5)).toBe('inner');
    expect(regionAt(data, 1, 1)).toBe('outer');
  });

  it('handles concave rings (a point in the notch of a U is outside)', () => {
    const u: Position[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [7, 10],
      [7, 3],
      [3, 3],
      [3, 10],
      [0, 10],
      [0, 0],
    ];
    const data = fc(polygon('u', [u]));
    expect(regionAt(data, 5, 6)).toBeNull(); // in the notch
    expect(regionAt(data, 1.5, 8)).toBe('u'); // left arm
    expect(regionAt(data, 8.5, 8)).toBe('u'); // right arm
    expect(regionAt(data, 5, 1.5)).toBe('u'); // base
  });

  it('does not double-count a ray that passes exactly through a vertex', () => {
    // Diamond: the horizontal ray from y = 5 passes through vertices (0,5) and (10,5).
    const diamond: Position[] = [
      [5, 0],
      [10, 5],
      [5, 10],
      [0, 5],
      [5, 0],
    ];
    const data = fc(polygon('diamond', [diamond]));
    expect(regionAt(data, 2, 5)).toBe('diamond');
    expect(regionAt(data, 8, 5)).toBe('diamond');
    expect(regionAt(data, -1, 5)).toBeNull();
    expect(regionAt(data, 12, 5)).toBeNull();
  });

  it('treats an unclosed ring the same as its closed form (the closing edge is implicit)', () => {
    const closed = rect(0, 0, 10, 10);
    const open = closed.slice(0, -1);
    const a = fc(polygon('r', [closed]));
    const b = fc(polygon('r', [open]));
    for (const [x, y] of [
      [5, 5],
      [0.5, 9.5],
      [11, 5],
      [5, -1],
    ]) {
      expect(regionAt(b, x, y)).toBe(regionAt(a, x, y));
    }
    expect(regionAt(b, 5, 5)).toBe('r');
  });

  it('returns null when the containing feature has no string region', () => {
    expect(regionAt(fc(polygon(undefined, [rect(0, 0, 10, 10)])), 5, 5)).toBeNull();
    expect(regionAt(fc(polygon(42, [rect(0, 0, 10, 10)])), 5, 5)).toBeNull();
    expect(regionAt(fc(feat(null, { type: 'Polygon', coordinates: [rect(0, 0, 10, 10)] })), 5, 5)).toBeNull();
    expect(regionAt(fc(feat({ nimi: 'Helsinki' }, { type: 'Polygon', coordinates: [rect(0, 0, 10, 10)] })), 5, 5)).toBeNull();
  });

  it('a nameless feature that does NOT contain the point does not block a later match', () => {
    const data = fc(polygon(undefined, [rect(0, 0, 10, 10)]), polygon('beta', [rect(20, 0, 30, 10)]));
    expect(regionAt(data, 25, 5)).toBe('beta');
  });

  it('first containing feature wins when outlines overlap', () => {
    const data = fc(polygon('first', [rect(0, 0, 10, 10)]), polygon('second', [rect(5, 0, 15, 10)]));
    expect(regionAt(data, 7, 5)).toBe('first'); // in both
    expect(regionAt(data, 12, 5)).toBe('second'); // only in second
    const swapped = fc(data.features[1], data.features[0]);
    expect(regionAt(swapped, 7, 5)).toBe('second');
  });

  it('skips features with null or non-areal geometry', () => {
    const data = fc(
      feat({ region: 'nogeom' }, null),
      feat({ region: 'point' }, { type: 'Point', coordinates: [5, 5] }),
      feat({ region: 'line' }, { type: 'LineString', coordinates: [[0, 5], [10, 5]] }),
      polygon('real', [rect(0, 0, 10, 10)]),
    );
    expect(regionAt(data, 5, 5)).toBe('real');
  });
});

// ---------------------------------------------------------------------------
// loadRegionOutlines / getRegionOutlines (module-level cache)
// ---------------------------------------------------------------------------

/**
 * A three-geometry Topology with no `transform`, so topojson-client reads arcs as
 * absolute coordinates:
 *  - "alpha": Polygon 0..10 with a hole 4..6
 *  - "beta": MultiPolygon, parts at 20..30 and 40..50
 *  - a Polygon at 60..70 with no `region` property
 */
const TOPO: Topology = {
  type: 'Topology',
  objects: {
    seutukunnat: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', arcs: [[0], [1]], properties: { region: 'alpha', nimi: 'Alfa' } },
        { type: 'MultiPolygon', arcs: [[[2]], [[3]]], properties: { region: 'beta', nimi: 'Beeta' } },
        { type: 'Polygon', arcs: [[4]], properties: { nimi: 'Nimetön' } },
      ],
    },
  },
  arcs: [
    rect(0, 0, 10, 10),
    rect(4, 4, 6, 6),
    rect(20, 0, 30, 10),
    rect(40, 0, 50, 10),
    rect(60, 0, 70, 10),
  ],
} as unknown as Topology;

function okJson(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('loadRegionOutlines / getRegionOutlines', () => {
  let fetchMock: FetchMock;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  const fresh = () => import('../utils/regionHit');

  it('getRegionOutlines is null before any load and never triggers a fetch', async () => {
    const mod = await fresh();
    expect(mod.getRegionOutlines()).toBeNull();
    expect(mod.getRegionOutlines()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the seutukunnat.topojson asset and parses it into a FeatureCollection', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const mod = await fresh();

    const outlines = await mod.loadRegionOutlines();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/seutukunnat\.topojson/);
    expect(outlines).not.toBeNull();
    expect(outlines!.type).toBe('FeatureCollection');
    expect(outlines!.features).toHaveLength(3);
    expect(outlines!.features.map((f) => f.properties?.region)).toEqual(['alpha', 'beta', undefined]);
    expect(outlines!.features[0].geometry.type).toBe('Polygon');
    expect(outlines!.features[1].geometry.type).toBe('MultiPolygon');

    // getRegionOutlines hands back the very object the promise resolved with.
    expect(mod.getRegionOutlines()).toBe(outlines);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the parsed outlines resolve points synchronously via regionAt (holes and parts intact)', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const mod = await fresh();
    await mod.loadRegionOutlines();
    const outlines = mod.getRegionOutlines();

    expect(mod.regionAt(outlines, 1, 1)).toBe('alpha');
    expect(mod.regionAt(outlines, 5, 5)).toBeNull(); // alpha's hole survived the decode
    expect(mod.regionAt(outlines, 25, 5)).toBe('beta');
    expect(mod.regionAt(outlines, 45, 5)).toBe('beta'); // second part of the MultiPolygon
    expect(mod.regionAt(outlines, 65, 5)).toBeNull(); // nameless geometry
    expect(mod.regionAt(outlines, 35, 5)).toBeNull(); // gap
  });

  it('uses whatever the first topology object is called', async () => {
    const renamed = { ...TOPO, objects: { anything: TOPO.objects.seutukunnat } };
    fetchMock.mockResolvedValueOnce(okJson(renamed));
    const mod = await fresh();
    const outlines = await mod.loadRegionOutlines();
    expect(outlines?.features).toHaveLength(3);
  });

  it('getRegionOutlines stays null while the fetch is in flight', async () => {
    const pending = deferred<ReturnType<typeof okJson>>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const mod = await fresh();

    const p = mod.loadRegionOutlines();
    await Promise.resolve();
    expect(mod.getRegionOutlines()).toBeNull();

    pending.resolve(okJson(TOPO));
    const outlines = await p;
    expect(mod.getRegionOutlines()).toBe(outlines);
  });

  it('concurrent calls share ONE fetch and one promise', async () => {
    const pending = deferred<ReturnType<typeof okJson>>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const mod = await fresh();

    const a = mod.loadRegionOutlines();
    const b = mod.loadRegionOutlines();
    const c = mod.loadRegionOutlines();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    pending.resolve(okJson(TOPO));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).not.toBeNull();
    expect(rb).toBe(ra);
    expect(rc).toBe(ra);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a call after a successful load reuses the cache (no second fetch)', async () => {
    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const mod = await fresh();
    const first = await mod.loadRegionOutlines();
    const second = await mod.loadRegionOutlines();
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a non-OK response resolves null (no throw), warns, and a later call retries', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) });
    const mod = await fresh();

    await expect(mod.loadRegionOutlines()).resolves.toBeNull();
    expect(mod.getRegionOutlines()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[regions]');
    expect(String(warnSpy.mock.calls[0][1])).toContain('503');

    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const retried = await mod.loadRegionOutlines();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retried?.features).toHaveLength(3);
    expect(mod.getRegionOutlines()).toBe(retried);
  });

  it('a network error resolves null and a later call retries', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const mod = await fresh();

    await expect(mod.loadRegionOutlines()).resolves.toBeNull();
    expect(mod.getRegionOutlines()).toBeNull();

    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    await expect(mod.loadRegionOutlines()).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a body that is not JSON (e.g. a truncated / 0-byte asset) resolves null and retries', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    });
    const mod = await fresh();

    await expect(mod.loadRegionOutlines()).resolves.toBeNull();
    expect(mod.getRegionOutlines()).toBeNull();

    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    await expect(mod.loadRegionOutlines()).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('concurrent callers of a failing fetch all get null, and the next call issues exactly one retry', async () => {
    const pending = deferred<{ ok: boolean; status: number; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const mod = await fresh();

    const a = mod.loadRegionOutlines();
    const b = mod.loadRegionOutlines();
    pending.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    await expect(Promise.all([a, b])).resolves.toEqual([null, null]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const c = mod.loadRegionOutlines();
    const d = mod.loadRegionOutlines();
    expect(d).toBe(c);
    await c;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a topology with no objects resolves null, publishes nothing, and a later call retries', async () => {
    // Like metroAreas.ts: caching an empty parse would switch region taps off for the
    // whole session instead of recovering on the next call.
    fetchMock.mockResolvedValueOnce(okJson({ type: 'Topology', objects: {}, arcs: [] }));
    const mod = await fresh();
    await expect(mod.loadRegionOutlines()).resolves.toBeNull();
    expect(mod.getRegionOutlines()).toBeNull();
    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    const fc = await mod.loadRegionOutlines();
    expect(fc?.type).toBe('FeatureCollection');
    expect(mod.getRegionOutlines()).toBe(fc);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a collection with no features is an empty parse too, and retries', async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      type: 'Topology', arcs: [], objects: { seutukunnat: { type: 'GeometryCollection', geometries: [] } },
    }));
    const mod = await fresh();
    await expect(mod.loadRegionOutlines()).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(okJson(TOPO));
    await expect(mod.loadRegionOutlines()).resolves.not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The real committed outline file
// ---------------------------------------------------------------------------

// Vite-native raw read, matching i18nUnusedKeys.test.ts / mapQueryGuard.test.ts —
// node:fs is not in this tsconfig's types.
const outlineFiles = import.meta.glob('../data/seutukunnat.topojson', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function realTopology(): Topology {
  const raw = outlineFiles['../data/seutukunnat.topojson'];
  if (!raw) throw new Error(`could not read seutukunnat.topojson (globbed: ${Object.keys(outlineFiles).join(', ')})`);
  return JSON.parse(raw) as Topology;
}

describe('regionAt against the real seutukunnat.topojson', () => {
  const topo = realTopology();
  const objName = Object.keys(topo.objects)[0];
  const real = topoFeature(topo, topo.objects[objName]) as FeatureCollection;

  it('decodes to 69 areal features, each keyed by a distinct known region id', () => {
    expect(real.type).toBe('FeatureCollection');
    expect(real.features).toHaveLength(REGION_IDS.length);
    const known = new Set<string>(REGION_IDS);
    const seen = new Set<string>();
    for (const f of real.features) {
      const r = f.properties?.region;
      expect(typeof r).toBe('string');
      expect(known.has(r as string), `unknown region id ${String(r)}`).toBe(true);
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
      seen.add(r as string);
    }
    expect(seen.size).toBe(REGION_IDS.length);
  });

  it.each([
    ['Lahti city centre', 25.66, 60.98, 'lahti'],
    ['Helsinki', 24.94, 60.17, 'helsinki_metro'],
    // Hyvinkää and Lohja belong to helsinki_metro but sit outside its viewport bbox —
    // the misfiling regionAt exists to fix in App.findRegionForCoords.
    ['Hyvinkää', 24.86, 60.63, 'helsinki_metro'],
    ['Lohja', 24.07, 60.25, 'helsinki_metro'],
    ['Tampere', 23.76, 61.5, 'tampere'],
    ['Turku', 22.27, 60.45, 'turku'],
    ['Oulu', 25.47, 65.01, 'oulu'],
    ['Rovaniemi', 25.73, 66.5, 'rovaniemi'],
  ])('%s [%f, %f] → %s', (_name, lng, lat, expected) => {
    expect(regionAt(real, lng, lat)).toBe(expected);
  });

  it.each([
    ['the sea south of Helsinki', 24.9, 59.9],
    ['Stockholm', 18.07, 59.33],
    ['Tallinn', 24.75, 59.44],
  ])('%s → null', (_name, lng, lat) => {
    expect(regionAt(real, lng, lat)).toBeNull();
  });

  it('outlines do not overlap on a 0.2° lattice over Finland, so "first match wins" is order-independent', () => {
    // A per-feature bbox prefilter keeps this cheap; the containment test itself is
    // regionAt on a one-feature collection, i.e. exactly the production code path.
    const boxes = real.features.map((f) => {
      const g = f.geometry as { type: 'Polygon' | 'MultiPolygon'; coordinates: Position[][] | Position[][][] };
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Position[][][];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of polys) for (const ring of p) for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return { single: fc(f), minX, minY, maxX, maxY };
    });

    const overlaps: string[] = [];
    let insideAny = 0;
    for (let lat = 59.7; lat <= 70.1; lat += 0.2) {
      for (let lng = 19.5; lng <= 31.6; lng += 0.2) {
        const hits: string[] = [];
        for (const b of boxes) {
          if (lng < b.minX || lng > b.maxX || lat < b.minY || lat > b.maxY) continue;
          const r = regionAt(b.single, lng, lat);
          if (r) hits.push(r);
        }
        if (hits.length > 0) insideAny++;
        if (hits.length > 1) overlaps.push(`${lng.toFixed(1)},${lat.toFixed(1)}: ${hits.join('+')}`);
      }
    }
    expect(overlaps).toEqual([]);
    // Sanity: the lattice actually lands on land (Finland is a large share of this box).
    expect(insideAny).toBeGreaterThan(500);
  });

  it('loadRegionOutlines parses the real file end-to-end (object name discovered, not assumed)', async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValueOnce(okJson(topo));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const mod = await import('../utils/regionHit');
      const outlines = await mod.loadRegionOutlines();
      expect(outlines?.features).toHaveLength(REGION_IDS.length);
      expect(mod.regionAt(mod.getRegionOutlines(), 25.66, 60.98)).toBe('lahti');
      expect(mod.regionAt(mod.getRegionOutlines(), 24.9, 59.9)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
