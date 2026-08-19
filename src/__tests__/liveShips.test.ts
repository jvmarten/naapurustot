import { describe, it, expect } from 'vitest';
import {
  parseShips,
  parseVessels,
  shipCategoryKey,
  navStatusKey,
  isMakingWay,
  shipKey,
  SHIP_POLL_MS,
  SHIP_TRACK_TOLERANCE_MS,
  type Ship,
} from '../live/ships';
import { pickFeature } from '../live/pick';
import { recordSnapshot, snapshotAt, trackedRuns } from '../live/positionBuffer';

/** A locations feature, shaped like Digitraffic's GeoJSON. */
function feature(mmsi: number, lon: number, lat: number, props: Record<string, unknown> = {}) {
  return {
    mmsi,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { mmsi, ...props },
  };
}

describe('parseShips', () => {
  it('reads a well-formed vessel', () => {
    const [s] = parseShips({
      features: [
        feature(230123000, 24.9, 60.16, {
          sog: 12.3,
          cog: 218.1,
          heading: 219,
          navStat: 0,
          timestampExternal: 1_787_000_000_000,
        }),
      ],
    });
    expect(s).toEqual<Ship>({
      mmsi: 230123000,
      lon: 24.9,
      lat: 60.16,
      sog: 12.3,
      cog: 218.1,
      navStat: 0,
      at: 1_787_000_000_000,
    });
  });

  it('resolves the AIS "not available" sentinels to null, keeping the max-valid values', () => {
    const [na] = parseShips({
      features: [feature(1, 20, 60, { sog: 102.3, cog: 360, navStat: 15 })],
    });
    expect(na).toMatchObject({ sog: null, cog: null, navStat: null });

    const [valid] = parseShips({
      features: [feature(2, 20, 60, { sog: 102.2, cog: 359.9, navStat: 8 })],
    });
    // A tick below each sentinel is a real reading, not "no data".
    expect(valid).toMatchObject({ sog: 102.2, cog: 359.9, navStat: 8 });
  });

  it('nulls reserved navigational statuses above the meaningful range', () => {
    const [s] = parseShips({ features: [feature(1, 20, 60, { navStat: 9 })] });
    expect(s.navStat).toBeNull();
  });

  it('drops features with no MMSI or unusable coordinates', () => {
    const ships = parseShips({
      features: [
        feature(1, 24, 60),
        { type: 'Feature', geometry: { coordinates: [24, 60] }, properties: {} }, // no mmsi
        feature(2, 999, 60), // lon out of range
        { mmsi: 3, geometry: null, properties: {} }, // no geometry
      ],
    });
    expect(ships.map((s) => s.mmsi)).toEqual([1]);
  });

  it('leaves the timestamp null when the feed omits it', () => {
    const [s] = parseShips({ features: [feature(1, 24, 60, {})] });
    expect(s.at).toBeNull();
  });

  it('throws on a non-collection rather than returning an empty sea', () => {
    expect(() => parseShips(null)).toThrow();
    expect(() => parseShips([])).toThrow();
    expect(() => parseShips({})).toThrow();
  });
});

describe('parseVessels', () => {
  it('keys the register on MMSI and converts draught from decimetres to metres', () => {
    const map = parseVessels([
      { mmsi: 230123000, name: 'FURE VASA', shipType: 80, destination: 'SE GVX', draught: 80 },
    ]);
    expect(map.get(230123000)).toEqual({
      name: 'FURE VASA',
      shipType: 80,
      destination: 'SE GVX',
      draughtM: 8,
      callSign: null,
    });
  });

  it('treats the zero sentinels (draught, ship type) and blank strings as absent', () => {
    const map = parseVessels([
      { mmsi: 1, name: '   ', shipType: 0, destination: '', draught: 0, callSign: 'OABC' },
    ]);
    expect(map.get(1)).toEqual({
      name: null,
      shipType: null,
      destination: null,
      draughtM: null,
      callSign: 'OABC',
    });
  });

  it('throws on a non-array payload', () => {
    expect(() => parseVessels({})).toThrow();
  });
});

describe('shipCategoryKey', () => {
  it.each([
    [70, 'cargo'],
    [79, 'cargo'],
    [80, 'tanker'],
    [60, 'passenger'],
    [44, 'high_speed'],
    [30, 'fishing'],
    [52, 'service'],
    [33, 'service'],
    [36, 'recreational'],
    [37, 'recreational'],
    [90, 'other'],
    [0, 'other'],
  ])('maps AIS ship type %i to %s', (code, key) => {
    expect(shipCategoryKey(code)).toBe(key);
  });

  it('maps an unknown (null) type to other', () => {
    expect(shipCategoryKey(null)).toBe('other');
  });
});

describe('navStatusKey', () => {
  it.each([
    [0, 'underway'],
    [1, 'anchored'],
    [5, 'moored'],
    [7, 'fishing'],
    [8, 'sailing'],
  ])('maps navStat %i to %s', (code, key) => {
    expect(navStatusKey(code)).toBe(key);
  });

  it('returns null for a status with no plain-language row', () => {
    expect(navStatusKey(null)).toBeNull();
    expect(navStatusKey(9)).toBeNull();
  });
});

describe('isMakingWay', () => {
  it('is true only for a measured speed at or above the stopped threshold', () => {
    expect(isMakingWay(0.5)).toBe(true);
    expect(isMakingWay(12)).toBe(true);
    expect(isMakingWay(0.4)).toBe(false);
    expect(isMakingWay(0)).toBe(false);
    // Unknown speed is not evidence of movement, so a hull with no course drawn.
    expect(isMakingWay(null)).toBe(false);
  });
});

describe('shipKey', () => {
  it('is the MMSI as a string', () => {
    expect(shipKey({ mmsi: 230123000 })).toBe('230123000');
  });
});

describe('recorded-history tolerance at the 60 s ship cadence', () => {
  // The buffer defaults are tuned for the trains' 5 s poll; ships poll once a
  // minute, so their tolerance must cover a 60 s gap or a scrub goes dark between
  // every pair of snapshots and the readout calls each one a separate stretch.
  const t0 = Date.parse('2026-08-12T09:00:00Z');
  function shipBuffer(count: number) {
    const buf: { at: number; items: Ship[] }[] = [];
    for (let i = 0; i < count; i++) {
      recordSnapshot(buf, t0 + i * SHIP_POLL_MS, [
        { mmsi: 1, lon: 24, lat: 60, sog: 10, cog: 90, navStat: 0, at: t0 + i * SHIP_POLL_MS },
      ]);
    }
    return buf;
  }

  it('resolves an instant midway between two minute-apart snapshots', () => {
    const buf = shipBuffer(10);
    const mid = t0 + SHIP_POLL_MS * 3 + SHIP_POLL_MS / 2; // 30 s past a snapshot
    // The ring's 20 s default would refuse this; the ship tolerance must not.
    expect(snapshotAt(buf, mid, SHIP_TRACK_TOLERANCE_MS)).not.toBeNull();
    expect(snapshotAt(buf, mid)).toBeNull();
  });

  it('reads an unbroken minute-cadence recording as ONE run, not one per poll', () => {
    const buf = shipBuffer(10);
    expect(trackedRuns(buf, SHIP_TRACK_TOLERANCE_MS)).toEqual([
      { from: t0, to: t0 + 9 * SHIP_POLL_MS },
    ]);
    // With the trains' default tolerance every 60 s step looks like a fresh run.
    expect(trackedRuns(buf).length).toBe(10);
  });

  it('still breaks a run across a genuine gap (a hidden tab)', () => {
    const buf = shipBuffer(3);
    const after = t0 + 2 * SHIP_POLL_MS + 5 * 60_000; // five minutes later
    recordSnapshot(buf, after, [{ mmsi: 1, lon: 24, lat: 60, sog: 10, cog: 90, navStat: 0, at: after }]);
    expect(trackedRuns(buf, SHIP_TRACK_TOLERANCE_MS)).toHaveLength(2);
  });
});

describe('pickFeature with ships', () => {
  const project = (lon: number, lat: number) => ({ x: lon, y: lat });

  it('selects the nearest hull within its grab radius', () => {
    const hit = pickFeature(
      { x: 100, y: 100 },
      { ships: [{ lon: 300, lat: 300 }, { lon: 104, lat: 100 }] },
      project,
    );
    expect(hit).toEqual({ kind: 'ship', index: 1 });
  });

  it('returns null when the pointer is beyond the grab radius', () => {
    expect(
      pickFeature({ x: 0, y: 0 }, { ships: [{ lon: 500, lat: 500 }] }, project),
    ).toBeNull();
  });
});
