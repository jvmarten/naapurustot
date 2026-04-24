/**
 * Tests that the ID_FIELDS set in dataLoader.ts matches reality.
 *
 * Previous test files replicated the coercion logic with only
 * ['pno', 'postinumeroalue', 'kunta'] but the actual code protects
 * ['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city'].
 * This test imports the real module and verifies coercion behavior
 * against the ACTUAL processTopology pipeline via the caching test path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
            nimi: '12345',
            namn: '67890',
            kunta: '091',
            city: '99999',
            he_vakiy: '5000',
            hr_mtu: '35000',
          },
        },
      ],
    },
  },
  arcs: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]],
  bbox: [0, 0, 100, 100],
};

describe('dataLoader — ID fields preserved through real processTopology', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves nimi, namn, and city as strings even when they look numeric', async () => {
    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(MOCK_TOPO),
    });

    const result = await loadAllData();
    const props = result.data.features[0].properties!;

    expect(props.pno).toBe('00100');
    expect(typeof props.pno).toBe('string');

    expect(props.nimi).toBe('12345');
    expect(typeof props.nimi).toBe('string');

    expect(props.namn).toBe('67890');
    expect(typeof props.namn).toBe('string');

    expect(props.kunta).toBe('091');
    expect(typeof props.kunta).toBe('string');

    expect(props.city).toBe('99999');
    expect(typeof props.city).toBe('string');

    expect(props.he_vakiy).toBe(5000);
    expect(typeof props.he_vakiy).toBe('number');

    expect(props.hr_mtu).toBe(35000);
    expect(typeof props.hr_mtu).toBe('number');
  });

  it('null properties do not crash processTopology', async () => {
    const topoWithNull = {
      ...MOCK_TOPO,
      objects: {
        neighborhoods: {
          type: 'GeometryCollection',
          geometries: [
            {
              type: 'Polygon',
              arcs: [[0]],
              properties: null,
            },
          ],
        },
      },
    };

    const { loadAllData, resetDataCache } = await import('../utils/dataLoader');
    resetDataCache();

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(topoWithNull),
    });

    const result = await loadAllData();
    expect(result.data.type).toBe('FeatureCollection');
  });
});
