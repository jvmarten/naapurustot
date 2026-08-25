/**
 * Live cloud cover for /live/, from the Finnish Meteorological Institute.
 *
 * Source: the same FMI open-data WFS the temperature, wind and air-quality feeds
 * read (`fmi::observations::weather::simple`, CC BY 4.0, no API key), and the same
 * traps — latitude-first coordinates, `NaN` as a published value, an empty element
 * that parses into a confident zero, a `<parsererror>` that does not throw. Those
 * live in ./fmi.ts, which this feed borrows whole: cloud amount is ONE number per
 * station, so it rides the scalar reader and the scalar timeline (timeline.ts)
 * exactly as temperature and air quality do, and this file is little more than the
 * parameter name, the okta vocabulary, and the fetch wrappers a test can name.
 *
 * WHY THIS FEED, BESIDE THE SHADOWS. The page's headline layer casts the sun's
 * GEOMETRY — where a building's shadow falls if the sun reaches it. Cloud cover is
 * the other half of that sentence: whether the sun is reaching the ground at all.
 * The two answer a question neither can alone, which is why cloud cover earns a row
 * next to a radar that only shows rain — a sky can be solid overcast without a drop
 * falling, and the shadow layer has no way to say so.
 *
 * `n_man` IS CLOUD AMOUNT IN OKTAS — eighths of the sky covered, 0 (clear) to 8
 * (overcast), with 9 reserved by the WMO code for a sky the observer cannot see
 * (fog, falling snow). It is a whole-number count, not a percentage, and the map
 * draws it as the fraction of a small circle that is filled — the meteorologist's
 * own sky-cover symbol, which needs no legend and no colour ramp to compete with
 * the shadow layer. See `paintClouds` in LivePage.
 *
 * ARCHIVE, NOT FORECAST. Temperature carries past "now" on ECMWF's forecast at the
 * same stations; cloud cover cannot, and it is not for want of trying — ECMWF's
 * `obsstations` collection answers `TotalCloudCover` (and `LowCloudCover`) as `NaN`
 * at every station, the same empty-published-value trap the air-quality index has.
 * So this feed measures and stops at the present, going dark ahead of now exactly
 * as wind and air quality do; the registry says `archive` and the readout says so
 * in words.
 */
import {
  fetchFmiSeries,
  fetchFmiSimple,
  fmiSeriesUrl,
  fmiSimpleUrl,
  type FmiReading,
} from './fmi';

const STORED_QUERY = 'fmi::observations::weather::simple';

/** Total cloud amount in oktas — one number per station is what the map can show. */
const PARAMETER = 'n_man';

/**
 * How far back a live request looks, in minutes.
 *
 * The same twenty minutes the temperature and wind feeds use, and for the same
 * reason: automated stations report cloud amount on a ten-minute cycle, so the
 * window is comfortably longer than the interval even when a station's last report
 * just missed the edge.
 */
const WINDOW_MINUTES = 20;

/** How often the live feed re-asks, in ms. Stations publish every ten minutes. */
export const CLOUD_POLL_MS = 300_000;

/**
 * How far a sample may sit from the clock before a station simply is not drawn.
 *
 * The same forty-five minutes the temperature and wind layers use. Cloud amount is
 * published on the stations' ten-minute cycle where it is automated and hourly or
 * three-hourly where it is manual, so a reading within three-quarters of an hour is
 * the one that belongs under the playhead; past that the honest answer is absence
 * rather than a stale okta under a clock it does not belong to.
 */
export const CLOUD_TOLERANCE_MS = 45 * 60_000;

/** How coarsely a day is loaded. Hourly is a thinning of real readings, not an average. */
export const SERIES_STEP_MINUTES = 60;

/** One station's cloud amount at one instant — the sample the map draws and inspects. */
export interface CloudStation {
  lon: number;
  lat: number;
  /**
   * Cloud amount in oktas: 0 (clear) to 8 (overcast), or 9 (sky obscured).
   *
   * FMI's published `n_man`, unrounded and unclamped — every consumer decides what
   * to do with a 9 rather than this feed folding it into an 8 that means something
   * different. `oktaKey` names the band and `formatOktas` clamps for display.
   */
  oktas: number;
  /** When it was measured, ms since the epoch. */
  at: number;
}

/** The live/archive request URL for a given instant. Exported so a test can read it. */
export function cloudsUrl(at: number, bounded = false): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETER, at, WINDOW_MINUTES, bounded);
}

/** The window request URL for a day. Exported so a test can read it. */
export function cloudsSeriesUrl(fromMs: number, toMs: number): string {
  return fmiSeriesUrl(STORED_QUERY, PARAMETER, fromMs, toMs, SERIES_STEP_MINUTES);
}

/**
 * Cloud amount at every reporting station in Finland, now or at a past instant.
 *
 * Returns FmiReading directly — value IS the okta count — so the scalar timeline
 * takes it unchanged. `at` null is the live case; a number is a scrub, and the same
 * stored query serves the archive (see ./fmi.ts). Throws rather than returning an
 * empty list on a bad response, for the reason every feed here does: "no station is
 * reporting" and "we could not ask" are different facts.
 */
export function fetchClouds(
  signal?: AbortSignal,
  at: number | null = null,
): Promise<FmiReading[]> {
  return fetchFmiSimple(STORED_QUERY, PARAMETER, WINDOW_MINUTES, signal, at);
}

/**
 * A whole day of national cloud amount in one request, for the slider to sample
 * locally. Every reading, ungrouped, for {@link mergeReadings} to insert — see
 * ./timeline.ts on why the day is a window rather than an instant.
 */
export function fetchCloudSeries(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<FmiReading[]> {
  return fetchFmiSeries(STORED_QUERY, PARAMETER, fromMs, toMs, SERIES_STEP_MINUTES, signal);
}

/** True when the station reported a sky it could not observe (WMO okta 9). */
export function isObscured(oktas: number): boolean {
  return Math.round(oktas) >= 9;
}

/**
 * The WMO sky-cover band for an okta count, as an i18n key.
 *
 * The conventional five-band reading of eighths, plus the code-table's ninth value
 * for a sky the observer could not see. Composed at runtime (`live.clouds.band_*`),
 * so the drift guard in i18nUnusedKeys carries the prefix.
 */
export function oktaKey(oktas: number): string {
  const n = Math.round(oktas);
  if (n >= 9) return 'live.clouds.band_obscured';
  if (n >= 8) return 'live.clouds.band_overcast';
  if (n >= 5) return 'live.clouds.band_broken';
  if (n >= 3) return 'live.clouds.band_scattered';
  if (n >= 1) return 'live.clouds.band_few';
  return 'live.clouds.band_clear';
}

/** The okta count as an "N/8" fraction, clamped to the observable range. */
export function formatOktas(oktas: number): string {
  const n = Math.min(8, Math.max(0, Math.round(oktas)));
  return `${n}/8`;
}
