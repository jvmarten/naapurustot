import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSkyUvi,
  geocodeUrl,
  noonBandUvi,
  parseGeocode,
  reverseGeocode,
  sunDistanceFactor,
  theoryDay,
  theoryUviAt,
  uvTheoryRgb,
} from '../live/uvTheory';
import { ALL_FEEDS, defaultEnabledFeeds } from '../live/feeds';

describe('clearSkyUvi', () => {
  it('is 12 with the sun overhead at mean distance and 300 DU', () => {
    expect(clearSkyUvi(90, 1)).toBeCloseTo(12, 6);
  });
  it('is zero with the sun on or below the horizon', () => {
    expect(clearSkyUvi(0, 1)).toBe(0);
    expect(clearSkyUvi(-10, 1)).toBe(0);
  });
  it('rises as the ozone column thins', () => {
    expect(clearSkyUvi(50, 1, 250)).toBeGreaterThan(clearSkyUvi(50, 1, 300));
  });
});

describe('sunDistanceFactor', () => {
  it('peaks at perihelion in early January and bottoms out in early July', () => {
    expect(sunDistanceFactor(Date.UTC(2026, 0, 3, 12))).toBeCloseTo(1.0334, 3);
    expect(sunDistanceFactor(Date.UTC(2026, 6, 4, 12))).toBeCloseTo(0.9666, 3);
  });
});

describe('theoryDay', () => {
  it('gives Helsinki about 6.7 at the June solstice noon', () => {
    const d = theoryDay(60.17, 24.94, Date.UTC(2026, 5, 21, 10));
    expect(d.noonAltitude).toBeGreaterThan(52.5);
    expect(d.noonAltitude).toBeLessThan(53.8);
    expect(d.peak).toBeGreaterThan(6.4);
    expect(d.peak).toBeLessThan(7.1);
    expect(d.sed).toBeGreaterThan(20);
  });

  it('integrates the place’s own solar day, not the viewer’s', () => {
    // Asked at Helsinki midnight, Tokyo is mid-morning: its noon is still the peak.
    const d = theoryDay(35.69, 139.69, Date.UTC(2026, 5, 20, 21));
    expect(d.noonAltitude).toBeGreaterThan(77);
    expect(d.noonAltitude).toBeLessThan(78.5);
  });

  it('answers polar night with a sun that never rises', () => {
    const d = theoryDay(69.9, 27.0, Date.UTC(2026, 11, 21, 10));
    expect(d.noonAltitude).toBeLessThan(0);
    expect(d.peak).toBe(0);
    expect(d.sed).toBe(0);
  });

  it('agrees with the instant value at solar noon', () => {
    const d = theoryDay(0, 0, Date.UTC(2026, 2, 20, 12));
    expect(theoryUviAt(0, 0, Date.UTC(2026, 2, 20, 12, 7))).toBeCloseTo(d.peak, 1);
  });
});

describe('uvTheoryRgb', () => {
  it('clamps to the ramp at both ends', () => {
    expect(uvTheoryRgb(-1)).toEqual([0xb8, 0xb8, 0xb8]);
    expect(uvTheoryRgb(40)).toEqual([0x1d, 0x21, 0x78]);
  });
});

describe('geocoder', () => {
  it('asks in the page language', () => {
    const u = new URL(geocodeUrl('Tukholma', 'fi'));
    expect(u.searchParams.get('name')).toBe('Tukholma');
    expect(u.searchParams.get('language')).toBe('fi');
  });

  it('keeps valid places and drops ones without coordinates', () => {
    const out = parseGeocode({
      results: [
        { name: 'Tokio', latitude: 35.69, longitude: 139.69, admin1: 'Tokio', country: 'Japani' },
        { name: 'Nowhere' },
      ],
    });
    expect(out).toEqual([{ name: 'Tokio', where: 'Japani', lat: 35.69, lon: 139.69 }]);
    expect(parseGeocode({})).toEqual([]);
  });
});

describe('registry', () => {
  it('lists the theoretical UV as a computed live feed, off by default', () => {
    const f = ALL_FEEDS.find((x) => x.id === 'uv_theory');
    expect(f?.status).toBe('live');
    expect(f?.time).toBe('computed');
    expect(defaultEnabledFeeds().has('uv_theory')).toBe(false);
  });
});

describe('year view helpers', () => {
  it('daylight runs from none in polar night to all day under the midnight sun', () => {
    expect(theoryDay(69.9, 27.0, Date.UTC(2026, 11, 21, 12)).daylight).toBe(0);
    expect(theoryDay(69.9, 27.0, Date.UTC(2026, 5, 21, 12)).daylight).toBe(24);
    const eq = theoryDay(0, 0, Date.UTC(2026, 2, 20, 12)).daylight;
    expect(eq).toBeGreaterThan(11.8);
    expect(eq).toBeLessThan(12.2);
  });

  it('the band peaks under the subsolar point and matches the table at noon', () => {
    const june = Date.UTC(2026, 5, 21, 12);
    expect(noonBandUvi(23.4, june)).toBeGreaterThan(noonBandUvi(0, june));
    expect(noonBandUvi(60.17, june)).toBeCloseTo(theoryDay(60.17, 0, june).peak, 0);
  });

  it('a thinner ozone column raises the whole day', () => {
    const d = Date.UTC(2026, 5, 21, 12);
    expect(theoryDay(35, 139, d, 250).sed).toBeGreaterThan(theoryDay(35, 139, d, 300).sed);
  });
});

describe('reverseGeocode', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

  it('names a point by its settlement, region and country', async () => {
    stub({ name: 'Shibuya', address: { city: 'Shibuya', state: 'Tokyo', country: 'Japan' } });
    expect(await reverseGeocode(35.66, 139.7, 'en')).toEqual({ name: 'Shibuya', where: 'Tokyo, Japan' });
  });

  it('answers null for open sea, so the caller falls back to coordinates', async () => {
    stub({ error: 'Unable to geocode' });
    expect(await reverseGeocode(0, -30, 'en')).toBeNull();
  });
});
