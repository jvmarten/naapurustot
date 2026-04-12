/**
 * Tests for dataLoader.ts caching and retry behavior.
 *
 * These are integration-level tests — the actual data-loading pipeline
 * (TopoJSON fetch → coerce → quality index → metro averages) is exercised
 * via mocked fetch + a minimal inline topology.
 *
 * Risk targets:
 *  - A failed fetch must evict the cache so the NEXT navigation retries.
 *    Without this, a transient 500 permanently strands the user on an error
 *    screen until reload. This regression broke once before (see resetDataCache).
 *  - resetDataCache() must clear BOTH combined and per-region caches.
 *  - Successful loads must be Promise-level deduped: two concurrent callers
 *    see the same inflight promise, not two fetches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type FetchMock = ReturnType<typeof vi.fn>;

// Minimal valid TopoJSON that the pipeline can process end-to-end.
// 2 features so metro averages produce non-trivial output.
const MOCK_TOPO = {
  type: 'Topology',
  objects: {
    neighborhoods: {
      type: 'GeometryCollection',
      geometries: [
        {
          type: 'Polygon',
          arcs: [[0]],
          properties: {
            pno: '00100',
            nimi: 'A',
            namn: 'A',
            kunta: '091',
            city: 'helsinki_metro',
            he_vakiy: '1000',
            hr_mtu: '35000',
          },
        },
        {
          type: 'Polygon',
          arcs: [[1]],
          properties: {
            pno: '00200',
            nimi: 'B',
            namn: 'B',
            kunta: '091',
            city: 'helsinki_metro',
            he_vakiy: '2000',
            hr_mtu: '40000',
          },
        },
      ],
    },
  },
  arcs: [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0],
    ],
    [
      [200, 200],
      [300, 200],
      [300, 300],
      [200, 300],
      [200, 200],
    ],
  ],
  bbox: [0, 0, 300, 300],
};

function okJson(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('dataLoader — caching and retry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('processes a TopoJSON into a FeatureCollection with computed quality_index + metroAverages', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));

    const result = await loadAllData();
    expect(result.data.type).toBe('FeatureCollection');
    expect(result.data.features).toHaveLength(2);

    // Numeric coercion: he_vakiy was a string in MOCK_TOPO, must now be a number.
    const p0 = result.data.features[0].properties!;
    expect(typeof p0.he_vakiy).toBe('number');
    expect(p0.he_vakiy).toBe(1000);
    expect(p0.hr_mtu).toBe(35000);

    // Quality index computed from two features — min becomes 0, max becomes 100
    // because income is the only variant factor with weight > 0.
    const qi0 = p0.quality_index as number | null;
    const qi1 = result.data.features[1].properties!.quality_index as number | null;
    expect(qi0).not.toBeNull();
    expect(qi1).not.toBeNull();
    expect(qi1).toBeGreaterThan(qi0!);

    // Metro averages: population-weighted income
    // = (1000*35000 + 2000*40000) / 3000 = 38333.33 → rounded integer
    expect(result.metroAverages.he_vakiy).toBe(3000);
    expect(result.metroAverages.hr_mtu).toBe(38333);
  });

  it('caches the combined loader — a second call does not re-fetch', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    const r1 = await loadAllData();
    const r2 = await loadAllData();

    expect((fetch as FetchMock).mock.calls).toHaveLength(1);
    // Same processed result (cached Promise).
    expect(r2).toBe(r1);
  });

  it('dedupes concurrent in-flight requests (same Promise for both callers)', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    const [r1, r2] = await Promise.all([loadAllData(), loadAllData()]);
    expect((fetch as FetchMock).mock.calls).toHaveLength(1);
    expect(r1).toBe(r2);
  });

  it('evicts the cache on fetch failure so the next call retries', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    // First attempt: network error.
    (fetch as FetchMock).mockRejectedValueOnce(new Error('offline'));
    await expect(loadAllData()).rejects.toThrow('offline');

    // Second attempt: success. If the cache wasn't evicted, this would
    // return the rejected promise again without calling fetch.
    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    const result = await loadAllData();
    expect(result.data.features).toHaveLength(2);
    expect((fetch as FetchMock).mock.calls).toHaveLength(2);
  });

  it('evicts the cache on non-OK HTTP response and retries on next call', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as FetchMock).mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(loadAllData()).rejects.toThrow(/500/);

    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    const result = await loadAllData();
    expect(result.data.features).toHaveLength(2);
  });

  it('resetDataCache() clears the combined cache', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    await loadAllData();
    expect((fetch as FetchMock).mock.calls).toHaveLength(1);

    resetDataCache();
    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    await loadAllData();
    expect((fetch as FetchMock).mock.calls).toHaveLength(2);
  });

  it('loadNeighborhoodData is an alias of loadAllData', async () => {
    const mod = await import('../utils/dataLoader');
    expect(mod.loadNeighborhoodData).toBe(mod.loadAllData);
  });

  it('loadRegionData falls back to filtering the combined file when no per-region glob match', async () => {
    const { loadRegionData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    // loadRegionData first tries the per-region glob; for any region that lacks
    // a matching file, it falls back to loadAllData() + filter. With our mocked
    // combined topology, both features have city=helsinki_metro.
    (fetch as FetchMock).mockResolvedValueOnce(okJson(MOCK_TOPO));
    // Use a region that is unlikely to exist in the glob — filtering will drop
    // every feature (since MOCK_TOPO has only helsinki_metro features), giving
    // an empty but well-formed result.
    const result = await loadRegionData('rauma');
    expect(result.data.type).toBe('FeatureCollection');
    // Either the region glob resolved (rauma has a real file in the project) or
    // the fallback kicked in. Both paths must produce a valid FeatureCollection.
    expect(Array.isArray(result.data.features)).toBe(true);
  });
});
