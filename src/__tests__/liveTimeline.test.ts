import { describe, it, expect } from 'vitest';
import {
  createTimeline,
  clearTimeline,
  mergeReadings,
  sampleTimeline,
  timelineRange,
} from '../live/timeline';

/**
 * The store that made the time slider stop being a request.
 *
 * Everything here is about one promise: a value shown at instant T is a value
 * somebody published, near T, and it says which. The tests are written against
 * the ways that promise can quietly break — a forecast outliving the hour it
 * predicted, a sample carried further than its tolerance, a station's series
 * arriving out of order.
 */

const HOUR = 3_600_000;
const at = (h: number) => Date.parse(`2026-08-12T${String(h).padStart(2, '0')}:00:00Z`);

const reading = (h: number, value: number, lat = 60, lon = 24) => ({
  lat,
  lon,
  value,
  at: at(h),
});

describe('timeline — merging', () => {
  it('keeps each station sorted however the readings arrive', () => {
    // The day window comes back grouped by station, the live poll comes back
    // one-per-station, and a refinement lands in the middle of both. Every
    // lookup below is a binary search, so an unsorted series does not fail — it
    // silently answers with the wrong hour.
    const tl = createTimeline();
    mergeReadings(tl, [reading(12, 20), reading(6, 10), reading(9, 15)]);
    mergeReadings(tl, [reading(7, 11)]);

    const hours = [6, 7, 9, 12].map((h) => sampleTimeline(tl, at(h), 60_000)[0].value);
    expect(hours).toEqual([10, 11, 15, 20]);
  });

  it('does not duplicate a reading that arrives twice', () => {
    // The day load and the live poll overlap by design — both cover "now" — so
    // the same published reading is merged more than once on an ordinary page
    // load. A series that grew every time would drift towards a megabyte.
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 15)]);
    mergeReadings(tl, [reading(9, 15)]);
    mergeReadings(tl, [reading(9, 15)]);
    expect(sampleTimeline(tl, at(9), 60_000)).toHaveLength(1);
    expect(timelineRange(tl)).toEqual({ from: at(9), to: at(9) });
  });

  it('lets a measurement replace a forecast for the same hour, never the reverse', () => {
    // The forecast run starts at an hour that has usually already happened. Once
    // it has, what the model expected of it is stale data rather than a second
    // opinion — and a page left open long enough will merge both orders.
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 15)], true);
    mergeReadings(tl, [reading(9, 14.2)]);
    expect(sampleTimeline(tl, at(9), 60_000)[0]).toMatchObject({
      value: 14.2,
      forecast: false,
    });

    mergeReadings(tl, [reading(9, 99)], true);
    expect(sampleTimeline(tl, at(9), 60_000)[0]).toMatchObject({
      value: 14.2,
      forecast: false,
    });
  });

  it('lets a REVISED forecast replace an earlier one for the same hour', () => {
    // This is the whole job of the half-hourly day refresh: a page left open
    // across a model run must stop showing the run it loaded at breakfast. The
    // merge used to drop a forecast arriving over a forecast, so every one of
    // those refreshes re-downloaded ECMWF's answer and threw all of it away.
    const tl = createTimeline();
    mergeReadings(tl, [reading(18, 15)], true);
    mergeReadings(tl, [reading(18, 17.4)], true);
    expect(sampleTimeline(tl, at(18), 60_000)[0]).toMatchObject({
      value: 17.4,
      forecast: true,
    });
  });

  it('treats stations a metre apart as different stations', () => {
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 15, 60.0), reading(9, 3, 60.001)]);
    expect(sampleTimeline(tl, at(9), 60_000)).toHaveLength(2);
  });
});

describe('timeline — sampling', () => {
  it('answers with the nearest published value and its own timestamp', () => {
    // The panel and the readout print the returned `at`, not the clock's — the
    // whole difference between "18.3° at 14:23" and "18.3°, measured 14:00".
    const tl = createTimeline();
    mergeReadings(tl, [reading(14, 18.3), reading(15, 19.1)]);
    const sample = sampleTimeline(tl, at(14) + 23 * 60_000, 45 * 60_000)[0];
    expect(sample.value).toBe(18.3);
    expect(sample.at).toBe(at(14));
  });

  it('drops a station whose nearest value is outside the tolerance', () => {
    // This is the honesty knob. Beyond it the map draws nothing, which is this
    // project's answer for missing data everywhere else — not the last number it
    // happens to hold, under a clock it has nothing to do with.
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 15)]);
    expect(sampleTimeline(tl, at(9) + 44 * 60_000, 45 * 60_000)).toHaveLength(1);
    expect(sampleTimeline(tl, at(9) + 46 * 60_000, 45 * 60_000)).toHaveLength(0);
    expect(sampleTimeline(tl, at(9) - 46 * 60_000, 45 * 60_000)).toHaveLength(0);
  });

  it('breaks a tie between two measurements towards the earlier one', () => {
    // At the midpoint between two hourly values the past one has happened and
    // the future one has not.
    const tl = createTimeline();
    mergeReadings(tl, [reading(14, 18.3), reading(15, 19.1)]);
    expect(sampleTimeline(tl, at(14) + HOUR / 2, HOUR)[0].at).toBe(at(14));
  });

  it('prefers a measurement to a forecast even when the forecast is nearer', () => {
    // The case that put a model's number on a page called /live/: near the top
    // of the hour the forecast run's next step sits a couple of minutes away
    // while the last actual reading is eight minutes old. Within tolerance an
    // instrument always wins; nearness only decides between two of a kind.
    const tl = createTimeline();
    mergeReadings(tl, [{ lat: 60, lon: 24, value: 18.3, at: at(14) - 8 * 60_000 }]);
    mergeReadings(tl, [{ lat: 60, lon: 24, value: 21.0, at: at(14) + 2 * 60_000 }], true);

    const sample = sampleTimeline(tl, at(14), 45 * 60_000)[0];
    expect(sample.value).toBe(18.3);
    expect(sample.forecast).toBe(false);
  });

  it('hands over to the forecast exactly where the measurements run out', () => {
    // The crossover is the tolerance, not the wall clock — which is what keeps
    // the layer continuous across "now" instead of blanking at it.
    const tl = createTimeline();
    mergeReadings(tl, [reading(14, 18.3)]);
    mergeReadings(tl, [reading(15, 22.0), reading(16, 24.0)], true);

    const inside = sampleTimeline(tl, at(14) + 40 * 60_000, 45 * 60_000)[0];
    expect(inside).toMatchObject({ value: 18.3, forecast: false });

    const beyond = sampleTimeline(tl, at(15) + 30 * 60_000, 45 * 60_000)[0];
    expect(beyond).toMatchObject({ value: 22.0, forecast: true });
  });

  it('does not reach past the tolerance for a measurement it would prefer', () => {
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 18.3)]);
    mergeReadings(tl, [reading(20, 22.0)], true);
    expect(sampleTimeline(tl, at(20), 45 * 60_000)[0]).toMatchObject({
      value: 22.0,
      forecast: true,
    });
  });

  it('carries the forecast flag through to the caller', () => {
    const tl = createTimeline();
    mergeReadings(tl, [reading(20, 12.4)], true);
    expect(sampleTimeline(tl, at(20), 60_000)[0].forecast).toBe(true);
  });

  it('is empty on an empty store rather than throwing', () => {
    const tl = createTimeline();
    expect(sampleTimeline(tl, Date.now(), HOUR)).toEqual([]);
    expect(timelineRange(tl)).toBeNull();
  });
});

describe('timeline — clearing', () => {
  it('forgets everything, so yesterday cannot answer for today', () => {
    // Moving the clock to another day throws the loaded one away. Without it a
    // station that reported on Tuesday and not on Wednesday would keep Tuesday's
    // number within tolerance of Wednesday's clock.
    const tl = createTimeline();
    mergeReadings(tl, [reading(9, 15)]);
    clearTimeline(tl);
    expect(sampleTimeline(tl, at(9), HOUR)).toEqual([]);
    expect(timelineRange(tl)).toBeNull();
  });
});
