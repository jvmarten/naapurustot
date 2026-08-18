import { describe, it, expect } from 'vitest';
import {
  formatUv,
  parseUv,
  pickUv,
  uvBand,
  uvCell,
  uvUrl,
  UV_TOLERANCE_MS,
  type UvHour,
} from '../live/uv';

/**
 * The /live/ UV readout.
 *
 * What is worth pinning here is not the arithmetic. It is the three places this
 * feed can quietly say something false: a `null` past the model's horizon read
 * as a night-time zero, an hour attributed to an instant it was not published
 * for, and a camera pan re-asking a public service for a value that cannot have
 * changed.
 */

describe('the request', () => {
  it('rounds the coordinate to the model’s own cell, so a pan re-asks nothing', () => {
    // CAMS European is 11 km, which is one decimal place of latitude here. Two
    // cameras a few hundred metres apart have to produce the same URL or a walk
    // across a city becomes a request per gesture.
    expect(uvCell(60.1712, 24.9384)).toBe(uvCell(60.1904, 24.9101));
    expect(uvCell(60.17, 24.94)).not.toBe(uvCell(60.29, 24.94));

    const a = uvUrl(60.1712, 24.9384, Date.UTC(2026, 7, 18), Date.UTC(2026, 7, 18, 23));
    const b = uvUrl(60.1904, 24.9101, Date.UTC(2026, 7, 18), Date.UTC(2026, 7, 18, 23));
    expect(a).toBe(b);
  });

  it('asks for both variables, as unix time, over whole UTC days', () => {
    const url = new URL(
      uvUrl(60.17, 24.94, Date.UTC(2026, 7, 17, 21), Date.UTC(2026, 7, 18, 21)),
    );
    expect(url.origin + url.pathname).toBe(
      'https://air-quality-api.open-meteo.com/v1/air-quality',
    );
    expect(url.searchParams.get('hourly')).toBe('uv_index,uv_index_clear_sky');
    // Unix seconds rather than ISO strings: half the response, and no parsing.
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('timezone')).toBe('UTC');
    // A LOCAL day straddles two UTC ones, and both ends have to be inside the
    // window or a scrub past midnight lands on an hour that was never fetched.
    expect(url.searchParams.get('start_date')).toBe('2026-08-17');
    expect(url.searchParams.get('end_date')).toBe('2026-08-18');
  });
});

describe('parsing', () => {
  const body = {
    hourly: {
      time: [1_786_924_800, 1_786_928_400, 1_786_932_000],
      uv_index: [0, 2.4, null],
      uv_index_clear_sky: [0, 2.9, null],
    },
  };

  it('keeps the published hours, with their own timestamps', () => {
    const hours = parseUv(body);
    expect(hours).toHaveLength(2);
    expect(hours[0]).toEqual({ at: 1_786_924_800_000, index: 0, clearSky: 0 });
    expect(hours[1].index).toBe(2.4);
    expect(hours[1].clearSky).toBe(2.9);
  });

  /**
   * A null is the model's horizon, and it is not a zero.
   *
   * Zero is a real UV index — it is what every hour of a Finnish night reads —
   * so carrying nulls through as zeros would draw "the sun is not up" across a
   * day nobody has run the model for. Dropped, so the readout can say the model
   * does not reach that instant instead.
   */
  it('drops the hours past the run’s horizon rather than zeroing them', () => {
    expect(parseUv(body).map((h) => h.at)).not.toContain(1_786_932_000_000);
  });

  it('survives a response with nothing in it', () => {
    expect(parseUv({})).toEqual([]);
    expect(parseUv(null)).toEqual([]);
    expect(parseUv({ hourly: { time: [1], uv_index: undefined } })).toEqual([]);
  });

  it('keeps an hour whose clear-sky twin is missing', () => {
    const hours = parseUv({ hourly: { time: [1_786_924_800], uv_index: [3.1] } });
    expect(hours[0].clearSky).toBeNull();
  });
});

describe('sampling under the playhead', () => {
  const at = (h: number) => Date.UTC(2026, 7, 18, h);
  const hours: UvHour[] = [10, 11, 12, 13].map((h) => ({
    at: at(h),
    index: h - 8,
    clearSky: null,
  }));

  it('takes the nearest published hour, not the latest one before', () => {
    // 11:55 belongs to the 12:00 step of the same run. Answering 11:00 would be
    // a worse value that merely happens to be older.
    expect(pickUv(hours, at(11) + 55 * 60_000)?.at).toBe(at(12));
    expect(pickUv(hours, at(12) + 5 * 60_000)?.at).toBe(at(12));
  });

  /**
   * Half a step of tolerance covers the day exactly once.
   *
   * Wider, and an hour would print under an instant nearer to the next one;
   * narrower, and the day would grow gaps that say nothing about the model.
   */
  it('covers every instant between two hours, and nothing beyond the ends', () => {
    expect(UV_TOLERANCE_MS).toBe(1_800_000);
    for (let m = 0; m <= 180; m += 5) {
      expect(pickUv(hours, at(10) + m * 60_000)).not.toBeNull();
    }
    expect(pickUv(hours, at(10) - UV_TOLERANCE_MS - 60_000)).toBeNull();
    expect(pickUv(hours, at(13) + UV_TOLERANCE_MS + 60_000)).toBeNull();
  });

  it('has nothing to say about an empty day', () => {
    expect(pickUv([], at(12))).toBeNull();
  });
});

describe('the WHO exposure bands', () => {
  it('puts each index in the published band', () => {
    expect(uvBand(0).key).toBe('live.uv.band_low');
    expect(uvBand(2.9).key).toBe('live.uv.band_low');
    expect(uvBand(3).key).toBe('live.uv.band_moderate');
    expect(uvBand(5.9).key).toBe('live.uv.band_moderate');
    expect(uvBand(6).key).toBe('live.uv.band_high');
    expect(uvBand(8).key).toBe('live.uv.band_very_high');
    expect(uvBand(11).key).toBe('live.uv.band_extreme');
    expect(uvBand(14.2).key).toBe('live.uv.band_extreme');
  });

  it('gives every band an ink for both themes', () => {
    for (const v of [0, 3, 6, 8, 11]) {
      expect(uvBand(v).light).toMatch(/^#[0-9a-f]{6}$/);
      expect(uvBand(v).dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(uvBand(v).light).not.toBe(uvBand(v).dark);
    }
  });
});

describe('formatting', () => {
  /**
   * One decimal, and never rounded to the whole numbers the bands are stated in.
   *
   * The scale's boundaries are whole; the quantity is not. Printing "3" for 3.4
   * would put a value on screen that CAMS never published, and it is the same
   * one-decimal rule the temperature readout beside it already follows.
   */
  it('prints the value at the precision the source publishes', () => {
    expect(formatUv(3.4)).toBe('3.4');
    expect(formatUv(0)).toBe('0.0');
    // The reserved width in the bar is 4ch; nothing this can print exceeds it.
    expect(formatUv(11.5).length).toBeLessThanOrEqual(4);
  });
});
