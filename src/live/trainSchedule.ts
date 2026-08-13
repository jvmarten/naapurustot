/**
 * Where the trains were, and will be, on a day the page never watched.
 *
 * The national position feed (trains.ts) publishes the LATEST fix per train and
 * nothing else, so the page's own past reaches exactly as far as this session
 * happened to be open — an hour at best, nothing at all on a fresh tab — and its
 * future reaches nowhere. Scrub outside that and the train layer went dark. That
 * is honest, and it is also most of the slider unusable.
 *
 * What fills it is not a guess about the missing hours. It is Fintraffic's OWN
 * PUBLISHED TIMETABLE for the day: `/api/v1/trains/{date}`, every train's full
 * list of traffic-control points, each with a scheduled time and — for points
 * the train has already passed — the time it actually passed. Resolved through
 * the station register's coordinates that is a sequence of PLACES AND TIMES per
 * train, which is a route through the day. A position between two of them is
 * linear interpolation along it.
 *
 * SO THIS DRAWS SOMETHING NOBODY MEASURED, and the page's standing rule is that
 * it must not. The rule is intact, and the line it draws is this: the numbers
 * are the publisher's, the arithmetic is ours, and the result is never dressed
 * as a measurement.
 *
 *   - A schedule-derived train is drawn as a DIAMOND, never the measured feed's
 *     filled dot, at every zoom and with no exception.
 *   - The honesty strip says the positions came from the timetable, and the
 *     detail panel names the two points being interpolated between and states
 *     whether their times are measured passings or the plan.
 *   - Where a measurement exists it wins outright. The layer is the recorded
 *     snapshot inside the session's window, and this only outside it.
 *
 * HOW WRONG THE INTERPOLATION CAN BE, measured rather than assumed. Timetable
 * rows are not just the stops: train 1 has 140 rows and 24 commercial stops, the
 * rest being junctions, loops and signal points. Across a whole day's 1,816
 * trains the median gap between consecutive points is 1.9 km, p90 is 11 km and
 * the longest is 44 km. So on most of the network a straight line between two
 * points is within a few hundred metres of the track, and on the long northern
 * legs it is not — which is the honest reason the mark is a diamond rather than
 * a dot, and why the panel prints the segment.
 *
 * WHAT IT COSTS. 638 kB gzipped for a day, which is why it is not fetched until
 * somebody actually scrubs to a moment the recording cannot answer, is cached
 * per date, and is never fetched at all while the clock is live. In exchange the
 * whole day becomes scrubbable at zero further cost: positions at an instant are
 * a binary search per train, which is what lets this layer follow the slider as
 * smoothly as the shadows do.
 */
import { isoDate } from './timeControl';
import { fetchStations, type RailStation } from './trainDetail';
import type { Train } from './trains';

/** Fintraffic asks every caller to identify itself. See trains.ts. */
const DIGITRAFFIC_USER = 'naapurustot.fi/live';

/** One point on a train's day: a place, a time, and how the time is known. */
export interface SchedulePoint {
  at: number;
  lon: number;
  lat: number;
  /** True when Fintraffic reported the train ACTUALLY passing here. */
  actual: boolean;
  /** Traffic-control point code, so the panel can name the segment. */
  code: string;
}

export interface TrainSchedule {
  number: number;
  date: string;
  /** e.g. `IC`, `S`, `HL` — Fintraffic's own code. */
  type: string | null;
  /** e.g. `Long-distance`, `Commuter`, `Cargo`. Fintraffic's own wording. */
  category: string | null;
  cancelled: boolean;
  /** Ascending by time, at least two entries. */
  points: SchedulePoint[];
}

/**
 * A position derived from a timetable — a {@link Train} the map can draw, plus
 * everything needed to say out loud that it is not a fix.
 */
export interface ScheduledTrain extends Train {
  /** Always true. Present so a drawing routine cannot forget to check. */
  scheduled: true;
  /**
   * True when BOTH bracketing points carry a measured passing time.
   *
   * The difference matters and the panel prints it: between two points the train
   * has demonstrably passed, the interpolation is bounded by measurements at
   * both ends, and its only error is the shape of the track. Between two planned
   * times it is a picture of the plan.
   */
  fromActual: boolean;
  /** The two control points being interpolated between. */
  fromCode: string;
  toCode: string;
}

const RAIL = 'https://rata.digitraffic.fi/api/v1';

interface RawRow {
  stationShortCode?: unknown;
  scheduledTime?: unknown;
  actualTime?: unknown;
  liveEstimateTime?: unknown;
}

interface RawTrain {
  trainNumber?: unknown;
  departureDate?: unknown;
  trainType?: unknown;
  trainCategory?: unknown;
  cancelled?: unknown;
  timeTableRows?: unknown;
}

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Turn a day's timetables into routes through the day.
 *
 * WHICH TIME EACH POINT GETS, in order: the ACTUAL passing time if the train has
 * been there, then Fintraffic's own live estimate if it has published one, then
 * the scheduled time. That order is what makes a scrub back through this morning
 * show where the trains really were rather than where they were meant to be —
 * and it is also why a delayed train's position is right rather than optimistic.
 * Only the first of the three is flagged `actual`.
 *
 * Rows whose station is absent from the register, or carries no usable
 * coordinate, are dropped: a control point we cannot place cannot anchor an
 * interpolation, and guessing one from its neighbours would put a train in a
 * lake. A train left with fewer than two placeable points is dropped entirely.
 *
 * Exported for tests, which is where the ordering rule above is pinned.
 */
export function parseSchedules(
  payload: unknown,
  stations: Map<string, RailStation>,
): TrainSchedule[] {
  if (!Array.isArray(payload)) throw new Error('train timetables: expected an array');

  const out: TrainSchedule[] = [];
  for (const raw of payload as RawTrain[]) {
    const number = typeof raw?.trainNumber === 'number' ? raw.trainNumber : null;
    const date = str(raw?.departureDate);
    if (number === null || date === null || !Array.isArray(raw.timeTableRows)) continue;

    const points: SchedulePoint[] = [];
    for (const row of raw.timeTableRows as RawRow[]) {
      const code = str(row?.stationShortCode);
      if (!code) continue;
      const station = stations.get(code);
      if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) continue;

      const actual = ms(row.actualTime);
      const at = actual ?? ms(row.liveEstimateTime) ?? ms(row.scheduledTime);
      if (at === null) continue;

      const prev = points[points.length - 1];
      // Two rows at the same point and the same instant (an arrival and a
      // departure with no dwell) are one point; a real dwell keeps both, which
      // is what holds a stopped train at its platform instead of gliding it on.
      if (prev && prev.code === code && prev.at === at) continue;
      // A live estimate can be earlier than the scheduled time of the row before
      // it. Left alone that inverts a segment and the train runs backwards
      // through it; clamping keeps the route monotonic without moving anything
      // to a place it was not published at.
      points.push({
        at: prev && at < prev.at ? prev.at : at,
        lon: station.lon,
        lat: station.lat,
        actual: actual !== null,
        code,
      });
    }

    if (points.length < 2) continue;
    out.push({
      number,
      date,
      type: str(raw.trainType),
      category: str(raw.trainCategory),
      cancelled: raw.cancelled === true,
      points,
    });
  }
  return out;
}

/**
 * A day's timetables, fetched once per date and kept.
 *
 * Two dates at most, because that is the most the clock can need at once (see
 * {@link datesCovering}) and each is a 638 kB payload that there is no reason to
 * hold three of. A failure clears its own entry so the next scrub retries rather
 * than inheriting one bad network moment for the session.
 */
const dayCache = new Map<string, Promise<TrainSchedule[]>>();

export function fetchDaySchedules(date: string, signal?: AbortSignal): Promise<TrainSchedule[]> {
  const cached = dayCache.get(date);
  if (cached) return cached;

  // Deliberately NOT given the caller's signal: the promise is shared with every
  // later caller for this date, so one component unmounting must not cancel it
  // out from under the next. The caller drops the result instead.
  void signal;
  const pending = Promise.all([
    fetch(`${RAIL}/trains/${date}`, { headers: { 'Digitraffic-User': DIGITRAFFIC_USER } }).then(
      (res) => {
        if (!res.ok) throw new Error(`rata /trains/${date} responded ${res.status}`);
        return res.json();
      },
    ),
    fetchStations(),
  ])
    .then(([payload, stations]) => parseSchedules(payload, stations))
    .catch((err: unknown) => {
      dayCache.delete(date);
      throw err;
    });

  if (dayCache.size >= 2) dayCache.delete(dayCache.keys().next().value as string);
  dayCache.set(date, pending);
  return pending;
}

/** TEST ONLY: forget every cached day. */
export function clearScheduleCache(): void {
  dayCache.clear();
}

/**
 * How far into a day a train that departed the PREVIOUS day may still be running.
 *
 * Digitraffic keys a day's timetables on the DEPARTURE date, so the trains
 * running at 04:00 are mostly filed under yesterday. Twelve hours covers the
 * longest overnight services — Helsinki to Kolari leaves in the evening and
 * arrives around midday — while keeping an afternoon scrub to one 638 kB day
 * instead of two.
 */
export const OVERNIGHT_REACH_HOURS = 12;

/**
 * The departure dates whose timetables can contain a train running at `at`.
 *
 * Local dates, because that is what the API's `{date}` path segment means and
 * what the page's clock is expressed in.
 */
export function datesCovering(at: Date): string[] {
  const dates = [isoDate(at)];
  if (at.getHours() < OVERNIGHT_REACH_HOURS) {
    const yesterday = new Date(at);
    yesterday.setDate(yesterday.getDate() - 1);
    dates.push(isoDate(yesterday));
  }
  return dates;
}

/**
 * Every train that is somewhere on its route at `at`, placed.
 *
 * Trains whose day has not started or has finished are simply absent — the
 * bracket search returns nothing outside `points[0].at .. points[n-1].at`, which
 * is the correct answer for a train that is not running rather than a reason to
 * pin it to an endpoint.
 *
 * Cancelled trains are dropped: their timetable is still published, and drawing
 * it would put a train on the map that Fintraffic has said is not running.
 *
 * Runs inside the draw loop over ~1,800 trains, so it is a binary search each
 * and no allocation for the ones that are not out.
 */
export function scheduledPositions(schedules: TrainSchedule[], at: number): ScheduledTrain[] {
  const out: ScheduledTrain[] = [];
  for (const schedule of schedules) {
    if (schedule.cancelled) continue;
    const points = schedule.points;
    if (at < points[0].at || at > points[points.length - 1].at) continue;

    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].at < at) lo = mid + 1;
      else hi = mid;
    }
    // `lo` is the first point at or after `at`; the segment is the pair around
    // it. `lo === 0` means `at` is exactly the first point.
    const b = points[lo];
    const a = points[lo === 0 ? 0 : lo - 1];
    const span = b.at - a.at;
    const f = span > 0 ? (at - a.at) / span : 0;

    out.push({
      number: schedule.number,
      date: schedule.date,
      lon: a.lon + (b.lon - a.lon) * f,
      lat: a.lat + (b.lat - a.lat) * f,
      // NOT a speed derived from the segment. Distance over time along a
      // straight line between two control points is not the train's speed, and
      // this feed's own rule is that a number on screen is one somebody
      // published.
      speed: null,
      at,
      scheduled: true,
      fromActual: a.actual && b.actual,
      fromCode: a.code,
      toCode: b.code,
    });
  }
  return out;
}
