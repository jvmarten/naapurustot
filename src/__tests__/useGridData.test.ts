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
import type { Feature, FeatureCollection } from 'geojson';
import { useGridData, hasGridData, getGridInfo, cellCentroid, clipGridToData } from '../hooks/useGridData';

/** Build a 1x1 square grid cell whose centroid is (cx, cy). */
function cell(cx: number, cy: number, props: Record<string, unknown> = {}): Feature {
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [[[cx - 0.5, cy - 0.5], [cx + 0.5, cy - 0.5], [cx + 0.5, cy + 0.5], [cx - 0.5, cy + 0.5], [cx - 0.5, cy - 0.5]]],
    },
  };
}

describe('cellCentroid (IN-1/IN-2)', () => {
  it('returns the bbox midpoint of the outer ring', () => {
    expect(cellCentroid(cell(5, 7))).toEqual([5, 7]);
  });

  it('returns null for a cell with no usable geometry', () => {
    expect(cellCentroid({ type: 'Feature', properties: {}, geometry: null } as unknown as Feature)).toBeNull();
  });
});

describe('clipGridToData (IN-1)', () => {
  // A region whose bbox is roughly [0,0]..[10,10].
  const region: FeatureCollection = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    }],
  };

  it('keeps cells whose centroid is inside the region bbox and drops the rest', () => {
    const grid: FeatureCollection = {
      type: 'FeatureCollection',
      features: [cell(5, 5), cell(50, 50)],
    };
    const clipped = clipGridToData(grid, region);
    expect(clipped?.features).toHaveLength(1);
    expect(cellCentroid(clipped!.features[0])).toEqual([5, 5]);
  });

  it('returns the grid unchanged when either input is null', () => {
    const grid: FeatureCollection = { type: 'FeatureCollection', features: [cell(5, 5)] };
    expect(clipGridToData(grid, null)).toBe(grid);
    expect(clipGridToData(null, region)).toBeNull();
  });
});

describe('hasGridData', () => {
  it('returns true for layers with a built grid in the manifest', () => {
    expect(hasGridData('light_pollution')).toBe(true);
    expect(hasGridData('air_quality')).toBe(true);
  });

  it('returns false for layers without grid data', () => {
    expect(hasGridData('median_income')).toBe(false);
    expect(hasGridData('quality_index')).toBe(false);
    expect(hasGridData('unemployment')).toBe(false);
    // IN-1: manifest-driven discovery — transit_reachability has no built grid
    // file, so it is (correctly) absent rather than a hardcoded entry that 404s.
    expect(hasGridData('transit_reachability')).toBe(false);
  });
});

describe('getGridInfo (IN-1 manifest)', () => {
  it('exposes coverage scope so partial grids are explicit', () => {
    // Helsinki-area air-quality grid is regional; the VIIRS light grid is national.
    expect(getGridInfo('air_quality')?.scope).toBe('regional');
    expect(getGridInfo('light_pollution')?.scope).toBe('national');
  });

  it('returns undefined for a layer with no grid', () => {
    expect(getGridInfo('median_income')).toBeUndefined();
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
