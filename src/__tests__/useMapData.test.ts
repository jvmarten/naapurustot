/**
 * Tests for useMapData — the React hook that drives every map render.
 *
 * Critical invariants:
 *  - Region switching loads the new region's dataset (not the old one).
 *  - A failed load does not leave `loading: true` stuck forever.
 *  - `retry()` clears the data cache so a transient network error can recover.
 *  - Cancelled requests (race between two rapid region switches) don't write
 *    stale state on top of the winner.
 *
 * We mock the data loader module so these tests run in jsdom without any
 * network, file I/O, or TopoJSON parsing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../utils/dataLoader', () => {
  return {
    loadAllData: vi.fn(),
    loadRegionData: vi.fn(),
    resetDataCache: vi.fn(),
  };
});

import { useMapData } from '../hooks/useMapData';
import { loadAllData, loadRegionData, resetDataCache } from '../utils/dataLoader';

const loadAllDataMock = loadAllData as unknown as ReturnType<typeof vi.fn>;
const loadRegionDataMock = loadRegionData as unknown as ReturnType<typeof vi.fn>;
const resetDataCacheMock = resetDataCache as unknown as ReturnType<typeof vi.fn>;

function emptyResult(metroAverages: Record<string, number> = {}) {
  return {
    data: { type: 'FeatureCollection' as const, features: [] },
    metroAverages,
  };
}

describe('useMapData', () => {
  beforeEach(() => {
    loadAllDataMock.mockReset();
    loadRegionDataMock.mockReset();
    resetDataCacheMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the combined dataset when regionId is "all"', async () => {
    loadAllDataMock.mockResolvedValueOnce(emptyResult({ hr_mtu: 35000 }));

    const { result } = renderHook(() => useMapData('all'));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(loadAllDataMock).toHaveBeenCalledTimes(1);
    expect(loadRegionDataMock).not.toHaveBeenCalled();
    expect(result.current.metroAverages).toEqual({ hr_mtu: 35000 });
    expect(result.current.error).toBeNull();
  });

  it('loads the combined dataset when regionId is undefined', async () => {
    loadAllDataMock.mockResolvedValueOnce(emptyResult());

    const { result } = renderHook(() => useMapData(undefined));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(loadAllDataMock).toHaveBeenCalledTimes(1);
    expect(loadRegionDataMock).not.toHaveBeenCalled();
  });

  it('loads per-region data when a concrete regionId is provided', async () => {
    loadRegionDataMock.mockResolvedValueOnce(emptyResult());

    const { result } = renderHook(() => useMapData('turku'));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(loadRegionDataMock).toHaveBeenCalledWith('turku');
    expect(loadAllDataMock).not.toHaveBeenCalled();
  });

  it('reloads data and clears previous state when regionId changes', async () => {
    loadRegionDataMock
      .mockResolvedValueOnce(emptyResult({ hr_mtu: 30000 }))
      .mockResolvedValueOnce(emptyResult({ hr_mtu: 40000 }));

    const { result, rerender } = renderHook(({ r }) => useMapData(r), {
      initialProps: { r: 'turku' as 'turku' | 'tampere' },
    });
    await waitFor(() => {
      expect(result.current.metroAverages.hr_mtu).toBe(30000);
    });

    rerender({ r: 'tampere' });

    // Briefly enters loading state after switch
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    await waitFor(() => {
      expect(result.current.metroAverages.hr_mtu).toBe(40000);
    });
    expect(loadRegionDataMock).toHaveBeenCalledTimes(2);
    expect(loadRegionDataMock).toHaveBeenNthCalledWith(1, 'turku');
    expect(loadRegionDataMock).toHaveBeenNthCalledWith(2, 'tampere');
    // A pure region switch should NOT reset the cache — other regions stay
    // cached so toggling back is instant.
    expect(resetDataCacheMock).not.toHaveBeenCalled();
  });

  it('surfaces an error message when the loader rejects', async () => {
    loadAllDataMock.mockRejectedValueOnce(new Error('Failed to load data: 500'));

    const { result } = renderHook(() => useMapData('all'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('Failed to load data: 500');
    expect(result.current.data).toBeNull();
  });

  it('retry() resets the cache and triggers a fresh load', async () => {
    loadAllDataMock
      .mockRejectedValueOnce(new Error('Failed to load data: 500'))
      .mockResolvedValueOnce(emptyResult({ hr_mtu: 35000 }));

    const { result } = renderHook(() => useMapData('all'));
    await waitFor(() => {
      expect(result.current.error).toBe('Failed to load data: 500');
    });
    expect(resetDataCacheMock).not.toHaveBeenCalled();

    act(() => {
      result.current.retry();
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
    expect(resetDataCacheMock).toHaveBeenCalledTimes(1);
    expect(loadAllDataMock).toHaveBeenCalledTimes(2);
    expect(result.current.metroAverages).toEqual({ hr_mtu: 35000 });
  });

  it('ignores a cancelled load so a rapid region switch does not flash stale data', async () => {
    // First region: never-resolving promise
    let resolveFirst: ((v: unknown) => void) | null = null;
    loadRegionDataMock.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    // Second region: resolves fast
    loadRegionDataMock.mockResolvedValueOnce(emptyResult({ hr_mtu: 42000 }));

    const { result, rerender } = renderHook(({ r }) => useMapData(r), {
      initialProps: { r: 'turku' as 'turku' | 'tampere' },
    });
    // Switch before the first load has resolved
    rerender({ r: 'tampere' });

    await waitFor(() => {
      expect(result.current.metroAverages.hr_mtu).toBe(42000);
    });

    // Now resolve the first (cancelled) request with different data.
    // That write must be ignored — the current state must remain tampere's result.
    act(() => {
      resolveFirst!(emptyResult({ hr_mtu: 1 }));
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.metroAverages.hr_mtu).toBe(42000);
  });
});
