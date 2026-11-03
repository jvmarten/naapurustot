/**
 * Live beach water temperature for /live/, from Helsinki's Uiras sensors.
 *
 * Source: Forum Virium Helsinki's open Uiras network — LoRaWAN thermometers at
 * swimming beaches and piers in Helsinki, Espoo and Vantaa — published on Helsinki
 * Region Infoshare as "Veden reaaliaikainen lämpötila Helsingin uimarannoilla",
 * CC BY 4.0, no key, `Access-Control-Allow-Origin: *`. The host is the one HRI
 * registers (iot.fvh.fi; bri3.fvh.io serves the same files).
 *
 * TWO FILES, TWO QUESTIONS. `uiras_latest.geojson` is every sensor and its newest
 * reading — 28 features, ~3.4 kB gzipped — which is what the map polls. Each
 * sensor also has its own file holding three series, and that is what the panel's
 * chart reads, once, when a sensor is clicked (~19 kB gzipped):
 *
 *   raw  the last 7 days, every reading as sent (about every 30 minutes)
 *   h3   the last 30 days, 3-hour means
 *   d1   the last 2 years, daily (UTC) means
 *
 * The aggregates are the PUBLISHER'S: verified against `raw` — a d1 value is the
 * mean of that UTC day's raw readings and an h3 value the mean of the three hours
 * starting at its stamp — so the chart labels them as means and computes nothing.
 *
 * 'recorded', NOT 'archive'. The national files keep no past a browser can ask for
 * at an instant: the latest file is only the latest, and loading every sensor's
 * week to answer a scrub would be ~0.5 MB for a layer of a few dozen numbers. So
 * the map shows what this session's polls received, and a scrub further back goes
 * dark and says so. The panel's chart is where the history lives.
 *
 * WHAT IS DROPPED. A sensor with no `measurement` (pulled for the winter, or not
 * yet reporting) is not drawn, and a `temp_water` that is absent or not a finite
 * number drops the reading rather than becoming a zero. The enclosure temperature
 * (`temp_in`) is carried into the panel as published: a probe lifted out of the
 * water still reports, and the enclosure reading beside it is the publisher's own
 * evidence the reader can weigh — this file does not second-guess it.
 */

const BASE = 'https://iot.fvh.fi/opendata/uiras/';
export const WATER_LATEST_URL = `${BASE}uiras_latest.geojson`;

/** Sensors report about every 30 minutes; the latest file is rebuilt every few. */
export const WATER_POLL_MS = 600_000;

/**
 * How far a reading may sit from the clock before a sensor is simply not drawn.
 *
 * Two publishing steps: LoRaWAN drops a packet now and then, and one missed
 * half-hour should not blank a beach. Past an hour the honest answer is absence.
 */
export const WATER_TOLERANCE_MS = 60 * 60_000;

/** One sensor's water temperature at one instant. */
export interface WaterReading {
  id: string;
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
}

/** A sensor id as the network names them: a 16-digit hex LoRaWAN DevEUI. */
const ID = /^[0-9A-F]{16}$/;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;

/**
 * Parse `uiras_latest.geojson` into one reading per sensor that has one.
 *
 * Throws on something that is not a FeatureCollection — "no sensor is reporting"
 * and "we could not read the answer" are different facts.
 */
export function parseWaterLatest(json: unknown): WaterReading[] {
  const features = (json as { type?: unknown; features?: unknown })?.features;
  if ((json as { type?: unknown })?.type !== 'FeatureCollection' || !Array.isArray(features)) {
    throw new Error('Uiras: not a FeatureCollection');
  }
  const out: WaterReading[] = [];
  for (const f of features) {
    const id = str(f?.id);
    if (!id || !ID.test(id)) continue;
    const c = f?.geometry?.coordinates;
    const lon = num(c?.[0]);
    const lat = num(c?.[1]);
    if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
    const p = f.properties ?? {};
    const m = p.measurement;
    const celsius = num(m?.temp_water);
    const at = typeof m?.time === 'string' ? Date.parse(m.time) : NaN;
    if (celsius === null || !Number.isFinite(at)) continue;
    const depth = num(p['installation depth']);
    out.push({
      id,
      name: str(p.name) ?? id,
      district: str(p.district),
      lon,
      lat,
      at,
      celsius,
      enclosure: num(m.temp_in),
      depth: depth === null ? null : Math.abs(depth),
    });
  }
  return out;
}

/** Every sensor's newest reading. Rejects, never returns empty, on a bad response. */
export async function fetchWaterLatest(signal?: AbortSignal): Promise<WaterReading[]> {
  const res = await fetch(WATER_LATEST_URL, { signal });
  if (!res.ok) throw new Error(`Uiras responded ${res.status}`);
  return parseWaterLatest(await res.json());
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

/** The three series a sensor's file carries — see the note at the top. */
export interface WaterHistory {
  raw: WaterPoint[];
  h3: WaterPoint[];
  d1: WaterPoint[];
}

export type WaterSpan = keyof WaterHistory;

/** A sensor's own file. Null for anything that is not a sensor id. */
export function waterHistoryUrl(id: string): string | null {
  return ID.test(id) ? `${BASE}${id}.geojson` : null;
}

function series(list: unknown): WaterPoint[] {
  if (!Array.isArray(list)) return [];
  const out: WaterPoint[] = [];
  for (const p of list) {
    const celsius = num(p?.temp_water);
    const at = typeof p?.time === 'string' ? Date.parse(p.time) : NaN;
    if (celsius !== null && Number.isFinite(at)) out.push({ at, celsius });
  }
  return out.sort((a, b) => a.at - b.at);
}

export function parseWaterHistory(json: unknown): WaterHistory {
  const data = (json as { properties?: { data?: Record<string, unknown> } })?.properties?.data;
  if (!data || typeof data !== 'object') throw new Error('Uiras: no data in sensor file');
  return { raw: series(data.raw), h3: series(data.h3), d1: series(data.d1) };
}

export async function fetchWaterHistory(id: string, signal?: AbortSignal): Promise<WaterHistory> {
  const url = waterHistoryUrl(id);
  if (!url) throw new Error('Uiras: not a sensor id');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Uiras responded ${res.status}`);
  return parseWaterHistory(await res.json());
}

/** One decimal, with a real minus sign, like every other number on the page. */
export function formatWaterC(c: number): string {
  const s = Math.abs(c).toFixed(1);
  return c < 0 && s !== '0.0' ? `−${s}` : s;
}
