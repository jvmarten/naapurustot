/**
 * Tests for dataLoader.ts — processTopology pipeline, fetchAndProcess, caching, error paths.
 *
 * dataLoader.ts had only 11% coverage despite being THE data entry point for the entire app.
 * These tests exercise the actual exported functions (loadRegionData, loadAllData, resetDataCache)
 * via mocked fetch + topojson, and test processTopology indirectly through the public API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal valid TopoJSON that processTopology can handle
function makeTopoJSON(properties: Record<string, unknown>[] = [{ pno: '00100', nimi: 'Test', hr_mtu: '35000' }]) {
  const arcs: number[][][] = [];
  const geometries = properties.map((p, i) => {
    // Create a simple polygon arc for each feature
    arcs.push([[0 + i, 0], [1, 0], [0, 1], [-1 - i, -1]]);
    return {
      type: 'Polygon' as const,
      arcs: [[i]],
      properties: p,
    };
  });

  return {
    type: 'Topology',
    objects: {
      neighborhoods: {
        type: 'GeometryCollection',
        geometries,
      },
    },
    arcs,
  };
}

describe('dataLoader — loadAllData and processTopology pipeline', () => {
  let loadAllData: typeof import('../utils/dataLoader').loadAllData;
  let resetDataCache: typeof import('../utils/dataLoader').resetDataCache;

  beforeEach(async () => {
    vi.resetModules();

    // Mock topojson-client to return a simple FeatureCollection
    vi.doMock('topojson-client', () => ({
      feature: (_topo: unknown, obj: { geometries: Array<{ properties: Record<string, unknown> }> }) => ({
        type: 'FeatureCollection',
        features: obj.geometries.map((g: { properties: Record<string, unknown> }) => ({
          type: 'Feature',
          properties: { ...g.properties },
          geometry: { type: 'Polygon', coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]] },
        })),
      }),
    }));

    // Mock fetch
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processTopology coerces string properties to numbers', async () => {
    const topo = makeTopoJSON([
      { pno: '00100', nimi: 'Kruununhaka', hr_mtu: '35000', unemployment_rate: '5.2', kunta: '091' },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    const result = await loadAllData();
    const props = result.data.features[0].properties!;

    // ID fields preserved as strings
    expect(props.pno).toBe('00100');
    expect(props.kunta).toBe('091');
    // Numeric strings coerced
    expect(props.hr_mtu).toBe(35000);
    expect(props.unemployment_rate).toBe(5.2);
    // Non-numeric string preserved
    expect(props.nimi).toBe('Kruununhaka');
  });

  it('processTopology runs quality indices and metro averages', async () => {
    const topo = makeTopoJSON([
      {
        pno: '00100', nimi: 'A', city: 'helsinki_metro',
        he_vakiy: '5000', hr_mtu: '35000', crime_index: '50',
        unemployment_rate: '5', higher_education_rate: '40',
        transit_stop_density: '10', air_quality_index: '3',
        healthcare_density: '2', school_density: '1', daycare_density: '1', grocery_density: '3',
      },
      {
        pno: '00200', nimi: 'B', city: 'helsinki_metro',
        he_vakiy: '3000', hr_mtu: '28000', crime_index: '80',
        unemployment_rate: '10', higher_education_rate: '25',
        transit_stop_density: '5', air_quality_index: '5',
        healthcare_density: '1', school_density: '0.5', daycare_density: '0.5', grocery_density: '1',
      },
    ]);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    const result = await loadAllData();

    // quality_index should be computed for each feature
    for (const f of result.data.features) {
      const qi = f.properties!.quality_index;
      // quality_index is either a number or null — should be set by computeQualityIndices
      expect(qi === null || typeof qi === 'number').toBe(true);
    }

    // metro averages should have key properties
    expect(result.metroAverages).toBeDefined();
    expect(typeof result.metroAverages.hr_mtu).toBe('number');
  });

  it('processTopology throws for invalid TopoJSON with no objects', async () => {
    const badTopo = { type: 'Topology', objects: {}, arcs: [] };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(badTopo),
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    await expect(loadAllData()).rejects.toThrow();
  });

  it('loadAllData rejects on non-ok fetch response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    await expect(loadAllData()).rejects.toThrow('Failed to load data: 404');
  });

  it('loadAllData caches the result on second call', async () => {
    const topo = makeTopoJSON([{ pno: '00100', nimi: 'Test', he_vakiy: '1000' }]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    const result1 = await loadAllData();
    const result2 = await loadAllData();
    expect(result1).toBe(result2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('resetDataCache clears the cache so next call re-fetches', async () => {
    const topo = makeTopoJSON([{ pno: '00100', nimi: 'Test', he_vakiy: '1000' }]);
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(topo) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(topo) });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    await loadAllData();
    resetDataCache();
    await loadAllData();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('loadAllData evicts cache on fetch failure so retry works', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false, status: 500 });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;
    resetDataCache = mod.resetDataCache;

    await expect(loadAllData()).rejects.toThrow();

    // Now retry should attempt fetch again (cache was evicted)
    const topo = makeTopoJSON([{ pno: '00100', nimi: 'Test', he_vakiy: '1000' }]);
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(topo) });
    const result = await loadAllData();
    expect(result.data.features.length).toBe(1);
  });

  it('processTopology preserves empty string values (does not coerce to 0)', async () => {
    const topo = makeTopoJSON([
      { pno: '00100', nimi: 'Test', hr_mtu: '', income_history: '' },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    loadAllData = mod.loadAllData;

    const result = await loadAllData();
    const props = result.data.features[0].properties!;
    expect(props.hr_mtu).toBe('');
    expect(props.income_history).toBe('');
  });

  it('loadNeighborhoodData is an alias for loadAllData', async () => {
    const mod = await import('../utils/dataLoader');
    expect(mod.loadNeighborhoodData).toBe(mod.loadAllData);
  });
});

describe('dataLoader — loadRegionData', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('topojson-client', () => ({
      feature: (_topo: unknown, obj: { geometries: Array<{ properties: Record<string, unknown> }> }) => ({
        type: 'FeatureCollection',
        features: obj.geometries.map((g: { properties: Record<string, unknown> }) => ({
          type: 'Feature',
          properties: { ...g.properties },
          geometry: { type: 'Polygon', coordinates: [[[24.9, 60.1], [25.0, 60.1], [25.0, 60.2], [24.9, 60.2], [24.9, 60.1]]] },
        })),
      }),
    }));
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadRegionData returns data for a valid region', async () => {
    const topo = makeTopoJSON([
      { pno: '20100', nimi: 'Turku Keskusta', city: 'turku', he_vakiy: '5000' },
    ]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    mod.resetDataCache();

    // loadRegionData should return data (either from region file or fallback)
    const result = await mod.loadRegionData('turku' as import('../utils/regions').RegionId);
    expect(result.data.features.length).toBeGreaterThan(0);
    expect(result.metroAverages).toBeDefined();
  });

  it('loadRegionData caches the promise for same region', async () => {
    const topo = makeTopoJSON([{ pno: '00100', nimi: 'Test', city: 'helsinki_metro', he_vakiy: '1000' }]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topo),
    });

    const mod = await import('../utils/dataLoader');
    mod.resetDataCache();

    const promise1 = mod.loadRegionData('helsinki_metro' as import('../utils/regions').RegionId);
    const promise2 = mod.loadRegionData('helsinki_metro' as import('../utils/regions').RegionId);
    expect(promise1).toBe(promise2); // Same promise returned
  });
});
