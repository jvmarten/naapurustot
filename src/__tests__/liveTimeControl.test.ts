import { describe, it, expect, vi } from 'vitest';
import {
  MINUTES_PER_DAY,
  atMinuteOfDay,
  addDays,
  clockSeconds,
  clockTime,
  compassPoint,
  formatShadowRatio,
  hourLabel,
  shortDate,
  isFuture,
  isoDate,
  minuteOfDay,
  quantise,
  skyColor,
  skyStops,
  startOfDay,
  timeOnDay,
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

  /**
   * Every clock on /live/ is 24-hour, whatever the browser's locale prefers.
   *
   * The formatters take the environment's locale (`undefined`), so an en-US
   * browser resolved the hour cycle to h12 and the page printed "03:30 PM" in
   * the clock chip and "1 AM … 11 PM" along a ruler drawn against a 24-hour
   * track. It is a layout bug as well as a reading one: `SunStat` reserves
   * sunrise and sunset at 5ch for "00:00", which "05:24 AM" overflows.
   *
   * The locale is stubbed rather than trusted here — the CI container runs in a
   * locale that happens to be 24-hour, so a test that only asserted the default
   * would have passed before the fix as well as after it.
   */
  describe('24-hour clocks', () => {
    const noAmPm = /^\d{2}:\d{2}$/;

    it('formats an afternoon as 15:30 even where the locale says 3:30 PM', async () => {
      const Real = Intl.DateTimeFormat;
      const spy = vi
        .spyOn(Intl, 'DateTimeFormat')
        .mockImplementation(function (
          _locale?: string,
          options?: Intl.DateTimeFormatOptions,
        ) {
          return new Real('en-US', options);
        } as unknown as typeof Intl.DateTimeFormat);
      // The formatters are memoised at module scope, so this needs a fresh
      // module registry — otherwise it would read whichever formatter an
      // earlier test in this file happened to build first.
      vi.resetModules();
      try {
        const m = await import('../live/timeControl');
        expect(m.clockTime(new Date(2026, 7, 18, 15, 30))).toBe('15:30');
        expect(m.clockSeconds(new Date(2026, 7, 18, 15, 30, 7))).toBe('15:30:07');
        // Midnight is 00, not 24 — the difference between the h23 and h24
        // cycles, and the reason `hour12: false` is not what this asks for.
        expect(m.clockTime(new Date(2026, 7, 18, 0, 5))).toBe('00:05');
      } finally {
        spy.mockRestore();
        vi.resetModules();
      }
    });

    it('keeps the plain formatters free of AM/PM in this environment too', () => {
      expect(clockTime(new Date(2026, 7, 18, 15, 30))).toMatch(noAmPm);
      expect(clockSeconds(new Date(2026, 7, 18, 15, 30, 7))).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    /**
     * The ruler pads to two digits, which Intl will not do for a lone hour.
     *
     * `hour: '2-digit'` is ignored by several locales when the hour is the only
     * field requested, so "3" would sit in a column of "13"s and the 24 numbers
     * would stop reading as a scale.
     */
    it('labels ruler hours as 00..23, zero-padded', () => {
      expect(hourLabel(new Date(2026, 7, 18, 3, 0))).toBe('03');
      expect(hourLabel(new Date(2026, 7, 18, 0, 0))).toBe('00');
      expect(hourLabel(new Date(2026, 7, 18, 23, 0))).toBe('23');
    });

  });

  /**
   * A validity window that spans days has to say so.
   *
   * The road-announcement panel formatted both ends with `clockTime`, so a
   * closure running 14 Aug 21:00 → 18 Aug 05:00 printed "21:00 – 05:00". That
   * is not a partial description of a four-day closure, it is a complete
   * description of an overnight one — the reader is not left short of a fact,
   * they are handed a different one.
   */
  describe('timeOnDay', () => {
    const day = new Date(2026, 7, 16, 12, 0); // 16 Aug 2026, local noon

    it('gives a bare time for an instant on the day being looked at', () => {
      expect(timeOnDay(new Date(2026, 7, 16, 5, 0), day)).toBe(
        clockTime(new Date(2026, 7, 16, 5, 0)),
      );
    });

    it('carries the date for either end that falls on another day', () => {
      const until = new Date(2026, 7, 18, 5, 0);
      const out = timeOnDay(until, day);
      expect(out).not.toBe(clockTime(until));
      expect(out).toContain(clockTime(until));
      expect(out).toContain(shortDate(until));
    });

    it('dates a window that started before the day as well as one ending after', () => {
      expect(timeOnDay(new Date(2026, 6, 14, 21, 0), day)).toContain(
        shortDate(new Date(2026, 6, 14, 21, 0)),
      );
    });

    it('accepts an absolute millisecond stamp, which is what the feed carries', () => {
      const at = new Date(2026, 7, 16, 5, 0);
      expect(timeOnDay(at.getTime(), day)).toBe(clockTime(at));
    });

    it('has an answer for an open-ended window', () => {
      expect(timeOnDay(null, day)).toBe('—');
    });

    it('compares on the local day boundary, so a 23-hour DST day still reads right', () => {
      // 29 Mar 2026 is Finland's spring-forward Sunday: the day is 23 hours
      // long, so "24 hours later" and "tomorrow" are different instants. An
      // instant 23.5 h after midnight is already the 30th and must be dated.
      vi.stubEnv('TZ', 'Europe/Helsinki');
      const dstDay = new Date(2026, 2, 29, 12, 0);
      const nextDay = new Date(startOfDay(dstDay).getTime() + 23.5 * 3_600_000);
      expect(startOfDay(nextDay).getTime()).not.toBe(startOfDay(dstDay).getTime());
      expect(timeOnDay(nextDay, dstDay)).toContain(shortDate(nextDay));
      vi.unstubAllEnvs();
    });
  });
});

/**
 * The day the feeds are loaded in has to cover the day the bar can reach.
 *
 * LivePage fetches each measured feed for [startOfDay(when), startOfDay(when+1))
 * and samples it locally, so anything the scrubber can land on outside that
 * window is a reachable position on the track with no data behind it. The two
 * ends are computed from different things — the window from `startOfDay`, the
 * position from `atMinuteOfDay` — and they agree in every timezone EXCEPT the
 * two days a year the agreement matters.
 *
 * Finland keeps summer time, so the October Sunday is 25 hours long and the
 * March one 23. A window closed at "dayStart plus twenty-four hours" therefore
 * stops an hour short of the bar in October, and that is exactly the sort of
 * once-a-year, one-hour gap nobody notices until it is on the map.
 */
describe('a local day, as the scrubber and the feed loader each measure it', () => {
  // `vi.stubEnv` rather than touching `process.env` directly: the test project
  // has no Node types, and this restores the runner's own zone on teardown even
  // if an assertion throws mid-test.
  const withTz = <T>(tz: string, fn: () => T): T => {
    vi.stubEnv('TZ', tz);
    try {
      return fn();
    } finally {
      vi.unstubAllEnvs();
    }
  };

  // The 2026 European transitions: forward 29 March, back 25 October.
  for (const [label, date] of [
    ['an ordinary day', new Date(2026, 7, 12, 12, 0, 0)],
    ['the day the clocks go forward', new Date(2026, 2, 29, 12, 0, 0)],
    ['the day the clocks go back', new Date(2026, 9, 25, 12, 0, 0)],
  ] as const) {
    it(`covers every reachable minute of ${label}`, () => {
      withTz('Europe/Helsinki', () => {
        // Rebuilt inside the timezone, because the fields above were resolved
        // against whatever zone the test runner happens to be in.
        const day = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
        const start = startOfDay(day).getTime();
        const end = startOfDay(addDays(day, 1)).getTime();
        const lastPosition = atMinuteOfDay(day, MINUTES_PER_DAY - 1).getTime();

        expect(lastPosition).toBeGreaterThanOrEqual(start);
        expect(lastPosition).toBeLessThan(end);
        // And the naive window really is short here, which is what makes the
        // assertion above worth writing rather than trivially true.
        if (label === 'the day the clocks go back') {
          expect(end - start).toBe(25 * 3_600_000);
          expect(lastPosition).toBeGreaterThan(start + 24 * 3_600_000);
        }
      });
    });
  }
});
