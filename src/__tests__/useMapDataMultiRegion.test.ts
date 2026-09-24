/**
 * Tests for useMapData's multi-region path (`opts.extra`) — the postal-code view
 * with several seutukunnat on one map (`city=helsinki_metro,lahti`).
 *
 * Invariants guarded here:
 *  - `extra: []` (and `extra` omitted) is EXACTLY the single-region path: one
 *    loadRegionData call and the loader's own result objects passed through by
 *    identity (no merge, no recomputed averages).
 *  - With extras, every displayed region is loaded once through the per-region
 *    loader, the features are concatenated primary-first (regardless of which
 *    request resolves first) and the averages are recomputed over the union —
 *    never taken from, or averaged across, the per-region results.
 *  - The hook keys on the joined id string, not the array's identity: App builds
 *    a fresh `extra` array often, and that must not refetch or blank the map.
 *  - Adding or removing a region clears `data` during render, so no committed
 *    render carries the previous set's features under the new set.
 *  - Any region failing fails the whole merged load with the stable 'load_failed'
 *    code, and a late answer from a region in the failed set can't overwrite it.
 *  - A stale in-flight multi load is ignored after the view moves on.
 *  - `skipAllFetch` is ignored for a concrete region; extras are ignored for the
 *    national view.
 *
 * The data loader is mocked exactly as in useMapData.test.ts; the merge itself
 * (utils/regionSet.mergeRegionData → computeMetroAverages) runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import type { Feature, FeatureCollection } from 'geojson';

vi.mock('../utils/dataLoader', () => {
  return {
    loadAllData: vi.fn(),
    loadRegionData: vi.fn(),
    resetDataCache: vi.fn(),
  };
});

import { useMapData } from '../hooks/useMapData';
import { loadAllData, loadRegionData, resetDataCache } from '../utils/dataLoader';
import { computeMetroAverages, type NeighborhoodProperties } from '../utils/metrics';
import type { RegionId } from '../utils/regions';

const loadAllDataMock = loadAllData as unknown as ReturnType<typeof vi.fn>;
const loadRegionDataMock = loadRegionData as unknown as ReturnType<typeof vi.fn>;
const resetDataCacheMock = resetDataCache as unknown as ReturnType<typeof vi.fn>;

interface Loaded {
  data: FeatureCollection;
  metroAverages: Record<string, number>;
}

function feature(pno: string, city: RegionId, props: Partial<NeighborhoodProperties>): Feature {
  return {
    type: 'Feature',
    properties: { pno, nimi: pno, namn: pno, city, ...props },
    geometry: null as unknown as Feature['geometry'],
  };
}

// Population-weighted income (hr_mtu, METRIC_DEFS) and a count ratio
// (unemployment_rate = Σpt_tyott / Σpt_vakiy) — both differ between "recomputed
// over the union" and "mean of the per-region averages", so a wrong merge shows.
const H1 = feature('00100', 'helsinki_metro', { he_vakiy: 1000, hr_mtu: 40000, pt_tyott: 50, pt_vakiy: 1000 });
const H2 = feature('00200', 'helsinki_metro', { he_vakiy: 3000, hr_mtu: 30000, pt_tyott: 300, pt_vakiy: 3000 });
const L1 = feature('15100', 'lahti', { he_vakiy: 1000, hr_mtu: 20000, pt_tyott: 200, pt_vakiy: 1000 });
const T1 = feature('20100', 'turku', { he_vakiy: 2000, hr_mtu: 25000, pt_tyott: 100, pt_vakiy: 2000 });
const P1 = feature('33100', 'tampere', { he_vakiy: 500, hr_mtu: 28000, pt_tyott: 25, pt_vakiy: 500 });

// Per-region results carry deliberately BOGUS metroAverages: the merged averages must
// be recomputed from the features, so none of these numbers may leak into a merge.
function loaded(features: Feature[], hrMtu: number): Loaded {
  return { data: { type: 'FeatureCollection', features }, metroAverages: { hr_mtu: hrMtu, he_vakiy: -1 } };
}

let RESULTS: Record<string, Loaded>;

function resolveByRegion() {
  loadRegionDataMock.mockImplementation((id: RegionId) => {
    const r = RESULTS[id];
    return r ? Promise.resolve(r) : Promise.reject(new Error(`no fixture for ${id}`));
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Each loadRegionData(id) call gets a fresh pending promise, recorded per id. */
function deferByRegion(): Record<string, Deferred<Loaded>[]> {
  const pending: Record<string, Deferred<Loaded>[]> = {};
  loadRegionDataMock.mockImplementation((id: RegionId) => {
    const d = deferred<Loaded>();
    (pending[id] ??= []).push(d);
    return d.promise;
  });
  return pending;
}

function pnos(data: FeatureCollection | null): unknown[] | null {
  return data ? data.features.map((f) => f.properties?.pno) : null;
}

type Props = { r: RegionId | 'all' | undefined; extra?: readonly RegionId[]; skip?: boolean };

/** renderHook that records what EVERY commit exposed, via useLayoutEffect. */
function renderRecorded(initialProps: Props) {
  const commits: Array<{ key: string; data: FeatureCollection | null; loading: boolean }> = [];
  const hook = renderHook(({ r, extra, skip }: Props) => {
    const v = useMapData(r, { extra, skipAllFetch: skip });
    const key = [r, ...(extra ?? [])].join(',');
    useLayoutEffect(() => {
      commits.push({ key, data: v.data, loading: v.loading });
    });
    return v;
  }, { initialProps });
  return { ...hook, commits };
}

describe('useMapData — multi-region (opts.extra)', () => {
  beforeEach(() => {
    loadAllDataMock.mockReset();
    loadRegionDataMock.mockReset();
    resetDataCacheMock.mockReset();
    RESULTS = {
      helsinki_metro: loaded([H1, H2], 11111),
      lahti: loaded([L1], 22222),
      turku: loaded([T1], 33333),
      tampere: loaded([P1], 44444),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // extra: [] is the single-region path
  // -------------------------------------------------------------------------

  it('extra: [] passes the single-region loader result through by identity', async () => {
    resolveByRegion();
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadRegionDataMock).toHaveBeenCalledTimes(1);
    expect(loadRegionDataMock).toHaveBeenCalledWith('helsinki_metro');
    expect(loadAllDataMock).not.toHaveBeenCalled();
    // Same objects — not a merge of one, and the loader's averages are NOT recomputed.
    expect(result.current.data).toBe(RESULTS.helsinki_metro.data);
    expect(result.current.metroAverages).toBe(RESULTS.helsinki_metro.metroAverages);
    expect(result.current.error).toBeNull();
  });

  it('extra: [] and extra omitted share a key — toggling between them never reloads', async () => {
    resolveByRegion();
    const { result, rerender, commits } = renderRecorded({ r: 'helsinki_metro', extra: [] });
    await waitFor(() => expect(result.current.data).toBe(RESULTS.helsinki_metro.data));
    commits.length = 0;

    rerender({ r: 'helsinki_metro', extra: undefined });
    rerender({ r: 'helsinki_metro', extra: [] });
    await act(async () => { await Promise.resolve(); });

    expect(loadRegionDataMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(RESULTS.helsinki_metro.data);
    expect(commits.every((c) => c.data === RESULTS.helsinki_metro.data && !c.loading)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Merge
  // -------------------------------------------------------------------------

  it('loads every displayed region once, with a single argument, and merges primary-first', async () => {
    resolveByRegion();
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: ['lahti'] }));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadAllDataMock).not.toHaveBeenCalled();
    expect(loadRegionDataMock).toHaveBeenCalledTimes(2);
    // Exactly one argument per call — `ids.map(loadRegionData)` would also pass the
    // index and the array, which a future second loader parameter would misread.
    expect(loadRegionDataMock.mock.calls).toEqual([['helsinki_metro'], ['lahti']]);

    const data = result.current.data!;
    expect(data.type).toBe('FeatureCollection');
    expect(pnos(data)).toEqual(['00100', '00200', '15100']);
    // Feature objects are shared with the per-region results (dataLoader's cache).
    expect(data.features[0]).toBe(H1);
    expect(data.features[2]).toBe(L1);
    // A new collection — neither region's cached FeatureCollection was mutated.
    expect(data).not.toBe(RESULTS.helsinki_metro.data);
    expect(RESULTS.helsinki_metro.data.features).toHaveLength(2);
    expect(RESULTS.lahti.data.features).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it('recomputes metroAverages over the union instead of reusing or averaging per-region averages', async () => {
    resolveByRegion();
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: ['lahti'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const avg = result.current.metroAverages;
    expect(avg).toEqual(computeMetroAverages([H1, H2, L1]));
    // Σ(hr_mtu·pop)/Σpop = (40M + 90M + 20M) / 5000 — NOT (32500 + 20000) / 2 = 26250,
    // and none of the bogus per-region numbers.
    expect(avg.he_vakiy).toBe(5000);
    expect(avg.hr_mtu).toBe(30000);
    expect(avg.hr_mtu).not.toBe(11111);
    expect(avg.hr_mtu).not.toBe(22222);
    // Σunemployed / Σlabour force = 550 / 5000 — NOT mean(8.8 %, 20 %) = 14.4 %.
    expect(avg.unemployment_rate).toBe(11);
    expect(avg.pt_tyott).toBe(550);
  });

  it('keeps primary-first order even when the extra region resolves first', async () => {
    const pending = deferByRegion();
    const { result } = renderHook(() => useMapData('lahti', { extra: ['helsinki_metro', 'turku'] }));
    expect(loadRegionDataMock.mock.calls).toEqual([['lahti'], ['helsinki_metro'], ['turku']]);

    // Resolve in reverse order of display.
    act(() => { pending.turku[0].resolve(RESULTS.turku); });
    act(() => { pending.helsinki_metro[0].resolve(RESULTS.helsinki_metro); });
    // Not yet: the merge waits for every region.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    act(() => { pending.lahti[0].resolve(RESULTS.lahti); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(pnos(result.current.data)).toEqual(['15100', '00100', '00200', '20100']);
    expect(result.current.metroAverages.he_vakiy).toBe(7000);
  });

  it('the displayed order is part of the identity: swapping primary and extra reloads in the new order', async () => {
    resolveByRegion();
    const { result, rerender } = renderHook(({ r, extra }: Props) => useMapData(r, { extra }), {
      initialProps: { r: 'helsinki_metro', extra: ['lahti'] } as Props,
    });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['00100', '00200', '15100']));

    rerender({ r: 'lahti', extra: ['helsinki_metro'] });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['15100', '00100', '00200']));
    expect(loadRegionDataMock).toHaveBeenCalledTimes(4);
    // The union is the same set, so the averages are unchanged.
    expect(result.current.metroAverages).toEqual(computeMetroAverages([H1, H2, L1]));
  });

  // -------------------------------------------------------------------------
  // Keying on the joined string, not the array identity
  // -------------------------------------------------------------------------

  it('a NEW extra array with the same contents does not reload or blank the data', async () => {
    resolveByRegion();
    const { result, rerender, commits } = renderRecorded({ r: 'helsinki_metro', extra: ['lahti'] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const merged = result.current.data;
    const averages = result.current.metroAverages;
    expect(merged).not.toBeNull();
    commits.length = 0;

    rerender({ r: 'helsinki_metro', extra: ['lahti'] });
    rerender({ r: 'helsinki_metro', extra: ['lahti'].slice() as RegionId[] });
    await act(async () => { await Promise.resolve(); });

    expect(loadRegionDataMock).toHaveBeenCalledTimes(2);
    expect(resetDataCacheMock).not.toHaveBeenCalled();
    expect(result.current.data).toBe(merged);
    expect(result.current.metroAverages).toBe(averages);
    // Every commit after the rerenders still shows the merged set, never a loading blank.
    expect(commits.length).toBeGreaterThan(0);
    for (const c of commits) {
      expect(c.data).toBe(merged);
      expect(c.loading).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Adding / removing a region
  // -------------------------------------------------------------------------

  it('adding a region resets data during render: no commit under the new set carries the old data', async () => {
    const pending = deferByRegion();
    const { result, rerender, commits } = renderRecorded({ r: 'helsinki_metro', extra: [] });
    act(() => { pending.helsinki_metro[0].resolve(RESULTS.helsinki_metro); });
    await waitFor(() => expect(result.current.data).toBe(RESULTS.helsinki_metro.data));
    commits.length = 0;

    rerender({ r: 'helsinki_metro', extra: ['lahti'] });

    const addedKey = 'helsinki_metro,lahti';
    expect(commits.some((c) => c.key === addedKey)).toBe(true);
    for (const c of commits) {
      if (c.key === addedKey) {
        expect(c.data, `commit for ${addedKey} must not carry the single-region data`).toBeNull();
        expect(c.loading).toBe(true);
      }
    }
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(loadRegionDataMock.mock.calls).toEqual([['helsinki_metro'], ['helsinki_metro'], ['lahti']]);

    act(() => {
      pending.helsinki_metro[1].resolve(RESULTS.helsinki_metro);
      pending.lahti[0].resolve(RESULTS.lahti);
    });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['00100', '00200', '15100']));
    expect(result.current.loading).toBe(false);
    // A pure add is not a retry: other regions' cache entries stay.
    expect(resetDataCacheMock).not.toHaveBeenCalled();
  });

  it('removing a region reloads the smaller set without a commit exposing the merged data', async () => {
    const pending = deferByRegion();
    const { result, rerender, commits } = renderRecorded({ r: 'helsinki_metro', extra: ['lahti', 'turku'] });
    act(() => {
      pending.helsinki_metro[0].resolve(RESULTS.helsinki_metro);
      pending.lahti[0].resolve(RESULTS.lahti);
      pending.turku[0].resolve(RESULTS.turku);
    });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['00100', '00200', '15100', '20100']));
    const three = result.current.data;

    // Remove one extra — still multi-region.
    commits.length = 0;
    rerender({ r: 'helsinki_metro', extra: ['turku'] });
    expect(commits.some((c) => c.key === 'helsinki_metro,turku')).toBe(true);
    for (const c of commits) {
      if (c.key === 'helsinki_metro,turku') expect(c.data).not.toBe(three);
    }
    expect(result.current.data).toBeNull();
    expect(loadRegionDataMock.mock.calls.slice(3)).toEqual([['helsinki_metro'], ['turku']]);
    act(() => {
      pending.helsinki_metro[1].resolve(RESULTS.helsinki_metro);
      pending.turku[1].resolve(RESULTS.turku);
    });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['00100', '00200', '20100']));
    expect(result.current.metroAverages).toEqual(computeMetroAverages([H1, H2, T1]));
    const two = result.current.data;

    // Remove the last extra — back to the plain single-region path, by identity.
    commits.length = 0;
    rerender({ r: 'helsinki_metro', extra: [] });
    expect(commits.some((c) => c.key === 'helsinki_metro')).toBe(true);
    for (const c of commits) {
      if (c.key === 'helsinki_metro') expect(c.data).not.toBe(two);
    }
    expect(result.current.data).toBeNull();
    expect(loadRegionDataMock.mock.calls.slice(5)).toEqual([['helsinki_metro']]);
    act(() => { pending.helsinki_metro[2].resolve(RESULTS.helsinki_metro); });
    await waitFor(() => expect(result.current.data).toBe(RESULTS.helsinki_metro.data));
    expect(result.current.metroAverages).toBe(RESULTS.helsinki_metro.metroAverages);
    expect(loadRegionDataMock).toHaveBeenCalledTimes(6);
  });

  // -------------------------------------------------------------------------
  // Failure
  // -------------------------------------------------------------------------

  it('an extra region rejecting fails the whole merged load with load_failed and null data', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('Failed to load region: 503');
    loadRegionDataMock.mockImplementation((id: RegionId) =>
      id === 'lahti' ? Promise.reject(boom) : Promise.resolve(RESULTS[id]),
    );
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: ['lahti'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('load_failed');
    // The primary's successful half is NOT shown as if it were the whole set.
    expect(result.current.data).toBeNull();
    expect(result.current.metroAverages).toEqual({});
    // Raw error is logged for diagnostics, only the stable code reaches the UI.
    expect(errSpy).toHaveBeenCalledWith(boom);
  });

  it('the primary rejecting while an extra is still pending errors at once, and the late extra cannot overwrite it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferByRegion();
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: ['lahti'] }));

    act(() => { pending.helsinki_metro[0].reject(new Error('404')); });
    await waitFor(() => expect(result.current.error).toBe('load_failed'));
    expect(result.current.loading).toBe(false);

    act(() => { pending.lahti[0].resolve(RESULTS.lahti); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.error).toBe('load_failed');
    expect(result.current.data).toBeNull();
  });

  it('retry() after a failed merged load resets the cache once and reloads every region', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let lahtiFails = true;
    loadRegionDataMock.mockImplementation((id: RegionId) =>
      id === 'lahti' && lahtiFails ? Promise.reject(new Error('503')) : Promise.resolve(RESULTS[id]),
    );
    const { result } = renderHook(() => useMapData('helsinki_metro', { extra: ['lahti'] }));
    await waitFor(() => expect(result.current.error).toBe('load_failed'));
    expect(resetDataCacheMock).not.toHaveBeenCalled();

    lahtiFails = false;
    act(() => { result.current.retry(); });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(pnos(result.current.data)).toEqual(['00100', '00200', '15100']);
    });
    expect(result.current.error).toBeNull();
    expect(resetDataCacheMock).toHaveBeenCalledTimes(1);
    expect(loadRegionDataMock.mock.calls).toEqual([['helsinki_metro'], ['lahti'], ['helsinki_metro'], ['lahti']]);
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  it('ignores a stale in-flight multi load after switching to a single region', async () => {
    const pending = deferByRegion();
    const { result, rerender } = renderHook(({ r, extra }: Props) => useMapData(r, { extra }), {
      initialProps: { r: 'helsinki_metro', extra: ['lahti'] } as Props,
    });

    rerender({ r: 'turku', extra: [] });
    act(() => { pending.turku[0].resolve(RESULTS.turku); });
    await waitFor(() => expect(result.current.data).toBe(RESULTS.turku.data));

    // The abandoned merged set now completes — it must not replace turku.
    act(() => {
      pending.helsinki_metro[0].resolve(RESULTS.helsinki_metro);
      pending.lahti[0].resolve(RESULTS.lahti);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.data).toBe(RESULTS.turku.data);
    expect(result.current.metroAverages).toBe(RESULTS.turku.metroAverages);
    expect(result.current.loading).toBe(false);
  });

  it('ignores a stale multi load that finishes AFTER the replacing multi load', async () => {
    const pending = deferByRegion();
    const { result, rerender } = renderHook(({ r, extra }: Props) => useMapData(r, { extra }), {
      initialProps: { r: 'helsinki_metro', extra: ['lahti'] } as Props,
    });
    rerender({ r: 'helsinki_metro', extra: ['tampere'] });

    act(() => {
      pending.helsinki_metro[1].resolve(RESULTS.helsinki_metro);
      pending.tampere[0].resolve(RESULTS.tampere);
    });
    await waitFor(() => expect(pnos(result.current.data)).toEqual(['00100', '00200', '33100']));

    act(() => {
      pending.helsinki_metro[0].resolve(RESULTS.helsinki_metro);
      pending.lahti[0].resolve(RESULTS.lahti);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(pnos(result.current.data)).toEqual(['00100', '00200', '33100']);
    expect(result.current.metroAverages).toEqual(computeMetroAverages([H1, H2, P1]));
  });

  it('a stale multi load REJECTING after a switch does not raise an error on the new view', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferByRegion();
    const { result, rerender } = renderHook(({ r, extra }: Props) => useMapData(r, { extra }), {
      initialProps: { r: 'helsinki_metro', extra: ['lahti'] } as Props,
    });
    rerender({ r: 'turku', extra: [] });
    act(() => { pending.turku[0].resolve(RESULTS.turku); });
    await waitFor(() => expect(result.current.data).toBe(RESULTS.turku.data));

    act(() => { pending.lahti[0].reject(new Error('late failure')); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe(RESULTS.turku.data);
    // A cancelled load returns before the catch-handler's logging.
    expect(errSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // skipAllFetch / national view
  // -------------------------------------------------------------------------

  it('skipAllFetch is ignored when regionId is a region: the merged set still loads', async () => {
    resolveByRegion();
    const { result } = renderHook(() => useMapData('helsinki_metro', { skipAllFetch: true, extra: ['lahti'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadAllDataMock).not.toHaveBeenCalled();
    expect(loadRegionDataMock.mock.calls).toEqual([['helsinki_metro'], ['lahti']]);
    expect(pnos(result.current.data)).toEqual(['00100', '00200', '15100']);
    expect(result.current.metroAverages.he_vakiy).toBe(5000);
  });

  it('extras are ignored for the national view: "all" loads the combined set only', async () => {
    const allResult = loaded([H1, L1, T1], 99999);
    loadAllDataMock.mockResolvedValueOnce(allResult);
    const { result } = renderHook(() => useMapData('all', { extra: ['lahti'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(loadAllDataMock).toHaveBeenCalledTimes(1);
    expect(loadRegionDataMock).not.toHaveBeenCalled();
    expect(result.current.data).toBe(allResult.data);
    expect(result.current.metroAverages).toBe(allResult.metroAverages);
  });

  it('extras do not defeat skipAllFetch on the national view (CF-8)', async () => {
    const { result } = renderHook(() => useMapData('all', { skipAllFetch: true, extra: ['lahti'] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(loadAllDataMock).not.toHaveBeenCalled();
    expect(loadRegionDataMock).not.toHaveBeenCalled();
  });
});
