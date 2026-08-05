import { describe, it, expect } from 'vitest';
import { sunPosition, sunTimes, shadowLengthRatio, shadowBearing } from '../utils/sun';

/**
 * Reference coordinates spanning Finland's latitude range, which is what makes
 * the polar cases mandatory rather than exotic: Utsjoki sits 3.4° above the
 * Arctic Circle and genuinely has months without a sunrise.
 */
const HELSINKI = { lat: 60.1699, lon: 24.9384 };
const UTSJOKI = { lat: 69.9081, lon: 27.0289 };

/** Solstices, in UTC. */
const SUMMER_SOLSTICE = new Date('2026-06-21T12:00:00Z');
const WINTER_SOLSTICE = new Date('2026-12-21T12:00:00Z');

describe('sunPosition', () => {
  it('puts the sun due south and high at Helsinki summer solar noon', () => {
    const { solarNoon } = sunTimes(SUMMER_SOLSTICE, HELSINKI.lat, HELSINKI.lon);
    const { altitude, azimuth } = sunPosition(solarNoon, HELSINKI.lat, HELSINKI.lon);

    // At the summer solstice the noon altitude is 90 - lat + 23.44 = 53.3°.
    expect(altitude).toBeGreaterThan(52);
    expect(altitude).toBeLessThan(54.5);
    // Due south, i.e. a compass bearing of 180°.
    expect(Math.abs(azimuth - 180)).toBeLessThan(1);
  });

  it('puts the sun low but up at Helsinki winter solar noon', () => {
    const { solarNoon } = sunTimes(WINTER_SOLSTICE, HELSINKI.lat, HELSINKI.lon);
    const { altitude, azimuth } = sunPosition(solarNoon, HELSINKI.lat, HELSINKI.lon);

    // 90 - lat - 23.44 = 6.4°.
    expect(altitude).toBeGreaterThan(5);
    expect(altitude).toBeLessThan(8);
    expect(Math.abs(azimuth - 180)).toBeLessThan(1);
  });

  it('reports the sun below the horizon at local midnight in winter', () => {
    const midnight = new Date('2026-12-21T22:00:00Z');
    const { altitude } = sunPosition(midnight, HELSINKI.lat, HELSINKI.lon);
    expect(altitude).toBeLessThan(0);
  });

  it('returns azimuth as a compass bearing in [0, 360)', () => {
    for (let hour = 0; hour < 24; hour++) {
      const at = new Date(Date.UTC(2026, 5, 21, hour));
      const { azimuth } = sunPosition(at, HELSINKI.lat, HELSINKI.lon);
      expect(azimuth).toBeGreaterThanOrEqual(0);
      expect(azimuth).toBeLessThan(360);
    }
  });

  it('sweeps the sun eastward-to-westward across the day', () => {
    // Morning sun in the east (azimuth < 180), afternoon sun in the west.
    const morning = sunPosition(new Date('2026-06-21T04:00:00Z'), HELSINKI.lat, HELSINKI.lon);
    const afternoon = sunPosition(new Date('2026-06-21T15:00:00Z'), HELSINKI.lat, HELSINKI.lon);
    expect(morning.azimuth).toBeLessThan(180);
    expect(afternoon.azimuth).toBeGreaterThan(180);
  });
});

describe('sunTimes', () => {
  it('gives Helsinki a ~18.9 h midsummer day', () => {
    const times = sunTimes(SUMMER_SOLSTICE, HELSINKI.lat, HELSINKI.lon);
    expect(times.polar).toBeNull();
    expect(times.sunrise).toBeInstanceOf(Date);
    expect(times.sunset).toBeInstanceOf(Date);
    expect(times.dayLength).toBeGreaterThan(18.5);
    expect(times.dayLength).toBeLessThan(19.2);
  });

  it('gives Helsinki a ~5.8 h midwinter day', () => {
    const times = sunTimes(WINTER_SOLSTICE, HELSINKI.lat, HELSINKI.lon);
    expect(times.polar).toBeNull();
    expect(times.dayLength).toBeGreaterThan(5.4);
    expect(times.dayLength).toBeLessThan(6.2);
  });

  it('reports midnight sun at Utsjoki in June, with no sunrise or sunset', () => {
    const times = sunTimes(SUMMER_SOLSTICE, UTSJOKI.lat, UTSJOKI.lon);
    expect(times.polar).toBe('day');
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
    expect(times.dayLength).toBe(24);
    // Solar noon still exists — the sun still has a highest point.
    expect(times.solarNoon).toBeInstanceOf(Date);
    expect(sunPosition(times.solarNoon, UTSJOKI.lat, UTSJOKI.lon).altitude).toBeGreaterThan(0);
  });

  it('reports polar night at Utsjoki in December, with no sunrise or sunset', () => {
    const times = sunTimes(WINTER_SOLSTICE, UTSJOKI.lat, UTSJOKI.lon);
    expect(times.polar).toBe('night');
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
    expect(times.dayLength).toBe(0);
    expect(sunPosition(times.solarNoon, UTSJOKI.lat, UTSJOKI.lon).altitude).toBeLessThan(0);
  });

  it('still reports civil twilight during Utsjoki polar night', () => {
    // The distinction that makes kaamos livable: the sun never rises, but there
    // are still hours of usable twilight. A UI that showed "no daylight" would
    // be wrong.
    const times = sunTimes(new Date('2026-12-10T12:00:00Z'), UTSJOKI.lat, UTSJOKI.lon);
    expect(times.polar).toBe('night');
    expect(times.dawn).toBeInstanceOf(Date);
    expect(times.dusk).toBeInstanceOf(Date);
  });

  it('orders the phases of an ordinary Helsinki day', () => {
    const t = sunTimes(new Date('2026-04-15T12:00:00Z'), HELSINKI.lat, HELSINKI.lon);
    const seq = [t.dawn, t.sunrise, t.goldenHourEnd, t.solarNoon, t.goldenHourStart, t.sunset, t.dusk];
    for (const step of seq) expect(step).toBeInstanceOf(Date);
    const ms = seq.map((s) => (s as Date).valueOf());
    for (let i = 1; i < ms.length; i++) {
      expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    }
  });

  it('places sunrise and sunset symmetrically about solar noon', () => {
    const t = sunTimes(new Date('2026-04-15T12:00:00Z'), HELSINKI.lat, HELSINKI.lon);
    const beforeNoon = t.solarNoon.valueOf() - (t.sunrise as Date).valueOf();
    const afterNoon = (t.sunset as Date).valueOf() - t.solarNoon.valueOf();
    expect(Math.abs(beforeNoon - afterNoon)).toBeLessThan(1000);
  });
});

describe('shadowLengthRatio', () => {
  it('casts a shadow exactly as long as the object at 45°', () => {
    expect(shadowLengthRatio(45)).toBeCloseTo(1, 6);
  });

  it('shortens the shadow as the sun climbs', () => {
    const low = shadowLengthRatio(10) as number;
    const high = shadowLengthRatio(70) as number;
    expect(low).toBeGreaterThan(high);
    // A 20 m building at 10° casts ~113 m.
    expect(low * 20).toBeGreaterThan(100);
  });

  it('returns null rather than Infinity once the sun is down', () => {
    expect(shadowLengthRatio(0)).toBeNull();
    expect(shadowLengthRatio(-5)).toBeNull();
  });
});

describe('shadowBearing', () => {
  it('points directly away from the sun', () => {
    expect(shadowBearing(180)).toBe(0);
    expect(shadowBearing(90)).toBe(270);
    expect(shadowBearing(0)).toBe(180);
  });

  it('stays within [0, 360)', () => {
    for (let a = 0; a < 360; a += 17) {
      const b = shadowBearing(a);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});
