import { describe, it, expect } from 'vitest';
import {
  MINUTES_PER_DAY,
  atMinuteOfDay,
  addDays,
  compassPoint,
  formatShadowRatio,
  isFuture,
  isoDate,
  minuteOfDay,
  quantise,
  skyColor,
  skyStops,
  startOfDay,
} from '../live/timeControl';

/**
 * The /live/ page's clock.
 *
 * What is worth pinning here is not the arithmetic — it is the handful of places
 * where the obvious implementation is silently wrong on a map of Finland: a
 * scrubber that wraps into the next day, a sky band drawn from a hard-coded
 * sunrise rather than from the sun, and a "future" test strict enough to flicker
 * on the current minute.
 */

describe('minute-of-day scrubbing', () => {
  it('round-trips a minute through the scrubber coordinate', () => {
    const d = atMinuteOfDay(new Date(2026, 7, 12, 3, 4, 5), 8 * 60 + 45);
    expect(minuteOfDay(d)).toBe(8 * 60 + 45);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(45);
    // Seconds are zeroed: the scrubber's resolution is a minute, and carrying
    // the previous instant's seconds would make two identical drags land on two
    // different instants.
    expect(d.getSeconds()).toBe(0);
  });

  it('clamps rather than wrapping at either end of the day', () => {
    const base = new Date(2026, 7, 12, 12, 0, 0);
    // A drag past the right edge belongs at 23:59 today, NOT at 00:00 tomorrow —
    // the date is stepped with the date control, and a scrubber that silently
    // changed the day would make the shadows jump a sunrise.
    expect(isoDate(atMinuteOfDay(base, MINUTES_PER_DAY + 500))).toBe('2026-08-12');
    expect(minuteOfDay(atMinuteOfDay(base, MINUTES_PER_DAY + 500))).toBe(MINUTES_PER_DAY - 1);
    expect(minuteOfDay(atMinuteOfDay(base, -90))).toBe(0);
  });

  it('keeps the time of day when stepping the date', () => {
    const d = addDays(new Date(2026, 7, 12, 8, 45), 1);
    expect(isoDate(d)).toBe('2026-08-13');
    expect(minuteOfDay(d)).toBe(8 * 60 + 45);
  });

  it('formats the date in LOCAL time', () => {
    // `toISOString().slice(0,10)` is the tempting one-liner and it is wrong east
    // of Greenwich: 00:30 on the 12th in Helsinki is 21:30 on the 11th in UTC,
    // so it would hand the rail API yesterday's departure date.
    expect(isoDate(new Date(2026, 7, 12, 0, 30))).toBe('2026-08-12');
    expect(isoDate(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01');
  });

  it('starts the day at local midnight', () => {
    const d = startOfDay(new Date(2026, 7, 12, 17, 3, 9, 400));
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });
});

describe('quantise', () => {
  it('rounds an instant down to the step', () => {
    const t = Date.parse('2026-08-12T09:37:41Z');
    const q = quantise(t, 300_000);
    expect(q).toBe(Date.parse('2026-08-12T09:35:00Z'));
    // Idempotent, which is what makes it usable as a fetch key: dragging within
    // the same five minutes must not produce a second request.
    expect(quantise(q, 300_000)).toBe(q);
  });
});

describe('isFuture', () => {
  it('allows a minute of slack around now', () => {
    const now = Date.parse('2026-08-12T09:00:00Z');
    // The page's clock and a source's clock are never exactly aligned, and the
    // scrubber lands on whole minutes. A strict `t > now` flickers the measured
    // feeds off and on every time the user drags onto the current minute.
    expect(isFuture(now + 30_000, now)).toBe(false);
    expect(isFuture(now + 120_000, now)).toBe(true);
    expect(isFuture(now - 3_600_000, now)).toBe(false);
  });
});

describe('skyColor', () => {
  it('darkens monotonically as the sun sets', () => {
    const brightness = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const ladder = [40, 20, 6, 0, -6, -12, -18, -40].map((a) => brightness(skyColor(a)));
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]).toBeLessThanOrEqual(ladder[i - 1]);
    }
  });

  it('is flat beyond both ends of the ramp', () => {
    // Below astronomical twilight the sky does not get darker, and the ramp must
    // not extrapolate into negative channel values.
    expect(skyColor(-18)).toBe(skyColor(-60));
    expect(skyColor(60)).toBe(skyColor(89));
    expect(skyColor(-90)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('skyStops', () => {
  const stops = (s: string) => s.split(', ');

  it('spans the whole track', () => {
    const s = stops(skyStops(new Date(2026, 5, 21), 60.17, 24.94));
    expect(s[0]).toMatch(/ 0\.00%$/);
    expect(s[s.length - 1]).toMatch(/ 100\.00%$/);
  });

  it('collapses flat runs but keeps the twilight detail', () => {
    // The band is a picture of the sky, and midsummer in Helsinki has very
    // little dark in it — but the interesting part is that the ramp is not
    // emitted at full sample density: a constant-colour run is exact with only
    // its two endpoints, because CSS interpolates linearly between stops.
    const midsummer = stops(skyStops(new Date(2026, 5, 21), 60.17, 24.94));
    expect(midsummer.length).toBeGreaterThan(4);
    expect(midsummer.length).toBeLessThan(181);
  });

  // A stop's brightness, for comparing a whole day against a reference altitude.
  const brightness = (hex: string) =>
    parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
  const dayBrightness = (date: Date, lat: number, lon: number) =>
    stops(skyStops(date, lat, lon)).map((s) => brightness(s.split(' ')[0]));

  it('never reaches daylight during polar night', () => {
    // Utsjoki in December. The band is NOT flat — the sun still climbs from
    // about -20° at midnight to -3° at noon, and drawing that is the point —
    // but nothing in the day may reach the horizon's colour, because nothing in
    // the day reaches the horizon.
    const day = dayBrightness(new Date(2026, 11, 21), 69.9, 27.0);
    expect(Math.max(...day)).toBeLessThan(brightness(skyColor(-0.833)));
  });

  it('never reaches night during the midnight sun', () => {
    // The same place in June: the sun bottoms out around +3°, so every sample is
    // above the horizon. The failure this catches is a sign error putting the
    // Arctic into permanent darkness in midsummer.
    const day = dayBrightness(new Date(2026, 5, 21), 69.9, 27.0);
    expect(Math.min(...day)).toBeGreaterThan(brightness(skyColor(-0.833)));
  });

  it('puts the sunrise where the sun actually rises, not at a fixed fraction', () => {
    // Two dates, one place. If the band were decoration the transition would sit
    // in the same place both times; it moves by hours between March and June,
    // which is the whole reason the band is sampled rather than drawn.
    const firstLight = (date: Date) => {
      const list = stops(skyStops(date, 60.17, 24.94));
      const lit = list.find((s) => parseInt(s.slice(1, 3), 16) > 200);
      return lit ? Number(lit.split(' ')[1].replace('%', '')) : NaN;
    };
    expect(firstLight(new Date(2026, 5, 21))).toBeLessThan(firstLight(new Date(2026, 2, 21)));
  });
});

describe('readout formatting', () => {
  it('caps the shadow ratio instead of printing cot(0.1°)', () => {
    expect(formatShadowRatio(null)).toBe('—');
    expect(formatShadowRatio(2.34)).toBe('2.3×');
    expect(formatShadowRatio(573)).toBe('>99×');
  });

  it('reads an azimuth as a compass point', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(99.7)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(359)).toBe('N');
    // Wraps rather than indexing off the end of the table.
    expect(compassPoint(720)).toBe('N');
    expect(compassPoint(-90)).toBe('W');
  });
});
