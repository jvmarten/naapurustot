/**
 * useGridData — the multi-region `enabled` switch and the CF-9 region-shard path.
 *
 * `enabled = false` (third parameter) is what App passes in the multi-region postal
 * view: a grid only covers the primary region's shard (or a Helsinki-only bbox), yet its
 * zoom crossfade drains the WHOLE postal fill, so every added region would go blank. The
 * hook must then behave exactly like a layer with no grid at all — no fetch, no loading
 * flag, no error flag — and come back when the view returns to a single region.
 *
 * CF-9: a national grid (light_pollution) in a region-scoped session fetches only that
 * region's shard (`shardPattern` with `{region}` replaced), falls back to the whole
 * nationwide file when the shard is missing, and never shards for `?city=all`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { FeatureCollection } from 'geojson';
import { useGridData, getGridInfo } from '../hooks/useGridData';
import type { LayerId } from '../utils/colorScales';

const LAHTI_SHARD = 'data/light_pollution_grid_shards/light_pollution_grid_lahti.geojson';
const HELSINKI_SHARD = 'data/light_pollution_grid_shards/light_pollution_grid_helsinki_metro.geojson';
const WHOLE_LIGHT = 'data/light_pollution_grid.geojson';

/** A tiny distinguishable FeatureCollection, tagged so the test can tell which file it came from. */
function grid(tag: string): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { tag },
      geometry: { type: 'Polygon', coordinates: [[[25, 61], [25.01, 61], [25.01, 61.01], [25, 61.01], [25, 61]]] },
    }],
  };
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function notFound() {
  return { ok: false, status: 404, json: () => Promise.resolve({}) };
}

/** URLs the hook has requested, in order. */
function urls(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.map((c) => c[0] as string);
}

/** The `{ signal }` init the hook passed to the n-th fetch. */
function signalOf(spy: ReturnType<typeof vi.fn>, n: number): AbortSignal {
  return (spy.mock.calls[n][1] as RequestInit).signal as AbortSignal;
}

/** Flush pending promise continuations (the shard → fallback chain is several hops deep). */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

interface Props {
  layer: LayerId;
  city?: string;
  enabled?: boolean;
}

function renderGrid(initial: Props) {
  return renderHook(
    ({ layer, city, enabled }: Props) => (enabled === undefined ? useGridData(layer, city) : useGridData(layer, city, enabled)),
    { initialProps: initial },
  );
}

let fetchSpy: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  // Failed grid fetches are optional and log a warning; keep the output clean.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('manifest preconditions for the shard tests', () => {
  it('light_pollution is the sharded national grid and air_quality is an unsharded regional one', () => {
    // If the manifest changes shape, the tests below would silently test nothing.
    const lp = getGridInfo('light_pollution');
    expect(lp?.path).toBe(WHOLE_LIGHT);
    expect(lp?.shardPattern?.replace('{region}', 'lahti')).toBe(LAHTI_SHARD);
    const aq = getGridInfo('air_quality');
    expect(aq?.shardPattern).toBeUndefined();
    expect(aq?.path.endsWith('.topojson')).toBe(true);
  });
});

describe('useGridData enabled=false (multi-region view)', () => {
  it('returns the no-grid state and performs no fetch for a sharded national grid layer', async () => {
    fetchSpy.mockResolvedValue(okResponse(grid('should-not-load')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'lahti', enabled: false });

    expect(result.current).toEqual({ gridData: null, loading: false, error: false });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current).toEqual({ gridData: null, loading: false, error: false });
  });

  it('performs no fetch for a regional TopoJSON grid either, with or without a city', async () => {
    fetchSpy.mockResolvedValue(okResponse({}));
    const { result, rerender } = renderGrid({ layer: 'air_quality', city: 'helsinki_metro', enabled: false });
    rerender({ layer: 'air_quality', city: undefined, enabled: false });
    rerender({ layer: 'transit_reachability', city: 'all', enabled: false });
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current).toEqual({ gridData: null, loading: false, error: false });
  });

  it('defaults to enabled when the third argument is omitted', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('whole')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'all' });
    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('flipping enabled back to true fetches the grid (the region shard when region-scoped)', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('lahti')));
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'lahti', enabled: false });
    await flush();
    expect(fetchSpy).not.toHaveBeenCalled();

    rerender({ layer: 'light_pollution', city: 'lahti', enabled: true });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti'));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(urls(fetchSpy)[0].endsWith(LAHTI_SHARD)).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('hides a loaded grid while disabled and restores it from cache on re-enable without refetching', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('lahti')));
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'lahti', enabled: true });
    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    const loaded = result.current.gridData;

    // Adding a second region: the grid must vanish so the postal fill is not drained.
    rerender({ layer: 'light_pollution', city: 'lahti', enabled: false });
    expect(result.current).toEqual({ gridData: null, loading: false, error: false });

    // Removing it again: same object back, no second download of the grid.
    rerender({ layer: 'light_pollution', city: 'lahti', enabled: true });
    await flush();
    expect(result.current.gridData).toBe(loaded);
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('disabling mid-flight aborts the request, ignores its late answer, and re-enabling refetches', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    fetchSpy
      .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce(okResponse(grid('second')));

    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'all', enabled: true });
    expect(result.current.loading).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    rerender({ layer: 'light_pollution', city: 'all', enabled: false });
    expect(signalOf(fetchSpy, 0).aborted).toBe(true);
    expect(result.current).toEqual({ gridData: null, loading: false, error: false });

    // The first (cancelled) response arriving late must not be written to the cache.
    await act(async () => { resolveFirst(okResponse(grid('stale'))); });
    await flush();

    // The cancelled fetch was never completed, so re-enabling must fetch again
    // rather than trusting a cache entry that was never filled.
    rerender({ layer: 'light_pollution', city: 'all', enabled: true });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('second'));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(false);
  });

  it('a prior failure is not reported while disabled', async () => {
    fetchSpy.mockResolvedValue(notFound());
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'all', enabled: true });
    await waitFor(() => expect(result.current.error).toBe(true));

    rerender({ layer: 'light_pollution', city: 'all', enabled: false });
    // With no grid in play the Legend must not show a "grid failed" state.
    expect(result.current).toEqual({ gridData: null, loading: false, error: false });
  });
});

describe('useGridData CF-9 region shards', () => {
  it("cityFilter 'lahti' fetches only the lahti shard", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('lahti')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'lahti' });

    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = urls(fetchSpy);
    expect(url.endsWith(LAHTI_SHARD)).toBe(true);
    // The whole nationwide file is the thing sharding exists to avoid.
    expect(url.endsWith(WHOLE_LIGHT)).toBe(false);
    expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti');
    expect(result.current.error).toBe(false);
  });

  it('falls back to the whole nationwide file when the shard answers non-OK', async () => {
    fetchSpy
      .mockResolvedValueOnce(notFound())
      .mockResolvedValueOnce(okResponse(grid('whole')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'lahti' });

    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [first, second] = urls(fetchSpy);
    expect(first.endsWith(LAHTI_SHARD)).toBe(true);
    expect(second.endsWith(WHOLE_LIGHT)).toBe(true);
    expect(result.current.gridData?.features[0].properties?.tag).toBe('whole');
    // A missing shard is a recovered condition, not a failure the Legend should report.
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('also falls back when the shard request rejects (network error)', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse(grid('whole')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'lahti' });

    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('whole'));
    expect(urls(fetchSpy)[1].endsWith(WHOLE_LIGHT)).toBe(true);
    expect(result.current.error).toBe(false);
  });

  it('reports error only when both the shard and the whole-file fallback fail', async () => {
    fetchSpy.mockResolvedValue(notFound());
    const { result } = renderGrid({ layer: 'light_pollution', city: 'lahti' });

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.current.gridData).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("cityFilter 'all' fetches the whole file, never a shard", async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('whole')));
    const { result } = renderGrid({ layer: 'light_pollution', city: 'all' });

    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = urls(fetchSpy);
    expect(url.endsWith(WHOLE_LIGHT)).toBe(true);
    expect(url).not.toContain('{region}');
    expect(url).not.toContain('_shards/');
  });

  it('no cityFilter also fetches the whole file', async () => {
    fetchSpy.mockResolvedValueOnce(okResponse(grid('whole')));
    const { result } = renderGrid({ layer: 'light_pollution', city: undefined });
    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(urls(fetchSpy)).toHaveLength(1);
    expect(urls(fetchSpy)[0].endsWith(WHOLE_LIGHT)).toBe(true);
  });

  it('an unsharded regional grid fetches its whole file even in a region-scoped session', async () => {
    const topo = {
      type: 'Topology',
      arcs: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      objects: { grid: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0]], properties: { v: 3 } }] } },
    };
    fetchSpy.mockResolvedValueOnce(okResponse(topo));
    const { result } = renderGrid({ layer: 'air_quality', city: 'lahti' });

    await waitFor(() => expect(result.current.gridData).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(urls(fetchSpy)[0].endsWith('data/air_quality_grid.topojson')).toBe(true);
    expect(result.current.gridData?.features[0].properties?.v).toBe(3);
  });

  it('unmounting while the shard is in flight aborts it and does NOT start the whole-file fallback', async () => {
    // Behave like the real fetch: reject with an AbortError when the signal aborts.
    fetchSpy.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { unmount } = renderGrid({ layer: 'light_pollution', city: 'lahti' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    unmount();
    await flush();

    expect(signalOf(fetchSpy, 0).aborted).toBe(true);
    // Only the shard was requested: tearing down must not download the national file.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('caches per region: switching regions fetches the new shard, switching back reuses the cache', async () => {
    fetchSpy.mockImplementation((url: string) =>
      Promise.resolve(okResponse(grid(url.endsWith(LAHTI_SHARD) ? 'lahti' : url.endsWith(HELSINKI_SHARD) ? 'helsinki' : 'whole'))),
    );
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'lahti' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti'));
    const lahtiGrid = result.current.gridData;

    rerender({ layer: 'light_pollution', city: 'helsinki_metro' });
    // Never show the previous region's cells while the new shard is loading.
    expect(result.current.gridData).toBeNull();
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('helsinki'));
    expect(urls(fetchSpy)[1].endsWith(HELSINKI_SHARD)).toBe(true);

    rerender({ layer: 'light_pollution', city: 'lahti' });
    await flush();
    expect(result.current.gridData).toBe(lahtiGrid);
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returning to a cached region clears an error left by a failed region in between', async () => {
    fetchSpy.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith(LAHTI_SHARD) ? okResponse(grid('lahti')) : notFound()),
    );
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'lahti' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti'));
    rerender({ layer: 'light_pollution', city: 'helsinki_metro' });
    await waitFor(() => expect(result.current.error).toBe(true));
    rerender({ layer: 'light_pollution', city: 'lahti' });
    await flush();
    expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti');
    expect(result.current.error).toBe(false);
  });

  it('LRU keeps at most two grids resident: a third evicts the oldest, which is refetched on return', async () => {
    fetchSpy.mockImplementation((url: string) =>
      Promise.resolve(okResponse(grid(url.endsWith(LAHTI_SHARD) ? 'lahti' : url.endsWith(HELSINKI_SHARD) ? 'helsinki' : 'whole'))),
    );
    const { result, rerender } = renderGrid({ layer: 'light_pollution', city: 'lahti' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti'));
    rerender({ layer: 'light_pollution', city: 'helsinki_metro' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('helsinki'));
    rerender({ layer: 'light_pollution', city: 'all' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('whole'));
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // helsinki_metro is still resident (2nd most recent) — no fetch.
    rerender({ layer: 'light_pollution', city: 'helsinki_metro' });
    await flush();
    expect(result.current.gridData?.features[0].properties?.tag).toBe('helsinki');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // lahti was evicted by 'all' — returning to it must refetch its shard, not show nothing forever.
    rerender({ layer: 'light_pollution', city: 'lahti' });
    await waitFor(() => expect(result.current.gridData?.features[0].properties?.tag).toBe('lahti'));
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(urls(fetchSpy)[3].endsWith(LAHTI_SHARD)).toBe(true);
  });
});
