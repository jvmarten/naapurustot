import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import {
  parseWaterLatest,
  parseWaterHistory,
  mergeWater,
  sampleWater,
  waterRange,
  waterHistoryUrl,
  formatWaterC,
  WATER_TOLERANCE_MS,
  type WaterTimeline,
} from '../live/watertemp';
import { WaterChart } from '../live/WaterChart';

/**
 * Beach water temperature (Uiras). Shapes copied from the live service on
 * 2026-11-03: a sensor pulled for the winter carries no `measurement`, and the
 * per-sensor file holds `raw` / `h3` / `d1` series.
 */

const LATEST = {
  type: 'FeatureCollection',
  meta: { created_at: '2026-11-03T10:20:02+00:00' },
  features: [
    {
      type: 'Feature',
      id: '70B3D57050001AB9',
      geometry: { type: 'Point', coordinates: [24.983821, 60.227704] },
      properties: {
        name: 'Pikkukosken uimaranta',
        district: 'Veräjämäki',
        'installation depth': -0.2,
        measurement: { time: '2026-11-03T12:12:19.937000+02:00', temp_in: 7.5, temp_water: 8.12 },
      },
    },
    // Winter: no measurement at all — not drawn.
    {
      type: 'Feature',
      id: '70B3D5705001148E',
      geometry: { type: 'Point', coordinates: [24.951225, 60.153153] },
      properties: { name: 'Uunisaari', district: 'Ullanlinna' },
    },
    // An absent water value is not a zero.
    {
      type: 'Feature',
      id: '70B3D57050004CDB',
      geometry: { type: 'Point', coordinates: [24.8579, 60.1707] },
      properties: { name: 'Lauttasaari', measurement: { time: '2026-11-03T12:13:02+02:00' } },
    },
    // Not a sensor id — never becomes a URL.
    {
      type: 'Feature',
      id: '../../etc',
      geometry: { type: 'Point', coordinates: [24.9, 60.1] },
      properties: { measurement: { time: '2026-11-03T12:00:00+02:00', temp_water: 9 } },
    },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('parseWaterLatest', () => {
  it('keeps sensors with a reading and drops the rest', () => {
    const list = parseWaterLatest(LATEST);
    expect(list).toHaveLength(1);
    const r = list[0];
    expect(r.id).toBe('70B3D57050001AB9');
    expect(r.lon).toBeCloseTo(24.983821);
    expect(r.lat).toBeCloseTo(60.227704);
    expect(r.celsius).toBe(8.12);
    expect(r.enclosure).toBe(7.5);
    expect(r.depth).toBeCloseTo(0.2);
    expect(r.at).toBe(Date.parse('2026-11-03T10:12:19.937Z'));
  });

  it('throws on something that is not a FeatureCollection', () => {
    expect(() => parseWaterLatest({ features: [] })).toThrow();
    expect(() => parseWaterLatest(null)).toThrow();
  });
});

describe('the session recording', () => {
  const base = parseWaterLatest(LATEST)[0];

  it('samples the nearest received reading within tolerance, and nothing beyond', () => {
    const tl: WaterTimeline = new Map();
    mergeWater(tl, [base]);
    mergeWater(tl, [base]); // a repeated poll adds nothing
    mergeWater(tl, [{ ...base, at: base.at + 30 * 60_000, celsius: 8.3 }]);
    expect(tl.get(base.id)).toHaveLength(2);
    expect(sampleWater(tl, base.at + 5 * 60_000, WATER_TOLERANCE_MS)[0].celsius).toBe(8.12);
    expect(sampleWater(tl, base.at + 29 * 60_000, WATER_TOLERANCE_MS)[0].celsius).toBe(8.3);
    expect(sampleWater(tl, base.at - 2 * 3600_000, WATER_TOLERANCE_MS)).toHaveLength(0);
    expect(waterRange(tl)).toEqual({ from: base.at, to: base.at + 30 * 60_000 });
  });
});

describe('history', () => {
  it('builds URLs only for sensor ids', () => {
    expect(waterHistoryUrl('70B3D57050001AB9')).toBe(
      'https://iot.fvh.fi/opendata/uiras/70B3D57050001AB9.geojson',
    );
    expect(waterHistoryUrl('../x')).toBeNull();
  });

  it('parses the three series ascending and drops empty values', () => {
    const h = parseWaterHistory({
      properties: {
        data: {
          raw: [
            { time: '2026-11-03T09:50:46+00:00', temp_water: 8.18 },
            { time: '2026-11-03T09:20:46+00:00', temp_water: 8.2 },
            { time: '2026-11-03T08:50:46+00:00', temp_water: null },
          ],
          h3: [{ time: '2026-11-03T09:00:00+00:00', temp_water: 8.18 }],
          d1: [],
        },
      },
    });
    expect(h.raw.map((p) => p.celsius)).toEqual([8.2, 8.18]);
    expect(h.h3).toHaveLength(1);
    expect(h.d1).toHaveLength(0);
    expect(() => parseWaterHistory({})).toThrow();
  });

  it('formats with a real minus sign', () => {
    expect(formatWaterC(-0.4)).toBe('−0.4');
    expect(formatWaterC(-0.01)).toBe('0.0');
    expect(formatWaterC(8.12)).toBe('8.1');
  });
});

describe('WaterChart', () => {
  it('fetches the sensor file and draws its week', async () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({
      time: new Date(Date.UTC(2026, 10, 3, i)).toISOString(),
      temp_water: 8 + i / 10,
    }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ properties: { data: { raw, h3: [], d1: [] } } })),
    );
    const { container } = render(<WaterChart id="70B3D57050001AB9" when={Date.UTC(2026, 10, 3, 5)} />);
    await waitFor(() => expect(container.querySelector('svg path')).not.toBeNull());
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://iot.fvh.fi/opendata/uiras/70B3D57050001AB9.geojson',
    );
    // One unbroken subpath for an evenly spaced series.
    expect(container.querySelector('svg path')!.getAttribute('d')!.match(/M/g)).toHaveLength(1);
    expect(screen.getByRole('img')).toBeTruthy();
  });
});
