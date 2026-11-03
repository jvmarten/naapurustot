/**
 * Live beach water temperature for /live/, from two sensor networks.
 *
 * UIRAS — Forum Virium Helsinki's LoRaWAN thermometers at beaches and piers in
 * Helsinki, Vantaa and Nuuksio, published on Helsinki Region Infoshare as "Veden
 * reaaliaikainen lämpötila Helsingin uimarannoilla", CC BY 4.0, no key, CORS `*`
 * (host iot.fvh.fi, the one HRI registers). `uiras_latest.geojson` is every sensor
 * and its newest reading (~3.4 kB gzipped); each sensor's own file (~19 kB
 * gzipped) carries three series:
 *
 *   raw  the last 7 days, every reading as sent (about every 30 minutes)
 *   h3   the last 30 days, 3-hour means
 *   d1   the last 2 years, daily (UTC) means
 *
 * Those aggregates are the PUBLISHER'S — verified against `raw`: a d1 value is the
 * mean of that UTC day's raw readings, an h3 value the mean of the three hours
 * starting at its stamp — so the chart labels them as means and computes nothing.
 *
 * SENSORIPAJA — the Espoo sea beaches (Westend, Matinkylä, Kivenlahti, …), the
 * network uimaan.sensoripaja.fi and jaaskel.com both draw. `swimespoo/
 * featurecollection.geojson` is every beach's newest reading (3.5 kB), CORS `*`.
 * It is NOT registered as open data anywhere (HRI, avoindata.fi) and states no
 * licence; it is used with attribution by the site owner's decision of 2026-11-03,
 * and every place it is shown names Sensoripaja. Two differences from Uiras that
 * matter: a beach's history file is ONLY raw readings (every 30–60 min, two years
 * of them — 37,501 for Westend) with no aggregates, and the server sends it
 * UNCOMPRESSED, so it costs 0.3–2.7 MB per beach. The panel therefore loads it only
 * when asked (WaterChart), and draws readings rather than means for every span.
 * Ids differ in form across its two sensor generations (`01B2`,
 * `20:6E:F1:E3:87:1C`) and so do its property names (`installation depth` vs
 * `installation_depth`); both are read.
 *
 * 'recorded', NOT 'archive'. Neither latest file keeps a past that can be asked for
 * at an instant, and loading every sensor's history to answer a scrub would be
 * megabytes for a few dozen numbers. So the map shows what this session's polls
 * received, a scrub further back goes dark and says so, and the panel's chart is
 * where the history lives.
 *
 * WHAT IS DROPPED. A sensor with no `measurement` (pulled for the winter, not yet
 * reporting) is not drawn, and an absent or non-finite `temp_water` drops the
 * reading rather than becoming a zero. Uiras's enclosure temperature (`temp_in`) is
 * carried into the panel as published: a probe lifted out of the water still
 * reports, and the enclosure reading is the publisher's own evidence for the
 * reader to weigh — this file does not second-guess it.
 */

const UIRAS = 'https://iot.fvh.fi/opendata/uiras/';
const ESPOO = 'https://api.sensoripaja.fi/swimespoo/';
export const WATER_LATEST_URL = `${UIRAS}uiras_latest.geojson`;
export const ESPOO_LATEST_URL = `${ESPOO}featurecollection.geojson`;

/** Sensors report every 30–60 minutes; the latest files are rebuilt every few. */
export const WATER_POLL_MS = 600_000;

/**
 * How far a reading may sit from the clock before a sensor is simply not drawn.
 *
 * An hour: Espoo's older sensors report hourly and LoRaWAN drops a packet now and
 * then, so a missed half-hour should not blank a beach. Past that, absence.
 */
export const WATER_TOLERANCE_MS = 60 * 60_000;

export type WaterSource = 'uiras' | 'sensoripaja';

/** One sensor's water temperature at one instant. */
export interface WaterReading {
  /** Unique across both networks: Uiras's DevEUI, or `sp:` + Sensoripaja's id. */
  id: string;
  source: WaterSource;
  name: string;
  district: string | null;
  lon: number;
  lat: number;
  /** When it was measured, ms since the epoch. */
  at: number;
  /** Water temperature at the probe, °C, as published. */
  celsius: number;
  /** The device enclosure's own temperature, °C; null when not reported. */
  enclosure: number | null;
  /** Probe depth below the surface in metres (positive), when published. */
  depth: number | null;
  /** The sensor's own history file, or null when there is none to ask for. */
  historyUrl: string | null;
}

/** A Uiras sensor id: a 16-digit hex LoRaWAN DevEUI. */
const UIRAS_ID = /^[0-9A-F]{16}$/;
/** Sensoripaja ids: `01B2`-style hex or a colon-separated MAC. */
const ESPOO_ID = /^[0-9A-F]{2,8}(:[0-9A-F]{2}){0,7}$/i;
/** A beach name safe to put in a path segment — letters, digits and spaces only. */
const SAFE_NAME = /^[\p{L}\p{N} ]{1,80}$/u;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

type Raw = {
  id?: unknown;
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown> & {
    measurement?: { time?: unknown; temp_water?: unknown; temp_in?: unknown };
  };
};

function features(json: unknown, who: string): Raw[] {
  const fc = json as { type?: unknown; features?: unknown };
  if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
    throw new Error(`${who}: not a FeatureCollection`);
  }
  return fc.features as Raw[];
}

/** The shared reading, or null for anything unplaceable or without a value. */
function reading(
  f: Raw,
  id: string,
  source: WaterSource,
  district: string | null,
  historyUrl: string | null,
): WaterReading | null {
  const c = f.geometry?.coordinates;
  const lon = num(c?.[0]);
  const lat = num(c?.[1]);
  if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const p = f.properties ?? {};
  const m = p.measurement;
  const celsius = num(m?.temp_water);
  const at = typeof m?.time === 'string' ? Date.parse(m.time) : NaN;
  if (celsius === null || !Number.isFinite(at)) return null;
  const depth = num(p['installation depth'] ?? p.installation_depth);
  return {
    id,
    source,
    name: str(p.name) ?? id,
    district,
    lon,
    lat,
    at,
    celsius,
    enclosure: num(m?.temp_in),
    depth: depth === null ? null : Math.abs(depth),
    historyUrl,
  };
}

/** Parse `uiras_latest.geojson`. Throws on something that is not a FeatureCollection. */
export function parseWaterLatest(json: unknown): WaterReading[] {
  const out: WaterReading[] = [];
  for (const f of features(json, 'Uiras')) {
    const id = str(f?.id);
    if (!id || !UIRAS_ID.test(id)) continue;
    const r = reading(f, id, 'uiras', str(f.properties?.district), `${UIRAS}${id}.geojson`);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Parse Sensoripaja's Espoo `featurecollection.geojson`.
 *
 * Its history files are named after the beach, so the URL is built from the name —
 * and only from a name of letters, digits and spaces, never anything that could
 * walk out of the directory.
 */
export function parseEspooLatest(json: unknown): WaterReading[] {
  const out: WaterReading[] = [];
  for (const f of features(json, 'Sensoripaja')) {
    const raw = str(f?.id);
    if (!raw || !ESPOO_ID.test(raw)) continue;
    const name = str(f.properties?.name);
    const history = name && SAFE_NAME.test(name) ? `${ESPOO}${encodeURIComponent(name)}.geojson` : null;
    const r = reading(f, `sp:${raw}`, 'sensoripaja', 'Espoo', history);
    if (r) out.push(r);
  }
  return out;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json();
}

/** What one poll of both networks returned. */
export interface WaterPoll {
  readings: WaterReading[];
  /** True when one network answered and the other did not. */
  partial: boolean;
}

/**
 * Every sensor's newest reading, from both networks at once.
 *
 * Rejects only when NEITHER answers: "no sensor is reporting" and "we could not
 * ask" are different facts. One network down is `partial`, which the readout
 * states — a silently missing Espoo would read as Espoo having no beaches.
 */
export async function fetchWaterLatest(signal?: AbortSignal): Promise<WaterPoll> {
  const [uiras, espoo] = await Promise.allSettled([
    getJson(WATER_LATEST_URL, signal).then(parseWaterLatest),
    getJson(ESPOO_LATEST_URL, signal).then(parseEspooLatest),
  ]);
  if (uiras.status === 'rejected' && espoo.status === 'rejected') throw uiras.reason;
  return {
    readings: [
      ...(uiras.status === 'fulfilled' ? uiras.value : []),
      ...(espoo.status === 'fulfilled' ? espoo.value : []),
    ],
    partial: uiras.status === 'rejected' || espoo.status === 'rejected',
  };
}

/* ------------------------------------------------------- what the session saw */

/**
 * Every reading this session's polls received, per sensor, ascending.
 *
 * Mutated in place — the draw loop reads it through a ref. A poll repeats the
 * newest reading until the next one lands, so an instant already held is skipped.
 */
export type WaterTimeline = Map<string, WaterReading[]>;

export function mergeWater(timeline: WaterTimeline, readings: WaterReading[]): void {
  for (const r of readings) {
    let list = timeline.get(r.id);
    if (!list) timeline.set(r.id, (list = []));
    let i = list.length;
    while (i > 0 && list[i - 1].at > r.at) i--;
    if (i > 0 && list[i - 1].at === r.at) continue;
    list.splice(i, 0, r);
  }
}

/**
 * Each sensor's nearest received reading to `at`, within `toleranceMs`.
 *
 * Nothing is interpolated; a tie goes to the earlier reading, as everywhere on
 * this page, because at the midpoint the past one has happened.
 */
export function sampleWater(timeline: WaterTimeline, at: number, toleranceMs: number): WaterReading[] {
  const out: WaterReading[] = [];
  for (const list of timeline.values()) {
    let best: WaterReading | null = null;
    for (const r of list) {
      if (!best || Math.abs(r.at - at) < Math.abs(best.at - at)) best = r;
    }
    if (best && Math.abs(best.at - at) <= toleranceMs) out.push(best);
  }
  return out;
}

/** The span the session has received, or null while empty. */
export function waterRange(timeline: WaterTimeline): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  for (const list of timeline.values()) {
    if (list.length === 0) continue;
    from = Math.min(from, list[0].at);
    to = Math.max(to, list[list.length - 1].at);
  }
  return from <= to ? { from, to } : null;
}

/* ------------------------------------------------------------ one sensor's past */

/** One point of a sensor's published series. */
export interface WaterPoint {
  at: number;
  celsius: number;
}

/**
 * The series a sensor's file carries — see the note at the top. Sensoripaja's
 * files have only `raw` (two years of it), so `h3` and `d1` come back empty there.
 */
export interface WaterHistory {
  raw: WaterPoint[];
  h3: WaterPoint[];
  d1: WaterPoint[];
}

/** Uiras's history URL for a sensor id. Null for anything that is not one. */
export function waterHistoryUrl(id: string): string | null {
  return UIRAS_ID.test(id) ? `${UIRAS}${id}.geojson` : null;
}

function series(list: unknown): WaterPoint[] {
  if (!Array.isArray(list)) return [];
  const out: WaterPoint[] = [];
  for (const p of list) {
    const celsius = num(p?.temp_water);
    const at = typeof p?.time === 'string' ? Date.parse(p.time) : NaN;
    if (celsius !== null && Number.isFinite(at)) out.push({ at, celsius });
  }
  out.sort((a, b) => a.at - b.at);
  // ONE POINT PER INSTANT. Sensoripaja's files repeat readings — Westend's holds
  // 37,501 records for 28,051 instants, and no instant carries two different
  // values — so a repeat is the same reading, not a second one. Left in, the
  // repeats made the median spacing zero and every segment of the line a "hole".
  return out.filter((p, i) => i === 0 || p.at !== out[i - 1].at);
}

export function parseWaterHistory(json: unknown): WaterHistory {
  const data = (json as { properties?: { data?: Record<string, unknown> } })?.properties?.data;
  if (!data || typeof data !== 'object') throw new Error('Water sensor file has no data');
  return { raw: series(data.raw), h3: series(data.h3), d1: series(data.d1) };
}

/** A sensor's history, from the URL its reading carries. */
export async function fetchWaterHistory(url: string, signal?: AbortSignal): Promise<WaterHistory> {
  return parseWaterHistory(await getJson(url, signal));
}

/** One decimal, with a real minus sign, like every other number on the page. */
export function formatWaterC(c: number): string {
  const s = Math.abs(c).toFixed(1);
  return c < 0 && s !== '0.0' ? `−${s}` : s;
}
