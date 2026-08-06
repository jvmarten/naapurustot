import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  findShard,
  findShardOverlapping,
  hasShards,
  planCoverage,
  resolveBuildings,
  shardBbox,
  MAX_OSM_AREA_KM2,
  type ShardEntry,
} from '../live/buildingShards';
import manifest from '../data/buildings_manifest.json';
import { bboxAreaKm2, bboxSubtract, type Bbox } from '../live/shadows';

/**
 * The shard manifest is real committed data, so these assertions are written to
 * hold whether or not a shard happens to be built — what matters is that the
 * SELECTION logic is correct and that a viewport with no shard always reaches the
 * OSM fallback rather than silently rendering nothing.
 */
const SHARDS = manifest as unknown as Record<string, ShardEntry>;

/** Somewhere with certainly no city model — the Gulf of Guinea. */
const NOWHERE: Bbox = { south: -0.01, west: -0.01, north: 0.01, east: 0.01 };

describe('findShard', () => {
  it('reports no shard for a point far outside every configured extent', () => {
    expect(findShard(0, 0)).toBeNull();
    // Utsjoki — inside Finland, but no city model up there.
    expect(findShard(27.0289, 69.9081)).toBeNull();
  });

  it('agrees with hasShards about whether any shard exists', () => {
    expect(hasShards()).toBe(Object.keys(SHARDS).length > 0);
  });

  it('finds every configured shard at its own bbox centre', () => {
    for (const [id, entry] of Object.entries(SHARDS)) {
      const [minLon, minLat, maxLon, maxLat] = entry.bbox;
      const found = findShard((minLon + maxLon) / 2, (minLat + maxLat) / 2);
      expect(found, `shard ${id} not found at its own centre`).not.toBeNull();
    }
  });

  it('gives every configured shard a sane bbox and a positive count', () => {
    for (const [id, entry] of Object.entries(SHARDS)) {
      const [minLon, minLat, maxLon, maxLat] = entry.bbox;
      expect(maxLon, `${id} lon extent`).toBeGreaterThan(minLon);
      expect(maxLat, `${id} lat extent`).toBeGreaterThan(minLat);
      // Anything built from a Finnish city model must land inside Finland.
      expect(minLon).toBeGreaterThan(19);
      expect(maxLon).toBeLessThan(32);
      expect(minLat).toBeGreaterThan(59);
      expect(maxLat).toBeLessThan(71);
      expect(entry.count).toBeGreaterThan(0);
    }
  });
});

/** The first configured shard, or null when none is built. */
const anyShard = Object.entries(SHARDS)[0] ?? null;

/** A box centred on a shard, `factor` times its size in each direction. */
function aroundShard(factor: number): Bbox {
  const [minLon, minLat, maxLon, maxLat] = anyShard![1].bbox;
  const midLon = (minLon + maxLon) / 2;
  const midLat = (minLat + maxLat) / 2;
  const halfLon = ((maxLon - minLon) / 2) * factor;
  const halfLat = ((maxLat - minLat) / 2) * factor;
  return {
    west: midLon - halfLon,
    east: midLon + halfLon,
    south: midLat - halfLat,
    north: midLat + halfLat,
  };
}

/** Ground area Overpass would actually be asked for, given the shard's cover. */
function stripArea(box: Bbox): number {
  return bboxSubtract(box, shardBbox(anyShard![1])).reduce((sum, b) => sum + bboxAreaKm2(b), 0);
}

describe('findShardOverlapping', () => {
  it('finds a shard from a viewport that only clips its corner', () => {
    if (!anyShard) return;
    const [minLon, minLat] = anyShard[1].bbox;
    // A box hanging off the south-west corner, with its own centre OUTSIDE the
    // shard — the case the centre-point lookup used to miss, which is what made
    // buildings vanish along a straight line as the camera moved.
    const corner: Bbox = {
      west: minLon - 0.02,
      south: minLat - 0.02,
      east: minLon + 0.002,
      north: minLat + 0.002,
    };
    expect(findShard((corner.west + corner.east) / 2, (corner.south + corner.north) / 2)).toBeNull();
    expect(findShardOverlapping(corner)?.id).toBe(anyShard[0]);
  });

  it('reports no shard for a viewport that merely touches one edge-on', () => {
    if (!anyShard) return;
    const [minLon, minLat] = anyShard[1].bbox;
    expect(
      findShardOverlapping({
        west: minLon - 0.05,
        east: minLon,
        south: minLat - 0.05,
        north: minLat,
      }),
    ).toBeNull();
  });

  it('exposes a shard extent as a bbox', () => {
    if (!anyShard) return;
    const b = shardBbox(anyShard[1]);
    expect([b.west, b.south, b.east, b.north]).toEqual(anyShard[1].bbox);
  });
});

describe('planCoverage', () => {
  it('asks Overpass for a small viewport with no city model behind it', () => {
    expect(bboxAreaKm2(NOWHERE)).toBeLessThan(MAX_OSM_AREA_KM2);
    expect(planCoverage(NOWHERE)).toBe('osm');
  });

  it('refuses a viewport too large to be a fair Overpass request', () => {
    // ~49,000 km². Rendering nothing and SAYING so beats issuing a query that
    // takes a minute and returns tens of megabytes.
    const huge: Bbox = { south: -1, west: -1, north: 1, east: 1 };
    expect(bboxAreaKm2(huge)).toBeGreaterThan(MAX_OSM_AREA_KM2);
    expect(planCoverage(huge)).toBe('none');
  });

  it('uses the city model alone when it covers the whole viewport', () => {
    if (!anyShard) return;
    expect(planCoverage(aroundShard(0.5))).toBe('shard');
  });

  it('combines the city model with Overpass when the viewport overruns it', () => {
    if (!anyShard) return;
    const wider = aroundShard(1.1);
    expect(stripArea(wider)).toBeLessThan(MAX_OSM_AREA_KM2);
    expect(planCoverage(wider)).toBe('shard+osm');
  });

  it('charges the budget for the strips queried, not the covered middle', () => {
    if (!anyShard) return;
    // Sized so the TOTAL is over the limit while the uncovered strips come to
    // 80 % of it — whatever the shard and the limit happen to be. Budgeting the
    // whole viewport would refuse this, and refusing it is what left a
    // shard-shaped rectangle of buildings with empty map all around it.
    const shardArea = bboxAreaKm2(shardBbox(anyShard[1]));
    const box = aroundShard(Math.sqrt(1 + (MAX_OSM_AREA_KM2 * 0.8) / shardArea));
    expect(bboxAreaKm2(box)).toBeGreaterThan(MAX_OSM_AREA_KM2);
    expect(stripArea(box)).toBeLessThan(MAX_OSM_AREA_KM2);
    expect(planCoverage(box)).toBe('shard+osm');
  });

  it('keeps the city model rather than nothing when the rest is unaffordable', () => {
    if (!anyShard) return;
    const vast = aroundShard(60);
    expect(stripArea(vast)).toBeGreaterThan(MAX_OSM_AREA_KM2);
    expect(planCoverage(vast)).toBe('shard');
  });
});

/**
 * NOTE ON ORDER: the shard loader caches its promise for the whole module, so
 * the failure case has to run before the success case. That is not incidental —
 * a failed load DELETES its cache entry so a later pan can retry, and these two
 * tests together are what pins that behaviour.
 */
describe('resolveBuildings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to OSM, and says so, where no shard covers the viewport', async () => {
    // One Overpass reply: a count element plus a single tagged building.
    const overpass = {
      elements: [
        { type: 'count', tags: { ways: '7', total: '7' } },
        {
          type: 'way',
          tags: { building: 'yes', 'building:levels': '3' },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 0.0001 },
            { lat: 0.0001, lon: 0.0001 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => overpass,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveBuildings(NOWHERE);

    expect(result.source).toBe('osm');
    expect(result.total).toBe(7);
    expect(result.buildings).toHaveLength(1);
    // 3 storeys -> an ESTIMATE, which is the whole reason the source is tracked.
    expect(result.buildings[0].estimated).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain('overpass');
  });

  it('propagates an Overpass failure rather than pretending there are no buildings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 504 }));
    // A silent empty result would render as "no buildings have height data",
    // which is a different and untrue statement.
    await expect(resolveBuildings(NOWHERE)).rejects.toThrow(/504/);
  });

  it('degrades a broken city-model shard to OSM over the whole viewport', async () => {
    if (!anyShard) return;
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      if (String(input).includes('.topojson')) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, json: async () => OVERPASS_ONE });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Worse heights beat an empty map, which the user would read as "there are
    // no buildings here" rather than "the shard did not load".
    const result = await resolveBuildings(aroundShard(0.5));
    expect(result.source).toBe('osm');
    expect(result.measured).toBe(0);
    expect(result.buildings).toHaveLength(1);
    // One box, not four strips: with no measured coverage there is no hole.
    expect(overpassBoxes(fetchMock)).toBe(1);
  });

  it('joins measured heights to OSM for the part the shard does not cover', async () => {
    if (!anyShard) return;
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      if (String(input).includes('.topojson')) {
        return Promise.resolve({ ok: true, json: async () => SHARD_TOPOLOGY });
      }
      return Promise.resolve({ ok: true, json: async () => OVERPASS_ONE });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await resolveBuildings(aroundShard(1.4));

    expect(result.source).toBe('mixed');
    expect(result.measured).toBe(1);
    expect(result.osmWithHeight).toBe(1);
    expect(result.osmTotal).toBe(7);
    expect(result.buildings).toHaveLength(2);
    // The measured footprint carries a real measurement, the OSM one a storey
    // count — the distinction the readout is built on.
    expect(result.buildings[0].estimated).toBe(false);
    expect(result.buildings[1].estimated).toBe(true);
    expect(result.partial).toBe(false);
    // Overpass is asked for the four strips AROUND the shard, never for the
    // rectangle it already answers for: querying the whole viewport would fetch
    // and draw the covered buildings a second time, at worse heights.
    expect(overpassBoxes(fetchMock)).toBe(4);
  });

  it('flags a viewport it deliberately left half-answered', async () => {
    if (!anyShard) return;
    const fetchMock = vi.fn().mockImplementation((input: unknown) => {
      if (String(input).includes('.topojson')) {
        return Promise.resolve({ ok: true, json: async () => SHARD_TOPOLOGY });
      }
      throw new Error('Overpass must not be queried for an unaffordable area');
    });
    vi.stubGlobal('fetch', fetchMock);

    // Far too wide to query around: the shard answers for its rectangle and the
    // rest is left alone. `partial` is what lets the UI explain the straight
    // edge instead of letting it read as "nothing is built out there".
    const result = await resolveBuildings(aroundShard(60));
    expect(result.source).toBe('city_model');
    expect(result.partial).toBe(true);
    expect(result.osmTotal).toBe(0);
  });

  it('reports a full-coverage shard viewport as complete, not partial', async () => {
    if (!anyShard) return;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => SHARD_TOPOLOGY }),
    );
    const result = await resolveBuildings(aroundShard(0.5));
    expect(result.source).toBe('city_model');
    expect(result.partial).toBe(false);
  });

  it('treats an Overpass reply with no element list as a failure', async () => {
    // Overpass answers a server-side timeout or a rate-limit rejection with
    // HTTP 200 and a `remark`. Reading that as zero buildings would print a
    // confident "0 of 0 have height data" about a place we never asked about.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ remark: 'runtime error: Query timed out' }) }),
    );
    await expect(resolveBuildings(NOWHERE)).rejects.toThrow(/timed out/);
  });
});

/** One count element plus one tagged building, the minimum useful Overpass reply. */
const OVERPASS_ONE = {
  elements: [
    { type: 'count', tags: { ways: '7', total: '7' } },
    {
      type: 'way',
      tags: { building: 'yes', 'building:levels': '3' },
      geometry: [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 0.0001 },
        { lat: 0.0001, lon: 0.0001 },
        { lat: 0, lon: 0 },
      ],
    },
  ],
};

/**
 * A one-building TopoJSON standing in for a city-model shard.
 *
 * No `transform` member, so topojson-client reads the arc as absolute
 * coordinates — which keeps the fixture readable as the lon/lat it actually is.
 * The footprint sits inside the Helsinki shard's extent so the real manifest
 * bbox selects it.
 */
const SHARD_TOPOLOGY = {
  type: 'Topology',
  objects: {
    buildings: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Polygon', arcs: [[0]], properties: { h: 24 } }],
    },
  },
  arcs: [
    [
      [24.95, 60.17],
      [24.9505, 60.17],
      [24.9505, 60.1703],
      [24.95, 60.1703],
      [24.95, 60.17],
    ],
  ],
};

/** How many bbox clauses the Overpass query carried. */
function overpassBoxes(fetchMock: { mock: { calls: unknown[][] } }): number {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('overpass'));
  const body = String((call?.[1] as { body?: string } | undefined)?.body ?? '');
  return body.split('way["building"]').length - 1;
}
