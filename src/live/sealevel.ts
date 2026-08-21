/**
 * Live Baltic sea level for /live/, from the Finnish Meteorological Institute.
 *
 * Source: the same FMI open-data WFS every other FMI feed here reads
 * (`fmi::observations::mareograph::simple`, CC BY 4.0, no API key), and the same
 * traps — latitude-first coordinates, `NaN` as a published value, an empty
 * element that parses into a confident zero, a `<parsererror>` that does not
 * throw. Those live in ./fmi.ts; the ONE thing this file cannot borrow is the
 * parse, for the same reason wind.ts cannot, and it is the whole character of the
 * feed.
 *
 * SEA LEVEL IS A NUMBER, BUT IT COMES WITH TWO OTHERS FROM ONE GAUGE. FMI's
 * fourteen tide gauges — the Gulf of Finland to Kemi in the north of the
 * Bothnian Bay — each report water level three ways in one response: `WATLEV`,
 * the height above the location's theoretical mean sea level (the anomaly a
 * reader means by "is the sea high or low right now"); `WLEVN2K_PT1S_INSTANT`,
 * the same surface in the N2000 geodetic height system; and `TW_PT1H_AVG`, the
 * hourly-mean sea-water temperature. They arrive as separate `BsWfsElement`s
 * sharing a position and a time, so — exactly as wind.ts pairs speed and
 * direction — they are grouped by (station, instant) and a reading is emitted
 * only once the water level is present. A temperature without a level is not a
 * sea-level mark, and a level from one hour beside a temperature from another is
 * a measurement nobody took.
 *
 * WHAT WATLEV IS, PRECISELY, because the map draws it as a signed anomaly and the
 * project's rule is that nothing is shown that a publisher did not publish. FMI
 * confirms the parameter as "Water level" in millimetres, referenced to the
 * theoretical mean water at that gauge — so 0 is normal, positive is higher than
 * normal (a surge), negative is lower. The map states the SIGN and the panel
 * states the reference in words; nothing here computes a mean or an anomaly of
 * its own. The N2000 figure and the temperature are carried into the panel only.
 *
 * ARCHIVE, NOT FORECAST. FMI publishes a sea-level forecast, but this first
 * version measures rather than models: the same stored query serves the archive
 * on request, so scrubbing back shows what the gauges recorded, and past "now"
 * the layer goes dark and the readout says so — exactly as wind and air quality
 * do. The registry says `archive`.
 *
 * COASTAL, NOT NATIONAL. Fourteen gauges on the coast is the whole network there
 * is; the interior has no sea to measure. The registry says `coastal`, a coverage
 * the sidebar prints honestly rather than borrowing "cities only" from a land
 * feed.
 */
import { fmiSeriesUrl, fmiSimpleUrl } from './fmi';

/**
 * How far a sample may sit from the clock before a gauge is simply not drawn.
 *
 * The gauges report HOURLY (verified: one reading on each hour, moving a few cm
 * across five hours), so an hour's tolerance keeps every instant within reach of
 * the reading on one side or the other without ever carrying a value more than
 * one publishing step from the clock it is drawn under. Past it the honest answer
 * is absence, not a stale number under a clock it does not belong to.
 */
export const SEALEVEL_TOLERANCE_MS = 60 * 60_000;

/** One gauge's reading at one instant — the three parameters, paired. */
export interface SealevelReading {
  lon: number;
  lat: number;
  /** When it was measured, ms since the epoch. */
  at: number;
  /** Water level above theoretical mean sea level, in millimetres (signed). */
  level: number;
  /** Water level in the N2000 height system, in millimetres; null when not reported. */
  n2000: number | null;
  /** Sea-water temperature, hourly mean, in °C; null when not reported. */
  temp: number | null;
}

const STORED_QUERY = 'fmi::observations::mareograph::simple';
/** Height above theoretical mean water, mm — the value the map draws. */
const WATLEV = 'WATLEV';
/** Height in the N2000 geodetic system, mm — panel only. */
const N2000 = 'WLEVN2K_PT1S_INSTANT';
/** Sea-water temperature, hourly mean, °C — panel only. */
const TWATER = 'TW_PT1H_AVG';
/** All three at once — FMI reports them on the same time axis, gauge by gauge. */
const PARAMETERS = `${WATLEV},${N2000},${TWATER}`;

/**
 * How far back a live request looks.
 *
 * The gauges report hourly, so a look-back shorter than an hour can land entirely
 * BETWEEN a gauge's last reading and the request time and come back empty — the
 * specific failure that does not happen with the ten-minute station feeds. Ninety
 * minutes guarantees the most recent hourly reading is inside the window whatever
 * minute the poll fires on.
 */
const WINDOW_MINUTES = 90;

/** How often the live feed re-asks. The gauges publish hourly; ten minutes lands the new value promptly without re-downloading it a dozen times an hour. */
export const SEALEVEL_POLL_MS = 600_000;

/** How coarsely a day is loaded. The readings are already hourly, so this is a pass-through, not a thinning. */
export const SERIES_STEP_MINUTES = 60;

interface Accumulator {
  lon: number;
  lat: number;
  at: number;
  level?: number;
  n2000?: number;
  temp?: number;
}

/**
 * Parse a multi-parameter `simple` response into EVERY paired reading it holds.
 *
 * The three parameters arrive as separate `BsWfsElement`s that share a position
 * and a time, so they are grouped by (station, instant) and a reading is emitted
 * only once the water level is present — the level is what the map draws, and the
 * other two are optional extras for the panel. Every rejection fmi.ts makes is
 * made here too, per parameter: an empty or `NaN` temperature drops the
 * temperature, not the whole reading.
 */
export function parseSealevelReadings(xml: string): SealevelReading[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('FMI sea level: response was not parseable XML');
  }

  const elements = doc.getElementsByTagNameNS('*', 'BsWfsElement');
  if (elements.length === 0 && doc.getElementsByTagNameNS('*', 'FeatureCollection').length === 0) {
    throw new Error('FMI sea level: not a WFS FeatureCollection');
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
    // a sea level of exactly 0 from an empty element is a fabricated "normal".
    if (!valueText) continue;
    const value = Number(valueText);
    // `NaN` is a value FMI sends for a gauge that is present but not reporting.
    if (!Number.isFinite(value)) continue;

    const key = `${lat.toFixed(5)},${lon.toFixed(5)},${at}`;
    let g = groups.get(key);
    if (!g) {
      g = { lon, lat, at };
      groups.set(key, g);
    }
    if (name === WATLEV) g.level = value;
    else if (name === N2000) g.n2000 = value;
    else if (name === TWATER) g.temp = value;
  }

  const out: SealevelReading[] = [];
  for (const g of groups.values()) {
    if (g.level === undefined) continue;
    out.push({
      lon: g.lon,
      lat: g.lat,
      at: g.at,
      level: g.level,
      n2000: g.n2000 ?? null,
      temp: g.temp ?? null,
    });
  }
  return out;
}

/** The newest paired reading per gauge, from a parsed strip. */
export function newestSealevelPerStation(readings: SealevelReading[]): SealevelReading[] {
  const byStation = new Map<string, SealevelReading>();
  for (const r of readings) {
    const key = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
    const prev = byStation.get(key);
    if (!prev || r.at > prev.at) byStation.set(key, r);
  }
  return [...byStation.values()];
}

/** Parse a response into one paired reading per gauge, the newest. */
export function parseSealevel(xml: string): SealevelReading[] {
  return newestSealevelPerStation(parseSealevelReadings(xml));
}

/** The live/archive request URL for a given instant. Exported so a test can read it. */
export function sealevelUrl(at: number, bounded = false): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETERS, at, WINDOW_MINUTES, bounded);
}

/** The window request URL for a day. Exported so a test can read it. */
export function sealevelSeriesUrl(fromMs: number, toMs: number): string {
  return fmiSeriesUrl(STORED_QUERY, PARAMETERS, fromMs, toMs, SERIES_STEP_MINUTES);
}

/**
 * Sea level at every reporting gauge, now or at a past instant.
 *
 * `at` null is the live case — the window ends wherever FMI's own clock is, the
 * only clock in the exchange that is definitely right (see ./fmi.ts). A number is
 * a scrub: the archive answers what the gauges measured then.
 *
 * Throws rather than returning an empty list on a bad response: "no gauge is
 * reporting" and "we could not ask" are different facts and only the first may be
 * drawn as an empty map.
 */
export async function fetchSealevel(
  signal?: AbortSignal,
  at: number | null = null,
): Promise<SealevelReading[]> {
  const res = await fetch(sealevelUrl(at ?? Date.now(), at !== null), { signal });
  if (!res.ok) throw new Error(`FMI sea level responded ${res.status}`);
  return parseSealevel(await res.text());
}

/**
 * A whole day of sea level in one request, for the time slider to sample locally.
 * See ./timeline.ts on why the day is a window rather than an instant; this
 * returns every reading, ungrouped, for {@link mergeSealevel} to insert.
 */
export async function fetchSealevelSeries(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<SealevelReading[]> {
  const res = await fetch(sealevelSeriesUrl(fromMs, toMs), { signal });
  if (!res.ok) throw new Error(`FMI sea level responded ${res.status}`);
  return parseSealevelReadings(await res.text());
}

/**
 * The signed anomaly a gauge's water level represents, in whole centimetres.
 *
 * FMI publishes WATLEV in millimetres above theoretical mean water; the map and
 * the panel both want centimetres, and both want the sign in front so a glance
 * reads "higher than normal" or "lower than normal" without a legend. One
 * function so the two never round differently. Uses a real minus sign (U+2212) to
 * match the page's typography.
 */
export function formatSealevelCm(levelMm: number): string {
  const cm = Math.round(levelMm / 10);
  if (cm > 0) return `+${cm}`;
  if (cm < 0) return `−${Math.abs(cm)}`;
  return '0';
}

/* --------------------------------------------------------- the day, sampled */

/**
 * Sea level's own timeline, kept apart from the scalar one in ./timeline.ts, for
 * the reason wind's is: a sample is a level AND an N2000 height AND a temperature,
 * and they have to be sampled from one instant together or the panel pairs a
 * level with a temperature from a different hour. The scalar store carries one
 * value and a measured/forecast flag and cannot express that; this compact
 * parallel store never has a forecast half to prefer, so the nearest sample
 * within tolerance is the whole of the logic.
 */
export interface SealevelSample {
  at: number;
  level: number;
  n2000: number | null;
  temp: number | null;
}

interface SealevelStationSeries {
  lon: number;
  lat: number;
  /** Ascending by `at`, one entry per distinct instant. */
  samples: SealevelSample[];
}

export interface SealevelTimeline {
  stations: Map<string, SealevelStationSeries>;
}

/** What {@link sampleSealevelTimeline} answers with. */
export interface SealevelTimelineSample {
  lon: number;
  lat: number;
  /** When this value was measured FOR — never the time asked about. */
  at: number;
  level: number;
  n2000: number | null;
  temp: number | null;
}

export function createSealevelTimeline(): SealevelTimeline {
  return { stations: new Map() };
}

/** Drop everything. Used when the clock moves to a different day. */
export function clearSealevelTimeline(timeline: SealevelTimeline): SealevelTimeline {
  timeline.stations.clear();
  return timeline;
}

function stationKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Insert readings, keeping each gauge's series sorted and one-per-instant.
 *
 * Mutates in place — the caller holds this in a ref the draw loop reads at up to
 * 60 Hz. A reading landing on an instant already present just restates it (every
 * value here is measured, so a re-fetch of the same instant is identical data).
 */
export function mergeSealevel(
  timeline: SealevelTimeline,
  readings: SealevelReading[],
): SealevelTimeline {
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
      existing.level = r.level;
      existing.n2000 = r.n2000;
      existing.temp = r.temp;
      continue;
    }
    list.splice(lo, 0, { at: r.at, level: r.level, n2000: r.n2000, temp: r.temp });
  }
  return timeline;
}

/**
 * Every gauge's nearest published reading to `at`, within `toleranceMs`.
 *
 * The hot path — a binary search per gauge over at most a day of samples, then a
 * look at the neighbour on either side of the insertion point. Nothing is
 * averaged or interpolated; a tie goes to the earlier sample, as everywhere on
 * this page, because at the midpoint between two readings the past one has
 * happened and the future one has not. Beyond the tolerance a gauge simply does
 * not appear.
 */
export function sampleSealevelTimeline(
  timeline: SealevelTimeline,
  at: number,
  toleranceMs: number,
): SealevelTimelineSample[] {
  const out: SealevelTimelineSample[] = [];
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
      level: best.level,
      n2000: best.n2000,
      temp: best.temp,
    });
  }
  return out;
}
