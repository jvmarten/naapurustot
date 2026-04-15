/**
 * Tests for dataLoader.ts error paths + cache behavior.
 *
 * dataLoader is the SINGLE ENTRY POINT for all neighborhood data. Every layer,
 * every metric, every map render depends on it. A bug in its error handling
 * can:
 *   - Freeze the app forever by caching a rejected promise (users must hard-refresh)
 *   - Silently load empty data (map appears blank with no error surfaced)
 *   - Leak stale data when the user switches regions
 *
 * We specifically target the error branches that were previously uncovered
 * by the existing dataLoader tests (which only test the pure coercion logic).
 *
 * Cache behavior: loadAllData and loadRegionData both dedupe concurrent calls;
 * only the first triggers a network fetch. Failure must evict the cached
 * rejected promise so the next navigation retries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A valid minimal topology we can feed into the loader.
// One neighborhood-sized polygon so filterSmallIslands does not remove it.
function buildValidTopo() {
  return {
    type: 'Topology',
    arcs: [[
      [24.9, 60.10],
      [24.95, 60.10],
      [24.95, 60.15],
      [24.90, 60.15],
      [24.90, 60.10],
    ]],
    transform: undefined,
    objects: {
      n: {
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'Polygon',
            arcs: [[0]],
            properties: {
              pno: '00100',
              nimi: 'Test',
              namn: 'Test',
              kunta: '091',
              city: 'helsinki_metro',
              he_vakiy: '5000',
              hr_mtu: '35000',
            },
          },
        ],
      },
    },
  };
}

describe('dataLoader — loadAllData', () => {
  let loadAllData: typeof import('../utils/dataLoader').loadAllData;
  let resetDataCache: typeof import('../utils/dataLoader').resetDataCache;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDataCache();
  });

  it('processes a valid topology into a FeatureCollection with computed metro averages', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildValidTopo()),
    });

    const result = await loadAllData();
    expect(result.data.type).toBe('FeatureCollection');
    expect(result.data.features.length).toBe(1);
    // String properties coerced to numbers by processTopology
    expect(result.data.features[0].properties?.he_vakiy).toBe(5000);
    expect(result.data.features[0].properties?.hr_mtu).toBe(35000);
    // Metro averages computed (single neighborhood = itself)
    expect(result.metroAverages.hr_mtu).toBe(35000);
    // ID fields preserved as strings
    expect(result.data.features[0].properties?.pno).toBe('00100');
    expect(result.data.features[0].properties?.kunta).toBe('091');
  });

  it('throws a clear error on non-OK HTTP response and EVICTS the rejected promise from cache', async () => {
    // Critical: a cached rejected promise = permanent dead app until the user
    // hard-refreshes. resetDataCache alone is not enough — the internal
    // combinedCache is nulled in the .catch() handler.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    await expect(loadAllData()).rejects.toThrow(/Failed to load data.*500/);

    // Second call must fetch again (cache was evicted). This is the whole
    // point of the .catch() handler — if it's removed, this second call
    // would return the SAME rejected promise and the app would be broken.
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildValidTopo()),
    });
    const result = await loadAllData();
    expect(result.data.features.length).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws "Invalid TopoJSON" when the topo has no objects', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ type: 'Topology', arcs: [], objects: {} }),
    });

    await expect(loadAllData()).rejects.toThrow(/Invalid TopoJSON/);
  });

  it('dedupes concurrent loadAllData() calls into a single fetch', async () => {
    let resolveFetch: ((v: unknown) => void) | null = null;
    (fetch as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise((r) => { resolveFetch = r; }),
    );

    const p1 = loadAllData();
    const p2 = loadAllData();
    const p3 = loadAllData();

    resolveFetch!({
      ok: true,
      json: () => Promise.resolve(buildValidTopo()),
    });

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(fetch).toHaveBeenCalledTimes(1);
    // All three callers get the same processed data.
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });

  it('handles JSON parse errors (malformed response body) by rejecting', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });

    await expect(loadAllData()).rejects.toThrow(/Unexpected token/);

    // Cache must be evicted → next call retries successfully
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(buildValidTopo()),
    });
    await expect(loadAllData()).resolves.toBeTruthy();
  });

  it('exposes loadNeighborhoodData as a legacy alias of loadAllData', async () => {
    const mod = await import('../utils/dataLoader');
    expect(mod.loadNeighborhoodData).toBe(mod.loadAllData);
  });
});

describe('dataLoader — loadRegionData', () => {
  // Vite resolves import.meta.glob at build time. Three region files exist
  // on disk (helsinki_metro, tampere, turku) — these go down the "glob loader"
  // branch. All other RegionIds fall through to the "combined file + filter"
  // fallback branch. We test both paths.

  let loadRegionData: typeof import('../utils/dataLoader').loadRegionData;
  let resetDataCache: typeof import('../utils/dataLoader').resetDataCache;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../utils/dataLoader');
    loadRegionData = mod.loadRegionData;
    resetDataCache = mod.resetDataCache;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetDataCache();
  });

  function buildMultiCityTopo() {
    return {
      type: 'Topology',
      arcs: [[
        [24.9, 60.10], [24.95, 60.10], [24.95, 60.15], [24.90, 60.15], [24.90, 60.10],
      ], [
        [22.2, 60.45], [22.25, 60.45], [22.25, 60.50], [22.20, 60.50], [22.20, 60.45],
      ]],
      objects: {
        n: {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'Polygon',
              arcs: [[0]],
              properties: {
                pno: '00100', nimi: 'HkiTest', namn: 'HkiTest',
                kunta: '091', city: 'helsinki_metro',
                he_vakiy: 5000, hr_mtu: 35000,
              },
            },
            {
              type: 'Polygon',
              arcs: [[1]],
              properties: {
                pno: '20100', nimi: 'TurkuTest', namn: 'TurkuTest',
                kunta: '853', city: 'turku',
                he_vakiy: 3000, hr_mtu: 28000,
              },
            },
          ],
        },
      },
    };
  }

  describe('glob-loader path (region file on disk)', () => {
    it('loads and processes the region-specific file', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildMultiCityTopo()),
      });

      const result = await loadRegionData('helsinki_metro');
      // processTopology runs: features are computed and string props coerced.
      expect(result.data.features.length).toBeGreaterThan(0);
      // Metro averages reflect ALL features in the region file (no secondary filtering).
      expect(typeof result.metroAverages.hr_mtu).toBe('number');
    });

    it('caches per-region promise: second call does not re-fetch', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildMultiCityTopo()),
      });

      const a = await loadRegionData('helsinki_metro');
      const b = await loadRegionData('helsinki_metro');
      expect(b).toBe(a);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('evicts cache on fetch failure so next navigation retries', async () => {
      // This is critical — without the .catch() eviction, a transient 5xx
      // means the user is stuck with a rejected promise until they hard-reload.
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false, status: 503, json: () => Promise.resolve({}),
      });

      await expect(loadRegionData('tampere')).rejects.toThrow(/503/);

      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildMultiCityTopo()),
      });
      await loadRegionData('tampere');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fallback path (region not in glob)', () => {
    // 'oulu' has no topojson file on disk → loadRegionData falls back to
    // loadAllData() + client-side filter by city property. This path exists
    // because adding a region to regions.ts should work BEFORE the data file
    // is shipped, so users see nothing/empty rather than a crash.
    it('loads combined file and filters by city property', async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(buildMultiCityTopo()),
      });

      const result = await loadRegionData('oulu');
      // Fixture has no 'oulu' features → empty result, not an error.
      expect(result.data.features).toEqual([]);
      // Metro averages still computed (zero-weight → all zeros)
      expect(typeof result.metroAverages).toBe('object');
    });

    it('filters combined dataset correctly when a matching city exists', async () => {
      // Manually re-use the combined file as if oulu data were in it.
      // We simulate the fallback branch by loading the combined file
      // (mocked) that happens to contain the requested city.
      const topo = buildMultiCityTopo();
      // Add an Oulu feature
      (topo.objects.n.geometries as unknown[]).push({
        type: 'Polygon',
        arcs: [[0]],
        properties: {
          pno: '90100', nimi: 'OuluTest', namn: 'OuluTest',
          kunta: '564', city: 'oulu', he_vakiy: 2000, hr_mtu: 30000,
        },
      });

      (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(topo),
      });

      const result = await loadRegionData('oulu');
      expect(result.data.features.length).toBe(1);
      expect(result.data.features[0].properties?.city).toBe('oulu');
      // Weighted averages computed against only the Oulu subset
      expect(result.metroAverages.hr_mtu).toBe(30000);
    });
  });

  it('resetDataCache() forces next call to re-fetch', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve(buildMultiCityTopo()),
    });
    await loadRegionData('helsinki_metro');
    expect(fetch).toHaveBeenCalledTimes(1);

    resetDataCache();

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true, json: () => Promise.resolve(buildMultiCityTopo()),
    });
    await loadRegionData('helsinki_metro');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
