import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findShard, hasShards, resolveBuildings } from '../live/buildingShards';
import manifest from '../data/buildings_manifest.json';
import type { Bbox } from '../live/shadows';

/**
 * The shard manifest is real committed data, so these assertions are written to
 * hold whether or not a shard happens to be built — what matters is that the
 * SELECTION logic is correct and that a viewport with no shard always reaches the
 * OSM fallback rather than silently rendering nothing.
 */
const SHARDS = manifest as unknown as Record<
  string,
  { bbox: [number, number, number, number]; count: number }
>;

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
});
