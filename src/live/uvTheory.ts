/**
 * The THEORETICAL clear-sky UV index: what the sun's geometry alone delivers.
 *
 * NOT A MEASUREMENT AND NOT A FORECAST, and the page says so wherever it is
 * drawn. It is the same kind of thing as the sun position beside it — astronomy
 * — with one empirical step on top: the clear-sky parameterisation
 *
 *   UVI = 12.0 · cos(z)^2.42 · (Ω/300)^−1.23 · d
 *
 * where z is the solar zenith angle, Ω the ozone column in Dobson units and d
 * the Earth–Sun distance correction (±3.3 % across the year, strongest in early
 * January). Ω is held at 300 DU, the global mean; the result is for sea level
 * under a cloudless sky. Nothing here knows about weather, aerosol, altitude or
 * snow, which is why it is a separate row from the CAMS index (uv.ts) and never
 * shares its ink: CAMS is a model of the real sky, this is the ceiling the sun
 * sets under no sky at all.
 *
 * Because it is computed, it is exact for any instant and any place on Earth —
 * which is what makes a global city search honest here when nothing else on the
 * page reaches past Finland.
 */
import { frameAltitude, solarFrame } from '../utils/sun';

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

/** The ozone column the index is stated for, in Dobson units. */
export const UV_THEORY_OZONE_DU = 300;

/** Earth–Sun distance correction for an instant (perihelion ≈ 3 January). */
export function sunDistanceFactor(ms: number): number {
  const d = new Date(ms);
  const n = (ms - Date.UTC(d.getUTCFullYear(), 0, 0)) / DAY_MS;
  return 1 + 0.0334 * Math.cos((2 * Math.PI * (n - 3)) / 365.25);
}

/** Clear-sky UVI for a solar altitude (degrees); 0 with the sun down. */
export function clearSkyUvi(altitudeDeg: number, distance: number, ozone = UV_THEORY_OZONE_DU): number {
  const mu = Math.sin(altitudeDeg * RAD);
  return mu <= 0 ? 0 : 12 * mu ** 2.42 * (ozone / 300) ** -1.23 * distance;
}

/** The same at a place and instant. */
export function theoryUviAt(lat: number, lon: number, ms: number): number {
  return clearSkyUvi(frameAltitude(solarFrame(new Date(ms)), lat, lon), sunDistanceFactor(ms));
}

/**
 * The solar-noon index at a latitude on a date — what the /live/uv/ bands draw.
 * Longitude-free: at its own noon every meridian sees the same sun.
 */
export function noonBandUvi(lat: number, dateMs: number, ozone = UV_THEORY_OZONE_DU): number {
  const dec = (Math.asin(solarFrame(new Date(dateMs)).sinDec) * 180) / Math.PI;
  return clearSkyUvi(90 - Math.abs(lat - dec), sunDistanceFactor(dateMs), ozone);
}

export interface UvTheoryDay {
  /** Highest value through the solar day, at local solar noon. */
  peak: number;
  /** Sun's altitude at that peak, degrees. */
  noonAltitude: number;
  /** Whole-day erythemal dose in SED (1 SED = 100 J/m²; UVI 1 for 1 h = 0.9 SED). */
  sed: number;
  /** Hours with the sun's centre above the horizon (no refraction). */
  daylight: number;
}

/** Sampling step for the whole-day integral. */
const STEP_MIN = 5;

/**
 * Peak and whole-day dose for the SOLAR day around `ms` at a place.
 *
 * The window is the 24 h centred on that longitude's solar noon nearest the
 * instant, not the viewer's calendar day — a city twelve time zones away has
 * its own noon, and integrating the viewer's midnight-to-midnight would split
 * its day in two.
 */
export function theoryDay(lat: number, lon: number, ms: number, ozone = UV_THEORY_OZONE_DU): UvTheoryDay {
  // Solar noon at this longitude ≈ 12:00 UTC − lon/15 h (equation of time
  // ignored: ±16 min moves the window, not the integral, by a few minutes).
  const offset = DAY_MS / 2 - (lon / 360) * DAY_MS;
  const noon = Math.round((ms - offset) / DAY_MS) * DAY_MS + offset;
  const dist = sunDistanceFactor(noon);
  let peak = 0;
  let noonAltitude = -90;
  let sum = 0;
  let up = 0;
  for (let m = -720 + STEP_MIN / 2; m < 720; m += STEP_MIN) {
    const alt = frameAltitude(solarFrame(new Date(noon + m * 60_000)), lat, lon);
    const v = clearSkyUvi(alt, dist, ozone);
    sum += v;
    if (alt > 0) up++;
    if (alt > noonAltitude) noonAltitude = alt;
    if (v > peak) peak = v;
  }
  return { peak, noonAltitude, sed: (0.9 * sum * STEP_MIN) / 60, daylight: (up * STEP_MIN) / 60 };
}

/**
 * The ramp, one colour per whole index from 0 to 17+ — the WHO scale's own hues
 * to 11, carried on into violets for the tropical highs the WHO bands lump into
 * "extreme". As RGB triples, because the map wash writes them into ImageData.
 */
export const UV_THEORY_RAMP: readonly (readonly [number, number, number])[] = [
  'b8b8b8', '3fa539', '7ec141', 'cbd93a', 'f2e21f', 'f6b41f', 'f58220', 'ef5b1e', 'e8261c',
  'e6008e', 'b45ce0', '9a86e8', '7d78dc', '6a68d0', '5758c4', '4547b4', '33379f', '1d2178',
].map((h) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4), 16)] as const);

export function uvTheoryRgb(v: number): readonly [number, number, number] {
  return UV_THEORY_RAMP[Math.min(17, Math.max(0, Math.floor(v)))];
}

/** One place from the geocoder. */
export interface Place {
  name: string;
  /** "Region, Country", whichever parts the geocoder gives. */
  where: string;
  lat: number;
  lon: number;
}

/**
 * Open-Meteo's geocoder (GeoNames, CC BY 4.0) — no key, CORS `*`, worldwide,
 * and it answers in the page's language, so "Tukholma" and "Stockholm" both
 * find the same city.
 */
export function geocodeUrl(query: string, lang: string): string {
  const p = new URLSearchParams({ name: query, count: '6', language: lang, format: 'json' });
  return `https://geocoding-api.open-meteo.com/v1/search?${p}`;
}

interface GeoResult {
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  country?: string;
}

export function parseGeocode(json: unknown): Place[] {
  const rs = (json as { results?: GeoResult[] })?.results;
  if (!Array.isArray(rs)) return [];
  const out: Place[] = [];
  for (const r of rs) {
    if (typeof r.name !== 'string' || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) continue;
    out.push({
      name: r.name,
      where: [r.admin1, r.country].filter((s) => s && s !== r.name).join(', '),
      lat: r.latitude!,
      lon: r.longitude!,
    });
  }
  return out;
}

export async function geocode(query: string, lang: string, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(geocodeUrl(query, lang), { signal });
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`);
  return parseGeocode(await res.json());
}

interface ReverseResult {
  name?: string;
  address?: Record<string, string>;
  error?: string;
}

/**
 * The place name under a point, from OpenStreetMap's Nominatim (ODbL, CORS `*`).
 *
 * Asked only on an explicit map click, never on hover — Nominatim's usage
 * policy is one request a second at most, and a click is far below that. Open
 * sea answers `{"error": "Unable to geocode"}`, which is `null` here: the
 * caller names the point by its coordinates instead.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  lang: string,
  signal?: AbortSignal,
): Promise<{ name: string; where: string } | null> {
  const p = new URLSearchParams({
    lat: lat.toFixed(4),
    lon: lon.toFixed(4),
    zoom: '10',
    format: 'jsonv2',
    'accept-language': lang,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${p}`, { signal });
  if (!res.ok) return null;
  const j = (await res.json()) as ReverseResult;
  if (j.error) return null;
  const a = j.address ?? {};
  const name = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? j.name;
  if (!name) return null;
  return { name, where: [a.state, a.country].filter((s) => s && s !== name).join(', ') };
}

