/**
 * The UV index for the place the map is looking at, hour by hour through the day.
 *
 * Source: Copernicus Atmosphere Monitoring Service (CAMS), served by Open-Meteo's
 * air-quality API — CC BY 4.0, no key, `access-control-allow-origin: *`. The
 * European domain is 11 km and the global one 45 km; hours run from 92 days back
 * to about five days ahead, in one request per place and day.
 *
 * WHY NOT FMI, WHICH EVERY OTHER WEATHER LAYER HERE USES. Because FMI does not
 * publish a UV index a browser can ask for. Its 320 stored queries contain no UV
 * product at all; what exists is `fmi::observations::radiation::*`, whose
 * `UVB_U` is a UV-B irradiance in mW/m² at eight stations. Turning that into an
 * index means assuming it is the erythemally weighted quantity and dividing by
 * 25 mW/m² — a conversion WE would be inventing on top of a measurement of
 * something else, at eight points for a whole country. This project does not
 * ship numbers it derived and presented as the published quantity, so the choice
 * was a real UV index from a model or no UV index at all.
 *
 * SO THE WHOLE LAYER IS MODELLED, ALWAYS — including its past. Open-Meteo's
 * air-quality archive is earlier CAMS runs, not observations, so there is no
 * measured half to protect here and no seam to draw: unlike the temperature feed,
 * where a station's morning is measured and its evening forecast, every hour of
 * this one is the same kind of thing. It is therefore stated as a model wherever
 * it appears, and drawn in the same italic the forecast arms of the other feeds
 * use. What it must never do is sit in the readout looking like the astronomy
 * beside it, which IS exact at any instant.
 *
 * NOTHING IS INTERPOLATED BETWEEN HOURS. CAMS publishes on the hour and the value
 * is the model's for that hour, so the sample under the playhead is the nearest
 * published hour and no more than {@link UV_TOLERANCE_MS} away — half a step,
 * which covers every instant of the day exactly once and never attributes a value
 * to a time more than thirty minutes from the one it was published for. The
 * readout prints that hour, as every other feed on this page prints its own.
 */

/** One published hour of the index at one place. */
export interface UvHour {
  /** The hour this value is published for, ms since the epoch. */
  at: number;
  /** The UV index under the model's own sky. */
  index: number;
  /** The same hour with no cloud, which is what makes the first number readable. */
  clearSky: number | null;
}

const ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * Decimal places the requested coordinate is rounded to.
 *
 * One place is ~11 km of latitude, which is the European domain's own cell — so
 * rounding here cannot cost the reader resolution the model has, and it turns
 * every pan inside one cell into the same URL. That matters more than it sounds:
 * the camera is written on `moveend`, and without this a walk across a city
 * would issue a request per gesture for a value that cannot have changed.
 */
const GRID_DP = 1;

/** The cell a camera falls in — the identity a loaded day is cached under. */
export function uvCell(lat: number, lon: number): string {
  return `${lat.toFixed(GRID_DP)},${lon.toFixed(GRID_DP)}`;
}

/**
 * How far from the playhead a published hour may sit and still be shown.
 *
 * Exactly half the publishing step. Any wider and an hour would be printed under
 * an instant nearer to the next one; any narrower and the day would have gaps in
 * it that mean nothing about the model.
 */
export const UV_TOLERANCE_MS = 1_800_000;

/** `YYYY-MM-DD` in UTC — the calendar the request's `start_date` is in. */
function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The request URL for a place and a window. Exported so a test can read it.
 *
 * `timeformat=unixtime` rather than ISO strings: the timestamps are half the
 * response and this makes them numbers the page can use without parsing. A day
 * of both variables is under half a kilobyte.
 *
 * The dates are UTC while the window is a LOCAL day, so the request is widened
 * to whole UTC days at both ends — at most a few extra hours, which cost nothing
 * and leave a scrub to either side of midnight with an hour to land on.
 */
export function uvUrl(lat: number, lon: number, fromMs: number, toMs: number): string {
  const p = new URLSearchParams({
    latitude: lat.toFixed(GRID_DP),
    longitude: lon.toFixed(GRID_DP),
    hourly: 'uv_index,uv_index_clear_sky',
    start_date: utcDate(fromMs),
    end_date: utcDate(toMs),
    timeformat: 'unixtime',
    timezone: 'UTC',
  });
  return `${ENDPOINT}?${p}`;
}

interface UvResponse {
  hourly?: {
    time?: number[];
    uv_index?: (number | null)[];
    uv_index_clear_sky?: (number | null)[];
  };
}

/**
 * Parse a response into published hours, dropping the ones with no value.
 *
 * A `null` is what the API answers past the run's horizon, and it is a real
 * answer: the model has not been run that far. Kept out of the series rather
 * than zeroed, because zero is a night-time UV index and would draw "the sun is
 * not up" over a day nobody has forecast yet.
 */
export function parseUv(json: unknown): UvHour[] {
  const h = (json as UvResponse)?.hourly;
  if (!h?.time || !h.uv_index) return [];
  const out: UvHour[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const index = h.uv_index[i];
    if (typeof index !== 'number' || !Number.isFinite(index)) continue;
    const clear = h.uv_index_clear_sky?.[i];
    out.push({
      at: h.time[i] * 1000,
      index,
      clearSky: typeof clear === 'number' && Number.isFinite(clear) ? clear : null,
    });
  }
  return out;
}

/** A day of the index at one place, in one request. */
export async function fetchUvDay(
  lat: number,
  lon: number,
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<UvHour[]> {
  const res = await fetch(uvUrl(lat, lon, fromMs, toMs), { signal });
  // A window outside the archive answers 400 with a `reason`, which is a failure
  // to report rather than an empty day — the two are different on this page.
  if (!res.ok) throw new Error(`UV index request failed: ${res.status}`);
  return parseUv(await res.json());
}

/**
 * The published hour under an instant, or null when none is near enough.
 *
 * Nearest rather than latest-before, because the hours are a model's steps and
 * not a stream of arrivals: 11:55 belongs to the 12:00 run of the same day, and
 * showing it 11:00 would be a worse answer that happens to be older.
 */
export function pickUv(hours: readonly UvHour[], atMs: number): UvHour | null {
  let best: UvHour | null = null;
  let bestGap = Infinity;
  for (const h of hours) {
    const gap = Math.abs(h.at - atMs);
    if (gap < bestGap) {
      bestGap = gap;
      best = h;
    }
  }
  return best !== null && bestGap <= UV_TOLERANCE_MS ? best : null;
}

/**
 * The WHO/WMO exposure bands, which are what the number is for.
 *
 * "3.6" is not a reading anybody acts on; "moderate" is. The thresholds are the
 * published global solar UV index scale — low below 3, moderate to 6, high to 8,
 * very high to 11, extreme above — and the colours are that scale's own, so the
 * band reads the same here as on every sunscreen bottle and forecast in Europe.
 *
 * Two inks per band, because this sits in a row that renders on white and on
 * near-black. The scale's yellow is 4.5:1 against neither; these are the same
 * hues taken down (light theme) and up (dark theme) until they pass on both.
 */
export interface UvBand {
  /** i18n key for the band's name. */
  key: string;
  light: string;
  dark: string;
}

const BANDS: { max: number; band: UvBand }[] = [
  { max: 3, band: { key: 'live.uv.band_low', light: '#15803d', dark: '#4ade80' } },
  { max: 6, band: { key: 'live.uv.band_moderate', light: '#a16207', dark: '#fde047' } },
  { max: 8, band: { key: 'live.uv.band_high', light: '#c2410c', dark: '#fb923c' } },
  { max: 11, band: { key: 'live.uv.band_very_high', light: '#b91c1c', dark: '#f87171' } },
  { max: Infinity, band: { key: 'live.uv.band_extreme', light: '#7e22ce', dark: '#d8b4fe' } },
];

export function uvBand(index: number): UvBand {
  for (const { max, band } of BANDS) if (index < max) return band;
  return BANDS[BANDS.length - 1].band;
}

/**
 * The index, at the precision CAMS publishes it.
 *
 * One decimal, and not rounded to the whole numbers the WHO bands are stated in:
 * the scale's boundaries are whole, the quantity is not, and printing "3" for
 * 3.4 would put a value on screen the source never gave. `toFixed` also keeps
 * the reserved width honest — "11.5" is the widest this can be in Finland by a
 * long way, and the row reserves for it.
 */
export function formatUv(index: number): string {
  return index.toFixed(1);
}
