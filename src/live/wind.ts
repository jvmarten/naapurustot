/**
 * Live surface wind for /live/, from the Finnish Meteorological Institute.
 *
 * Source: the same FMI open-data WFS the temperature and air-quality feeds read
 * (`fmi::observations::weather::simple`, CC BY 4.0, no API key), and the same
 * traps — latitude-first coordinates, `NaN` as a published value, an empty
 * element that parses into a confident zero, a `<parsererror>` that does not
 * throw. Those live in ./fmi.ts, and the URL builders here reuse them; the ONE
 * thing this file cannot borrow is the parse, and the reason is the whole
 * character of the feed.
 *
 * WIND IS TWO NUMBERS THAT MUST COME FROM ONE MEASUREMENT. A station reports a
 * mean speed (`ws_10min`), the direction that speed is blowing FROM
 * (`wd_10min`) and a gust (`wg_10min`) — and an arrow drawn from the speed of
 * 12:00 and the direction of 11:50 is a measurement nobody took, which is this
 * project's one unforgivable statement (see the /live/ invariants in CLAUDE.md).
 * fmi.ts collapses a response to one scalar per station and cannot express that
 * pairing, so the parse here reads `ParameterName` — which the scalar reader
 * ignores because a single-parameter request only ever carries one — and groups
 * the three parameters by station AND instant before it will emit a reading.
 *
 * ARCHIVE, NOT FORECAST. The temperature layer carries past "now" on ECMWF's
 * forecast at the same stations; wind stops at the present and goes dark ahead
 * of it, exactly as air quality does, because a measured wind field and a
 * modelled one are different claims and this first version makes only the one it
 * can measure. The registry says `archive` and the readout says so in words.
 */
import { fmiSeriesUrl, fmiSimpleUrl } from './fmi';

/** Below this speed a direction is noise, so the map draws a calm dot instead. */
export const WIND_CALM_MS = 0.5;

/**
 * How far a sample may sit from the clock before a station simply is not drawn.
 *
 * The same 45 minutes the temperature layer uses, and for the same reason: wind
 * is published on the stations' ten-minute cycle, so a reading within
 * three-quarters of an hour is the one that belongs under the playhead, and past
 * that the honest answer is absence rather than a stale arrow under a clock it
 * does not belong to.
 */
export const WIND_TOLERANCE_MS = 45 * 60_000;

/** One station's wind at one instant — the three parameters, paired. */
export interface WindReading {
  lon: number;
  lat: number;
  /** When it was measured, ms since the epoch. */
  at: number;
  /** 10-minute mean wind speed, m/s. */
  speed: number;
  /**
   * The direction the wind blows FROM, degrees clockwise from north.
   *
   * Null when the station did not report it, or when it did but the speed is
   * below {@link WIND_CALM_MS} and a bearing would be reading meaning into
   * noise. Zero is a real value (due north), so the absence is a null and never
   * a zero.
   */
  dir: number | null;
  /** 10-minute maximum gust, m/s; null when not reported. */
  gust: number | null;
}

const STORED_QUERY = 'fmi::observations::weather::simple';
const WS = 'ws_10min';
const WD = 'wd_10min';
const WG = 'wg_10min';
/** All three at once — FMI reports them on the same time axis, station by station. */
const PARAMETERS = `${WS},${WD},${WG}`;

/**
 * How far back a live request looks. Long enough that a station on a ten-minute
 * cycle is certainly in the window even if its last report just missed the edge.
 */
const WINDOW_MINUTES = 20;

/** How often the live feed re-asks. Stations publish every ten minutes. */
export const WIND_POLL_MS = 300_000;

/** How coarsely a day is loaded. Hourly is a thinning of real readings, not an average. */
export const SERIES_STEP_MINUTES = 60;

interface Accumulator {
  lon: number;
  lat: number;
  at: number;
  ws?: number;
  wd?: number;
  wg?: number;
}

/**
 * Parse a multi-parameter `simple` response into EVERY paired reading it holds.
 *
 * The three parameters arrive as separate `BsWfsElement`s that share a position
 * and a time, so they are grouped by (station, instant) and a reading is emitted
 * only once a speed is present — a direction without a speed is not an arrow.
 * Every rejection fmi.ts makes is made here too, per parameter rather than per
 * element: an empty or `NaN` gust drops the gust, not the whole reading.
 */
export function parseWindReadings(xml: string): WindReading[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('FMI wind: response was not parseable XML');
  }

  const elements = doc.getElementsByTagNameNS('*', 'BsWfsElement');
  if (elements.length === 0 && doc.getElementsByTagNameNS('*', 'FeatureCollection').length === 0) {
    throw new Error('FMI wind: not a WFS FeatureCollection');
  }

  const groups = new Map<string, Accumulator>();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const posText = el.getElementsByTagNameNS('*', 'pos')[0]?.textContent?.trim();
    if (!posText) continue;
    // LATITUDE FIRST — see the note at the top of ./fmi.ts.
    const [latText, lonText] = posText.split(/\s+/);
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const timeText = el.getElementsByTagNameNS('*', 'Time')[0]?.textContent?.trim();
    const at = timeText ? Date.parse(timeText) : NaN;
    if (!Number.isFinite(at)) continue;

    const name = el.getElementsByTagNameNS('*', 'ParameterName')[0]?.textContent?.trim();
    if (!name) continue;
    const valueText = el.getElementsByTagNameNS('*', 'ParameterValue')[0]?.textContent?.trim();
    // Not redundant with the finite check below: `Number('')` is 0, not NaN, and
    // a wind of exactly 0 from an empty element is a fabricated calm.
    if (!valueText) continue;
    const value = Number(valueText);
    // `NaN` is a value FMI sends for a station that is present but not reporting.
    if (!Number.isFinite(value)) continue;

    const key = `${lat.toFixed(5)},${lon.toFixed(5)},${at}`;
    let g = groups.get(key);
    if (!g) {
      g = { lon, lat, at };
      groups.set(key, g);
    }
    if (name === WS) g.ws = value;
    else if (name === WD) g.wd = value;
    else if (name === WG) g.wg = value;
  }

  const out: WindReading[] = [];
  for (const g of groups.values()) {
    if (g.ws === undefined) continue;
    const calm = g.ws < WIND_CALM_MS;
    out.push({
      lon: g.lon,
      lat: g.lat,
      at: g.at,
      speed: g.ws,
      dir: calm || g.wd === undefined ? null : g.wd,
      gust: g.wg ?? null,
    });
  }
  return out;
}

/** The newest paired reading per station, from a parsed strip. */
export function newestWindPerStation(readings: WindReading[]): WindReading[] {
  const byStation = new Map<string, WindReading>();
  for (const r of readings) {
    const key = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
    const prev = byStation.get(key);
    if (!prev || r.at > prev.at) byStation.set(key, r);
  }
  return [...byStation.values()];
}

/** Parse a response into one paired reading per station, the newest. */
export function parseWind(xml: string): WindReading[] {
  return newestWindPerStation(parseWindReadings(xml));
}

/** The live/archive request URL for a given instant. Exported so a test can read it. */
export function windUrl(at: number, bounded = false): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETERS, at, WINDOW_MINUTES, bounded);
}

/** The window request URL for a day. Exported so a test can read it. */
export function windSeriesUrl(fromMs: number, toMs: number): string {
  return fmiSeriesUrl(STORED_QUERY, PARAMETERS, fromMs, toMs, SERIES_STEP_MINUTES);
}

/**
 * Wind at every reporting station in Finland, now or at a past instant.
 *
 * `at` null is the live case — the window ends wherever FMI's own clock is, the
 * only clock in the exchange that is definitely right (see ./fmi.ts). A number
 * is a scrub: the archive answers what the stations measured then.
 *
 * Throws rather than returning an empty list on a bad response: "no station is
 * reporting" and "we could not ask" are different facts and only the first may
 * be drawn as an empty map.
 */
export async function fetchWind(
  signal?: AbortSignal,
  at: number | null = null,
): Promise<WindReading[]> {
  const res = await fetch(windUrl(at ?? Date.now(), at !== null), { signal });
  if (!res.ok) throw new Error(`FMI wind responded ${res.status}`);
  return parseWind(await res.text());
}

/**
 * A whole day of national wind in one request, for the time slider to sample
 * locally. See ./timeline.ts on why the day is a window rather than an instant;
 * this returns every reading, ungrouped, for {@link mergeWind} to insert.
 */
export async function fetchWindSeries(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<WindReading[]> {
  const res = await fetch(windSeriesUrl(fromMs, toMs), { signal });
  if (!res.ok) throw new Error(`FMI wind responded ${res.status}`);
  return parseWindReadings(await res.text());
}

/* --------------------------------------------------------- the day, sampled */

/**
 * Wind's own timeline, kept apart from the scalar one in ./timeline.ts.
 *
 * That store carries a single `value` per station and instant and a
 * measured/forecast flag; a wind sample is a speed AND a direction AND a gust,
 * and they have to be sampled together or the arrow is a fabrication (see the
 * file header). Rather than generalise the hot, well-pinned scalar store, wind
 * keeps a compact parallel one that never has to prefer a measurement over a
 * forecast — because it has no forecast half — so the nearest sample within
 * tolerance is the whole of the logic.
 */
export interface WindSample {
  at: number;
  speed: number;
  dir: number | null;
  gust: number | null;
}

interface WindStationSeries {
  lon: number;
  lat: number;
  /** Ascending by `at`, one entry per distinct instant. */
  samples: WindSample[];
}

export interface WindTimeline {
  stations: Map<string, WindStationSeries>;
}

/** What {@link sampleWindTimeline} answers with. */
export interface WindTimelineSample {
  lon: number;
  lat: number;
  /** When this value was measured FOR — never the time asked about. */
  at: number;
  speed: number;
  dir: number | null;
  gust: number | null;
}

export function createWindTimeline(): WindTimeline {
  return { stations: new Map() };
}

/** Drop everything. Used when the clock moves to a different day. */
export function clearWindTimeline(timeline: WindTimeline): WindTimeline {
  timeline.stations.clear();
  return timeline;
}

function stationKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Insert readings, keeping each station's series sorted and one-per-instant.
 *
 * Mutates in place — the caller holds this in a ref the draw loop reads at up to
 * 60 Hz. A reading landing on an instant already present just restates it (every
 * value here is measured, so a re-fetch of the same instant is identical data).
 */
export function mergeWind(timeline: WindTimeline, readings: WindReading[]): WindTimeline {
  for (const r of readings) {
    const key = stationKey(r.lat, r.lon);
    let series = timeline.stations.get(key);
    if (!series) {
      series = { lon: r.lon, lat: r.lat, samples: [] };
      timeline.stations.set(key, series);
    }

    const list = series.samples;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].at < r.at) lo = mid + 1;
      else hi = mid;
    }
    const existing = list[lo];
    if (existing && existing.at === r.at) {
      existing.speed = r.speed;
      existing.dir = r.dir;
      existing.gust = r.gust;
      continue;
    }
    list.splice(lo, 0, { at: r.at, speed: r.speed, dir: r.dir, gust: r.gust });
  }
  return timeline;
}

/**
 * Every station's nearest published wind to `at`, within `toleranceMs`.
 *
 * The hot path — a binary search per station over at most a day of samples, then
 * a look at the neighbour on either side of the insertion point. Nothing is
 * averaged or interpolated; a tie goes to the earlier sample, as everywhere on
 * this page, because at the midpoint between two readings the past one has
 * happened and the future one has not. Beyond the tolerance a station simply
 * does not appear.
 */
export function sampleWindTimeline(
  timeline: WindTimeline,
  at: number,
  toleranceMs: number,
): WindTimelineSample[] {
  const out: WindTimelineSample[] = [];
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

    let best = list[lo];
    // The neighbour before the insertion point can be nearer; on a tie it wins,
    // being the earlier of the two.
    if (lo > 0 && Math.abs(list[lo - 1].at - at) <= Math.abs(best.at - at)) {
      best = list[lo - 1];
    }
    if (Math.abs(best.at - at) > toleranceMs) continue;

    out.push({
      lon: series.lon,
      lat: series.lat,
      at: best.at,
      speed: best.speed,
      dir: best.dir,
      gust: best.gust,
    });
  }
  return out;
}

/**
 * The eight-point compass key for a FROM-direction, or `variable` when there is
 * no meaningful bearing (calm, or unreported). Meteorological convention: the
 * direction names where the wind comes from, which is what the panel prints.
 */
const COMPASS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export function windCompassKey(dir: number | null): string {
  if (dir === null) return 'live.wind.dir.variable';
  const i = Math.round((((dir % 360) + 360) % 360) / 45) % 8;
  return `live.wind.dir.${COMPASS[i]}`;
}
