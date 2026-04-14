/**
 * Tests for useGridData — the lazy-loading hook for fine-grained grid overlays
 * (250m light-pollution grid, air-quality grid, transit-reachability grid).
 *
 * The bugs this hook has had historically:
 *  - Fetching re-triggered on every cache update (useEffect re-runs).
 *  - A stale in-flight promise from a previous layer would resolve and overwrite
 *    the newly active layer's data.
 *  - Failed fetches blocked retries because the "fetched" guard wasn't cleared.
 *
 * We cover: the hasGridData predicate, TopoJSON/GeoJSON parsing branches, the
 * "no path" short-circuit, and the retry-after-failure behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGridData, hasGridData } from '../hooks/useGridData';

describe('hasGridData', () => {
  it('returns true for registered grid layers', () => {
    expect(hasGridData('light_pollution')).toBe(true);
    expect(hasGridData('transit_reachability')).toBe(true);
    expect(hasGridData('air_quality')).toBe(true);
  });

  it('returns false for layers without grid data', () => {
    expect(hasGridData('median_income')).toBe(false);
    expect(hasGridData('quality_index')).toBe(false);
    expect(hasGridData('unemployment')).toBe(false);
  });
});

describe('useGridData', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null gridData without fetching for non-grid layers', () => {
    const { result } = renderHook(() => useGridData('median_income'));
    expect(result.current.gridData).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches GeoJSON for a grid layer and exposes it after load', async () => {
    const sample = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { radiance: 12 }, geometry: null }],
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(sample),
    });

    const { result } = renderHook(() => useGridData('light_pollution'));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.gridData).toEqual(sample);
    });
    expect(result.current.loading).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain('light_pollution_grid.geojson');
  });

  it('parses TopoJSON for layers whose path ends in .topojson', async () => {
    // Minimal topojson with one Polygon feature.
    const topo = {
      type: 'Topology',
      arcs: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      objects: {
        grid: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Polygon', arcs: [[0]], properties: { radiance: 42 } },
          ],
        },
      },
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const { result } = renderHook(() => useGridData('air_quality'));

    await waitFor(() => {
      expect(result.current.gridData).not.toBeNull();
    });
    expect(result.current.gridData?.type).toBe('FeatureCollection');
    expect(result.current.gridData?.features[0].properties?.radiance).toBe(42);
  });

  it('silently falls back on fetch failure (no throw, no stale loading)', async () => {
    // Grid data is optional; a 404 or network error must not surface to UI.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useGridData('light_pollution'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.gridData).toBeNull();
    warnSpy.mockRestore();
  });

  it('does not re-fetch on rerender for the same layer (cache by layerId)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
    });

    const { result, rerender } = renderHook(({ l }) => useGridData(l), {
      initialProps: { l: 'light_pollution' as const },
    });
    await waitFor(() => {
      expect(result.current.gridData).not.toBeNull();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    rerender({ l: 'light_pollution' as const });
    rerender({ l: 'light_pollution' as const });

    // Rerenders must not trigger more fetches.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after a failed fetch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // First call fails; second succeeds.
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'FeatureCollection', features: [] }),
      });

    const { result, rerender } = renderHook(({ l }) => useGridData(l), {
      initialProps: { l: 'light_pollution' as const },
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Switch away and back — second visit should actually refetch
    rerender({ l: 'median_income' as unknown as 'light_pollution' });
    rerender({ l: 'light_pollution' as const });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
    warnSpy.mockRestore();
  });

  it('returns gridData: null for a grid layer whose fetch is still in flight', () => {
    // Return a pending promise so the fetch never resolves during this test.
    fetchSpy.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGridData('light_pollution'));
    expect(result.current.gridData).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});
