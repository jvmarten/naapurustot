import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { hasGridData, useGridData } from '../hooks/useGridData';

describe('hasGridData', () => {
  it('returns true for transit_reachability', () => {
    expect(hasGridData('transit_reachability')).toBe(true);
  });

  it('returns true for light_pollution', () => {
    expect(hasGridData('light_pollution')).toBe(true);
  });

  it('returns true for air_quality', () => {
    expect(hasGridData('air_quality')).toBe(true);
  });

  it('returns false for layers without grid data', () => {
    expect(hasGridData('median_income')).toBe(false);
    expect(hasGridData('quality_index')).toBe(false);
    expect(hasGridData('unemployment')).toBe(false);
  });
});

describe('useGridData', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns null gridData for layers without grid data', () => {
    const { result } = renderHook(() => useGridData('median_income'));
    expect(result.current.gridData).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('loads and parses GeoJSON grid data', async () => {
    const mockGeojson = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { value: 10 }, geometry: { type: 'Point', coordinates: [24.9, 60.2] } },
      ],
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeojson,
    } as Response);

    const { result } = renderHook(() => useGridData('light_pollution'));

    await waitFor(() => {
      expect(result.current.gridData).not.toBeNull();
    });

    expect(result.current.gridData!.features).toHaveLength(1);
  });

  it('handles fetch failure gracefully', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useGridData('air_quality'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.gridData).toBeNull();
    consoleSpy.mockRestore();
  });

  it('handles network error gracefully', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useGridData('transit_reachability'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.gridData).toBeNull();
    consoleSpy.mockRestore();
  });

  it('loads and parses TopoJSON grid data', async () => {
    const mockTopo = {
      type: 'Topology',
      objects: {
        grid: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Point', coordinates: [0, 0], properties: { value: 42 } },
          ],
        },
      },
      arcs: [],
    };
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTopo,
    } as Response);

    const { result } = renderHook(() => useGridData('transit_reachability'));

    await waitFor(() => {
      expect(result.current.gridData).not.toBeNull();
    });
  });
});
