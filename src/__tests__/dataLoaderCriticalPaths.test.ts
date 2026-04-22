import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('dataLoader processing pipeline', () => {
  let loadAllData: typeof import('../utils/dataLoader').loadAllData;
  let resetDataCache: typeof import('../utils/dataLoader').resetDataCache;
  let loadRegionData: typeof import('../utils/dataLoader').loadRegionData;

  beforeEach(async () => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  describe('TopoJSON numeric coercion', () => {
    it('coerces string-typed numeric properties to numbers', async () => {
      const fakeTopo = {
        type: 'Topology',
        objects: {
          neighborhoods: {
            type: 'GeometryCollection',
            geometries: [{
              type: 'Point',
              coordinates: [24.9, 60.2],
              properties: {
                pno: '00100',
                nimi: 'Test',
                namn: 'Test',
                kunta: '091',
                city: 'helsinki',
                he_vakiy: '1000', // string that should be coerced
                hr_mtu: '30000', // string that should be coerced
              },
            }],
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeTopo),
      }));

      const mod = await import('../utils/dataLoader');
      loadAllData = mod.loadAllData;
      resetDataCache = mod.resetDataCache;

      const result = await loadAllData();
      const props = result.data.features[0].properties!;

      // Numeric strings should be coerced
      expect(typeof props.he_vakiy).toBe('number');
      expect(props.he_vakiy).toBe(1000);
      expect(typeof props.hr_mtu).toBe('number');

      // ID fields should remain strings
      expect(typeof props.pno).toBe('string');
      expect(typeof props.nimi).toBe('string');
      expect(typeof props.kunta).toBe('string');
      expect(typeof props.city).toBe('string');
    });

    it('preserves non-numeric string properties', async () => {
      const fakeTopo = {
        type: 'Topology',
        objects: {
          neighborhoods: {
            type: 'GeometryCollection',
            geometries: [{
              type: 'Point',
              coordinates: [24.9, 60.2],
              properties: {
                pno: '00100',
                nimi: 'Test',
                namn: 'Test',
                kunta: '091',
                city: 'helsinki',
                he_vakiy: 1000,
                some_text_field: 'not-a-number',
              },
            }],
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeTopo),
      }));

      const mod = await import('../utils/dataLoader');
      const result = await mod.loadAllData();
      expect(result.data.features[0].properties!.some_text_field).toBe('not-a-number');
    });

    it('preserves empty string properties', async () => {
      const fakeTopo = {
        type: 'Topology',
        objects: {
          neighborhoods: {
            type: 'GeometryCollection',
            geometries: [{
              type: 'Point',
              coordinates: [24.9, 60.2],
              properties: {
                pno: '00100',
                nimi: 'Test',
                namn: 'Test',
                kunta: '091',
                city: 'helsinki',
                he_vakiy: 1000,
                empty_field: '',
              },
            }],
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeTopo),
      }));

      const mod = await import('../utils/dataLoader');
      const result = await mod.loadAllData();
      expect(result.data.features[0].properties!.empty_field).toBe('');
    });
  });

  describe('error handling', () => {
    it('throws on HTTP error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }));

      const mod = await import('../utils/dataLoader');
      await expect(mod.loadAllData()).rejects.toThrow('Failed to load data: 500');
    });

    it('evicts cache on failure so retry works', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            type: 'Topology',
            objects: {
              data: {
                type: 'GeometryCollection',
                geometries: [{
                  type: 'Point',
                  coordinates: [24.9, 60.2],
                  properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', he_vakiy: 1000 },
                }],
              },
            },
          }),
        });
      }));

      const mod = await import('../utils/dataLoader');

      // First call fails
      await expect(mod.loadAllData()).rejects.toThrow();
      // Second call should retry (not return cached rejection)
      const result = await mod.loadAllData();
      expect(result.data.features.length).toBe(1);
    });

    it('throws for topology with no objects', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ type: 'Topology', objects: {} }),
      }));

      const mod = await import('../utils/dataLoader');
      await expect(mod.loadAllData()).rejects.toThrow('Invalid TopoJSON');
    });
  });

  describe('caching', () => {
    it('returns cached promise on subsequent calls', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          type: 'Topology',
          objects: {
            data: {
              type: 'GeometryCollection',
              geometries: [{
                type: 'Point',
                coordinates: [24.9, 60.2],
                properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', he_vakiy: 1000 },
              }],
            },
          },
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const mod = await import('../utils/dataLoader');
      const p1 = mod.loadAllData();
      const p2 = mod.loadAllData();
      expect(p1).toBe(p2);
      await p1;
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('resetDataCache clears all caches', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          type: 'Topology',
          objects: {
            data: {
              type: 'GeometryCollection',
              geometries: [{
                type: 'Point',
                coordinates: [24.9, 60.2],
                properties: { pno: '00100', nimi: 'Test', namn: 'Test', kunta: '091', city: 'helsinki', he_vakiy: 1000 },
              }],
            },
          },
        }),
      });
      vi.stubGlobal('fetch', fetchSpy);

      const mod = await import('../utils/dataLoader');
      await mod.loadAllData();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      mod.resetDataCache();
      await mod.loadAllData();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('computed properties', () => {
    it('computes quality_index on loaded features', async () => {
      const fakeTopo = {
        type: 'Topology',
        objects: {
          data: {
            type: 'GeometryCollection',
            geometries: [
              {
                type: 'Point',
                coordinates: [24.9, 60.2],
                properties: {
                  pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'helsinki',
                  he_vakiy: 1000, hr_mtu: 40000, crime_index: 30, unemployment_rate: 3,
                  higher_education_rate: 60, transit_stop_density: 30,
                  healthcare_density: 5, school_density: 5, daycare_density: 5,
                  grocery_density: 5, air_quality_index: 20,
                },
              },
              {
                type: 'Point',
                coordinates: [24.95, 60.2],
                properties: {
                  pno: '00200', nimi: 'B', namn: 'B', kunta: '091', city: 'helsinki',
                  he_vakiy: 1000, hr_mtu: 20000, crime_index: 100, unemployment_rate: 15,
                  higher_education_rate: 10, transit_stop_density: 5,
                  healthcare_density: 1, school_density: 1, daycare_density: 1,
                  grocery_density: 1, air_quality_index: 45,
                },
              },
            ],
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeTopo),
      }));

      const mod = await import('../utils/dataLoader');
      const result = await mod.loadAllData();

      const q1 = result.data.features[0].properties!.quality_index;
      const q2 = result.data.features[1].properties!.quality_index;
      expect(typeof q1).toBe('number');
      expect(typeof q2).toBe('number');
      expect(q1).toBeGreaterThan(q2!); // better metrics → higher score
    });

    it('computes metro averages', async () => {
      const fakeTopo = {
        type: 'Topology',
        objects: {
          data: {
            type: 'GeometryCollection',
            geometries: [{
              type: 'Point',
              coordinates: [24.9, 60.2],
              properties: {
                pno: '00100', nimi: 'A', namn: 'A', kunta: '091', city: 'helsinki',
                he_vakiy: 1000, hr_mtu: 30000,
              },
            }],
          },
        },
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(fakeTopo),
      }));

      const mod = await import('../utils/dataLoader');
      const result = await mod.loadAllData();
      expect(result.metroAverages).toBeDefined();
      expect(typeof result.metroAverages.he_vakiy).toBe('number');
    });
  });
});
