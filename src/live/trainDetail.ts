/**
 * Everything Digitraffic will tell you about ONE train, fetched when you pick it.
 *
 * The national position feed carries a number, a speed and a timestamp — see the
 * note in trains.ts about why it carries nothing else. That is the right trade
 * for a five-second poll of the whole country, and the wrong one the moment
 * somebody points at a particular dot and asks what it is. So the detail is
 * fetched per train, on demand, and never for the fleet:
 *
 *   /api/v1/trains/{date}/{number}          2.4 kB   type, operator, timetable
 *   /api/v1/train-locations/{date}/{number}  52 kB   every fix it has reported
 *
 * Both are keyed on the DEPARTURE DATE as well as the number, because the number
 * alone repeats daily and an overnight service is still running under yesterday's
 * date at 03:00. That pair is why `Train.date` exists.
 *
 * WHAT THE TRACK IS FOR, BEYOND DRAWING A LINE. It is the one place this page can
 * answer "where was it at 06:40" with a measurement rather than with an
 * interpolation: the fixes are roughly five seconds apart, so a scrub lands on a
 * real reported position. The national feed has no such history (trainHistory.ts
 * explains what the page keeps instead), which is exactly why selecting a train
 * upgrades it from "recorded this session" to "measured all day".
 *
 * THE TIMETABLE IS NOT A POSITION. Scheduled and estimated times say when a train
 * is due at a station; they do not say where it is between two of them, and this
 * file never turns one into the other. A future instant gets the next scheduled
 * stop stated as a stop — which is Fintraffic's own plan — and no dot on a track.
 */

/** Fintraffic asks every caller to identify itself. See trains.ts. */
const DIGITRAFFIC_USER = 'naapurustot.fi/live';

const RAIL = 'https://rata.digitraffic.fi/api/v1';

async function railJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${RAIL}${path}`, {
    signal,
    headers: { 'Digitraffic-User': DIGITRAFFIC_USER },
  });
  if (!res.ok) throw new Error(`rata${path} responded ${res.status}`);
  return res.json();
}

/** One commercial stop on a train's timetable. */
export interface TrainStop {
  /** Station name, resolved through the station register; the code if unknown. */
  name: string;
  code: string;
  /** Scheduled arrival/departure, ms since the epoch. */
  arrival: number | null;
  departure: number | null;
  /**
   * Minutes late at this stop, as Fintraffic reports it.
   *
   * Their number, not a subtraction of ours: they publish `differenceInMinutes`
   * against the working timetable, which is not always the same as the
   * difference between the two timestamps a client can see.
   */
  lateMinutes: number | null;
  /** True once the train has actually been there (an `actualTime` exists). */
  passed: boolean;
  cancelled: boolean;
  /** Platform, when the feed states one. */
  track: string | null;
}

export interface TrainDetail {
  number: number;
  date: string;
  /** e.g. `IC`, `S`, `HL` — Fintraffic's own code. */
  type: string | null;
  /** e.g. `Long-distance`, `Commuter`. Fintraffic's own wording, English. */
  category: string | null;
  /** Commuter line letter (`A`, `P`, `I`…), when the train is one. */
  line: string | null;
  operator: string | null;
  cancelled: boolean;
  stops: TrainStop[];
}

/** One measured position from a train's own history. */
export interface TrainFix {
  at: number;
  lon: number;
  lat: number;
  speed: number | null;
}

/* --------------------------------------------------------------- stations */

/**
 * The station register, fetched once per session and kept.
 *
 * 563 stations, 15 kB gzipped, and it changes about as often as the rail network
 * does — so it is fetched lazily on the first train anyone selects and then
 * reused for the rest of the session. Deliberately NOT bundled: it is data, and
 * this project keeps data out of the JS budget.
 *
 * A failure is not fatal. Without it the panel prints station CODES, which are
 * what Fintraffic publishes and are legible to anyone who reads a Finnish
 * departure board; inventing a name would not be.
 */
let stationPromise: Promise<Map<string, string>> | null = null;

/**
 * Deliberately NOT abortable. The promise is shared by every future caller, so
 * letting the first selection's abort tear it down would fail the panel of
 * whoever else was waiting on it — and cancelling a 15 kB session-wide fetch to
 * save nothing is not a trade worth making.
 */
export function fetchStationNames(): Promise<Map<string, string>> {
  stationPromise ??= railJson('/metadata/stations')
    .then((payload) => {
      const out = new Map<string, string>();
      if (!Array.isArray(payload)) return out;
      for (const s of payload as { stationShortCode?: unknown; stationName?: unknown }[]) {
        if (typeof s?.stationShortCode === 'string' && typeof s?.stationName === 'string') {
          out.set(s.stationShortCode, s.stationName);
        }
      }
      return out;
    })
    .catch((err: unknown) => {
      // A failure clears the cache so the next selection tries again rather than
      // inheriting one bad network moment for the rest of the session.
      stationPromise = null;
      throw err;
    });
  return stationPromise;
}

/* ---------------------------------------------------------------- parsing */

interface RawRow {
  type?: unknown;
  stationShortCode?: unknown;
  scheduledTime?: unknown;
  actualTime?: unknown;
  liveEstimateTime?: unknown;
  differenceInMinutes?: unknown;
  commercialStop?: unknown;
  cancelled?: unknown;
  commercialTrack?: unknown;
}

const ms = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * Fold the timetable's arrival/departure rows into one entry per station.
 *
 * The feed emits a row per event, so a through station appears twice (ARRIVAL
 * then DEPARTURE) and the endpoints once. Merging them is what makes the panel
 * read like a departure board rather than like a log, and it halves the rows.
 *
 * ONLY COMMERCIAL STOPS. Train 1's timetable has 140 rows and 24 commercial ones:
 * the rest are junctions, passing loops and signal points the train does not stop
 * at. Listing those would drown the twelve places a passenger can actually get
 * off in a hundred and sixteen they cannot.
 *
 * Exported for tests — the merge is the part with an edge case in it (a station
 * visited twice by a circular service must not collapse into one entry).
 */
export function parseTimetable(rows: unknown, names: Map<string, string>): TrainStop[] {
  if (!Array.isArray(rows)) return [];
  const out: TrainStop[] = [];
  for (const raw of rows as RawRow[]) {
    if (raw?.commercialStop !== true) continue;
    const code = str(raw.stationShortCode);
    if (!code) continue;

    const time = ms(raw.scheduledTime);
    const isArrival = raw.type === 'ARRIVAL';
    const late = typeof raw.differenceInMinutes === 'number' ? raw.differenceInMinutes : null;
    const passed = ms(raw.actualTime) !== null;

    // The previous entry, but only if this is its DEPARTURE — a service that
    // returns to the same station later in the run gets a second entry, which is
    // why this tests adjacency rather than searching by code.
    const prev = out[out.length - 1];
    if (prev && prev.code === code && !isArrival && prev.departure === null) {
      prev.departure = time;
      prev.passed = prev.passed || passed;
      prev.cancelled = prev.cancelled || raw.cancelled === true;
      if (late !== null) prev.lateMinutes = late;
      prev.track ??= str(raw.commercialTrack);
      continue;
    }

    out.push({
      code,
      name: names.get(code) ?? code,
      arrival: isArrival ? time : null,
      departure: isArrival ? null : time,
      lateMinutes: late,
      passed,
      cancelled: raw.cancelled === true,
      track: str(raw.commercialTrack),
    });
  }
  return out;
}

/**
 * The timetable and identity of one train.
 *
 * Station names are resolved in parallel with the timetable and are optional —
 * a failed register leaves the codes in place rather than failing the panel.
 */
export async function fetchTrainDetail(
  number: number,
  date: string,
  signal?: AbortSignal,
): Promise<TrainDetail> {
  const [payload, names] = await Promise.all([
    railJson(`/trains/${date}/${number}`, signal),
    fetchStationNames().catch(() => new Map<string, string>()),
  ]);
  const train = Array.isArray(payload) ? (payload[0] as Record<string, unknown>) : null;
  if (!train) throw new Error('train detail: empty response');

  return {
    number,
    date,
    type: str(train.trainType),
    category: str(train.trainCategory),
    line: str(train.commuterLineID),
    operator: str(train.operatorShortCode),
    cancelled: train.cancelled === true,
    stops: parseTimetable(train.timeTableRows, names),
  };
}

/**
 * Every position this train has reported today, oldest first.
 *
 * The endpoint answers newest-first; the reversal is not cosmetic, because the
 * lookup below assumes ascending order and drawing the polyline in report order
 * would trace the route backwards (which looks identical, right up to the moment
 * a fix is missing and the line closes the wrong gap).
 */
export function parseTrack(payload: unknown): TrainFix[] {
  if (!Array.isArray(payload)) throw new Error('train track: expected an array');
  const out: TrainFix[] = [];
  for (const raw of payload as {
    location?: { coordinates?: unknown } | null;
    timestamp?: unknown;
    speed?: unknown;
  }[]) {
    const c = raw?.location?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const lon = c[0];
    const lat = c[1];
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
    const at = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;
    if (!Number.isFinite(at)) continue;
    out.push({
      at,
      lon,
      lat,
      speed: typeof raw.speed === 'number' && Number.isFinite(raw.speed) ? raw.speed : null,
    });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

export function fetchTrainTrack(
  number: number,
  date: string,
  signal?: AbortSignal,
): Promise<TrainFix[]> {
  return railJson(`/train-locations/${date}/${number}`, signal).then(parseTrack);
}

/**
 * The fix nearest an instant, or null when none is close enough.
 *
 * NO INTERPOLATION — the invariant this whole page is built on. Fixes arrive
 * about every five seconds while a train is moving, so `toleranceMs` of half a
 * minute resolves any ordinary scrub with a position somebody actually measured,
 * and a gap wider than that (a tunnel, a yard, a train that has not departed)
 * correctly answers "we do not know" instead of drawing a plausible dot.
 */
export function fixAt(track: TrainFix[], at: number, toleranceMs = 30_000): TrainFix | null {
  if (track.length === 0) return null;
  let lo = 0;
  let hi = track.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].at < at) lo = mid + 1;
    else hi = mid;
  }
  const after = track[lo];
  const before = track[lo - 1];
  const best = before && (!after || at - before.at <= after.at - at) ? before : after;
  return Math.abs(best.at - at) <= toleranceMs ? best : null;
}
