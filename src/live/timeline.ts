/**
 * A feed's DAY, held in the page — so the time slider stops being a request.
 *
 * The page's clock (timeControl.ts) used to reach the measured feeds as a
 * quantised, debounced instant that became an HTTP request: drag the bar, wait
 * 400 ms of stillness, wait a round trip, and only then do the temperatures on
 * the map belong to the time under the playhead. That is why scrubbing felt like
 * two different controls — the shadows moved with the pointer and everything
 * else moved when you let go.
 *
 * The fix is not a faster request, it is a different shape of request. FMI's
 * stored queries take a WINDOW, not only an instant, and a whole day of national
 * air temperature at hourly steps is 20–65 kB gzipped — the same class as one of
 * the "instant" requests it replaces, and about a thousandth of what the same
 * day costs asked one instant at a time. So the page fetches the day once and
 * SAMPLES it locally, which makes a scrub cost a binary search per station and
 * nothing else.
 *
 * WHAT A SAMPLE IS ALLOWED TO BE. Everything in here is a value somebody
 * published for a time somebody published it for — this store never averages two
 * readings, never interpolates between them, and never carries a value past
 * `toleranceMs` from the instant asked for. {@link sampleTimeline} returns each
 * station's NEAREST published sample together with that sample's own timestamp,
 * and the callers print that timestamp. Where the day has a hole, the answer is
 * a station missing from the result, which the map draws as nothing.
 *
 * MEASURED AND FORECAST LIVE IN THE SAME SERIES, and the flag rides on the
 * sample rather than on the store. A day that straddles "now" is measured up to
 * this hour and forecast past it — one continuous strip of numbers with the
 * boundary inside it — so a store that was one or the other would have to be
 * split at an instant that moves. On a tie the measurement wins (see
 * {@link mergeReadings}), because a forecast for an hour that has since happened
 * is superseded data, not a second opinion.
 */
import type { FmiReading } from './fmi';

/** One published value for one station at one time. */
export interface Sample {
  at: number;
  value: number;
  /** True when this is a model's prediction rather than an instrument's reading. */
  forecast: boolean;
}

interface StationSeries {
  lon: number;
  lat: number;
  /** Ascending by `at`, one entry per distinct instant. */
  samples: Sample[];
}

/** Every station's series for the window currently loaded. */
export interface Timeline {
  stations: Map<string, StationSeries>;
}

/** What {@link sampleTimeline} answers with: a reading, plus what kind it is. */
export interface TimelineSample {
  lon: number;
  lat: number;
  value: number;
  /** When this value was measured or forecast FOR — never the time asked about. */
  at: number;
  forecast: boolean;
}

export function createTimeline(): Timeline {
  return { stations: new Map() };
}

/**
 * Station identity, as a coordinate string.
 *
 * FMI's `simple` responses carry no station id — only a position — so the
 * position is the only key available, and it is a good one: 189 of the 191
 * stations reporting temperature match the ECMWF forecast collection's
 * coordinates EXACTLY, which is what lets a measured morning and a forecast
 * afternoon land in the same series rather than drawing two ragged sets of
 * labels a few pixels apart. Five decimals is about a metre — finer than any
 * disagreement between two of FMI's own products, coarser than float noise.
 */
function stationKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Insert readings, keeping each station's series sorted and one-per-instant.
 *
 * Mutates in place: the caller holds this in a ref that the draw loop reads at
 * up to 60 Hz, and rebuilding it once per poll would be churn for nothing.
 *
 * A MEASUREMENT REPLACES A FORECAST FOR THE SAME INSTANT, never the reverse.
 * The two sources overlap by design — the forecast run starts at an hour that
 * has usually already been measured — and once an hour has happened, what the
 * model expected of it is not a competing value, it is a stale one.
 */
export function mergeReadings(
  timeline: Timeline,
  readings: FmiReading[],
  forecast = false,
): Timeline {
  for (const r of readings) {
    const key = stationKey(r.lat, r.lon);
    let series = timeline.stations.get(key);
    if (!series) {
      series = { lon: r.lon, lat: r.lat, samples: [] };
      timeline.stations.set(key, series);
    }

    const list = series.samples;
    // The insertion point: the first sample at or after this one.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].at < r.at) lo = mid + 1;
      else hi = mid;
    }
    const existing = list[lo];
    if (existing && existing.at === r.at) {
      if (existing.forecast && !forecast) {
        existing.value = r.value;
        existing.forecast = false;
      }
      continue;
    }
    list.splice(lo, 0, { at: r.at, value: r.value, forecast });
  }
  return timeline;
}

/** Drop everything. Used when the clock moves to a different day. */
export function clearTimeline(timeline: Timeline): Timeline {
  timeline.stations.clear();
  return timeline;
}

/**
 * Every station's nearest published value to `at`, within `toleranceMs`.
 *
 * This is the hot path — it runs inside the draw loop, once per repaint, for a
 * couple of hundred stations — so it is a binary search per station over an
 * array of at most a day's samples, and it allocates one object per station that
 * actually has an answer rather than one per station.
 *
 * The tolerance is the honesty knob, and it belongs to the CALLER because it is a
 * property of the source: air temperature is published every ten minutes and
 * interpolates smoothly, the air quality index is a whole hour's average and
 * says nothing about the hour either side. Beyond it a station simply does not
 * appear, which the map draws as absence rather than as a stale number under a
 * clock it does not belong to.
 */
export function sampleTimeline(
  timeline: Timeline,
  at: number,
  toleranceMs: number,
): TimelineSample[] {
  const out: TimelineSample[] = [];
  for (const series of timeline.stations.values()) {
    const list = series.samples;
    if (list.length === 0) continue;

    let lo = 0;
    let hi = list.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].at < at) lo = mid + 1;
      else hi = mid;
    }

    // Walk outwards from the insertion point, nearest first, keeping the best
    // of each kind. Bounded by the tolerance rather than by the array, so it
    // touches the handful of samples around the clock and stops.
    let measured: Sample | null = null;
    let predicted: Sample | null = null;
    let left = at <= list[lo].at ? lo - 1 : lo;
    let right = left + 1;
    for (;;) {
      const l = left >= 0 ? list[left] : null;
      const r = right < list.length ? list[right] : null;
      if (!l && !r) break;
      // Ties go to the EARLIER sample: at the midpoint between two hourly values
      // the past one has happened and the future one has not.
      const takeLeft = l !== null && (r === null || at - l.at <= r.at - at);
      const next = takeLeft ? l! : r!;
      if (takeLeft) left--;
      else right++;
      if (Math.abs(next.at - at) > toleranceMs) break;
      if (next.forecast) predicted ??= next;
      else measured ??= next;
      if (measured) break;
    }

    // A MEASUREMENT BEATS A FORECAST OUTRIGHT, not merely when it is nearer.
    // Near the top of the hour the forecast run's next step can sit a couple of
    // minutes away while the last actual reading is eight minutes old, and
    // taking the nearer of the two would put a model's number on a page called
    // /live/ with a station under it. Within tolerance an instrument's reading
    // is always the better answer; past it there is nothing measured to prefer,
    // which is exactly where the forecast is supposed to take over.
    const best = measured ?? predicted;
    if (!best) continue;

    out.push({
      lon: series.lon,
      lat: series.lat,
      value: best.value,
      at: best.at,
      forecast: best.forecast,
    });
  }
  return out;
}

/** The span the loaded samples actually cover, or null while empty. */
export function timelineRange(timeline: Timeline): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const series of timeline.stations.values()) {
    const list = series.samples;
    if (list.length === 0) continue;
    if (list[0].at < from) from = list[0].at;
    if (list[list.length - 1].at > to) to = list[list.length - 1].at;
  }
  return from <= to ? { from, to } : null;
}
