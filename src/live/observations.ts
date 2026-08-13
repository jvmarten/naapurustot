/**
 * Live air temperature for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI open data WFS, CC BY 4.0, no API key. The response shape and its
 * traps — latitude-first coordinates, `NaN` as a published value, an empty
 * element parsing as a confident zero — live in ./fmi.ts, which this and the air
 * quality feed share.
 *
 * WHY `simple` AND NOT `multipointcoverage`. The coverage encoding looks like the
 * efficient choice — one block of numbers instead of an XML element per reading —
 * and it is, uncompressed. Over the wire it is the opposite, because the verbose
 * form is enormously repetitive and gzip eats it:
 *
 *   simple              170 kB raw   ->   5.3 kB gzipped
 *   multipointcoverage  210 kB raw   ->  15.8 kB gzipped
 *
 * 5.3 kB puts this in the same class as the trains (2.4 kB) and the road
 * incidents (3.4 kB), which is what makes it affordable to poll at all. Anyone
 * tempted to "optimise" this to the coverage format should measure the transfer
 * rather than the payload; a note elsewhere in this codebase calls FMI
 * observations "224 kB of GML", which is the raw figure and three decimal orders
 * away from what a browser actually downloads.
 */
import {
  fetchFmiSeries,
  fetchFmiSimple,
  fmiSimpleUrl,
  parseFmiSimple,
  type FmiReading,
} from './fmi';

/** One station's air temperature at one instant. */
export interface Observation {
  lon: number;
  lat: number;
  /** Air temperature at 2 m, in degrees Celsius. */
  celsius: number;
  /** When it was measured — or, for a forecast, forecast FOR. */
  at: number;
  /**
   * True when this is ECMWF's prediction rather than a station's reading.
   *
   * Undefined and false mean the same thing and the map treats them the same;
   * the field is optional so the measured paths that build these objects do not
   * have to state the negative. Nothing drawn from a forecast is drawn like a
   * measurement — see `paintObservations`.
   */
  forecast?: boolean;
}

const STORED_QUERY = 'fmi::observations::weather::simple';

/** Air temperature at 2 m — one number per station is what the map can show. */
const PARAMETER = 't2m';

/**
 * How far back to ask, in minutes.
 *
 * Long enough that a station on a ten-minute cycle is certainly in the window
 * even if its last report just missed the edge, short enough that the response
 * stays small. Twenty minutes yielded 277 readings for 187 stations.
 */
const WINDOW_MINUTES = 20;

/**
 * How often we ask, in ms.
 *
 * Most stations publish every ten minutes, so polling faster would re-download
 * the same numbers. Five minutes keeps the page within half an update of the
 * source without asking for anything that cannot have changed.
 */
export const OBSERVATION_POLL_MS = 300_000;

/** The request URL for a given instant. Exported so a test can read it. */
export function observationsUrl(at: number, bounded = false): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETER, at, WINDOW_MINUTES, bounded);
}

const toObservation = (r: FmiReading): Observation => ({
  lon: r.lon,
  lat: r.lat,
  celsius: r.value,
  at: r.at,
});

/** Parse a temperature response. See ./fmi.ts for what is rejected and why. */
export function parseObservations(xml: string): Observation[] {
  return parseFmiSimple(xml).map(toObservation);
}

/**
 * Air temperature at every reporting station in Finland, now or in the past.
 *
 * `at` null is the live case. A number is a scrub: the same stored query serves
 * the archive, so what comes back is what the stations measured at that moment —
 * not the present redrawn under an older clock.
 *
 * Throws rather than returning an empty list on a bad response: "no station is
 * reporting" and "we could not ask" are different facts and only the first may
 * be drawn as an empty map.
 */
export async function fetchObservations(
  signal?: AbortSignal,
  at: number | null = null,
): Promise<Observation[]> {
  const readings = await fetchFmiSimple(STORED_QUERY, PARAMETER, WINDOW_MINUTES, signal, at);
  return readings.map(toObservation);
}

/**
 * How coarsely a day of measurements is loaded, in minutes.
 *
 * See {@link fetchObservationSeries}. Hourly is a thinning of real ten-minutely
 * readings rather than an average of them (fmi.ts explains `timestep`), so every
 * value in the strip is one a station actually reported, at the minute it
 * reported it. The finer readings around wherever the clock settles are fetched
 * separately by the live/archive poll and merged into the same series.
 */
export const SERIES_STEP_MINUTES = 60;

/**
 * A day of national air temperature, as published, in one request.
 *
 * WHY A WINDOW RATHER THAN AN INSTANT. This is what makes the time slider
 * responsive instead of chatty: the page holds the day and samples it locally
 * (timeline.ts), so dragging the bar costs a binary search per station rather
 * than a debounce plus a round trip. Measured against the live service, a whole
 * day of the whole country at hourly steps is 1,528 readings and ~20 kB gzipped
 * — less than four of the single-instant requests it replaces, and a scrub
 * across the bar used to be able to ask for 288 of them.
 */
export function fetchObservationSeries(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<Observation[]> {
  return fetchFmiSeries(
    STORED_QUERY,
    PARAMETER,
    fromMs,
    toMs,
    SERIES_STEP_MINUTES,
    signal,
  ).then((readings) => readings.map(toObservation));
}

/**
 * The forecast collection: ECMWF's surface forecast AT FMI's observation
 * stations.
 *
 * This is what lets the temperature layer keep working past "now" instead of
 * switching off, and finding it is the whole reason the layer changed. The
 * obvious query — `fmi::forecast::edited::weather::scandinavia::point::simple`,
 * the one this file already used for a single station — genuinely cannot serve a
 * map: it takes `place`, `latlon`, `fmisid`, `geoid` or `wmo` and answers a bbox
 * request with `numberReturned="0"`, so a national picture would have been a
 * hundred-odd requests to a free public service, which is not a thing to do.
 *
 * `ecmwf::forecast::surface::obsstations::simple` DOES take a bbox, and it is
 * evaluated at the observation network's own coordinates — 236 stations against
 * the 191 currently reporting temperature, of which 189 match position for
 * position. That coordinate agreement is the point: the same station carries
 * this morning's measurement and this evening's forecast in one series, so
 * crossing "now" on the slider changes what the number MEANS (and how it is
 * drawn, and what the readout says) without the map's stations shuffling.
 *
 * Measured: one instant nationally is 5.2 kB gzipped, a day at hourly steps
 * 67 kB — the same class as the measured side of the day.
 */
const FORECAST_QUERY = 'ecmwf::forecast::surface::obsstations::simple';
const FORECAST_PARAMETER = 'Temperature';

/**
 * ECMWF's published forecast for every observation station, over a window.
 *
 * Flagged `forecast: true` at the boundary, once, so nothing downstream has to
 * remember which fetch a number came from. Where this overlaps the measured
 * strip the measurement wins — see `mergeReadings`.
 */
export function fetchForecastSeries(
  fromMs: number,
  toMs: number,
  signal?: AbortSignal,
): Promise<Observation[]> {
  return fetchFmiSeries(
    FORECAST_QUERY,
    FORECAST_PARAMETER,
    fromMs,
    toMs,
    SERIES_STEP_MINUTES,
    signal,
  ).then((readings) => readings.map((r) => ({ ...toObservation(r), forecast: true })));
}

/**
 * FMI's published forecast temperature at ONE point and instant.
 *
 * Kept alongside the national collection above, and not made redundant by it,
 * because the two answer different questions. That one is ECMWF evaluated at the
 * observation network's stations, which is what a MAP needs; this is FMI's own
 * edited forecast at an arbitrary latlon, which is what a reader who has clicked
 * a particular station gets in the panel — FMI's published figure for that
 * place, from the model FMI's own forecasts are edited into.
 *
 * Harmonie/edited surface forecast, ~500 bytes a call.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
  at: number,
  signal?: AbortSignal,
): Promise<Observation | null> {
  const time = new Date(at).toISOString().replace(/\.\d+Z$/, 'Z');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: 'fmi::forecast::edited::weather::scandinavia::point::simple',
    latlon: `${lat.toFixed(4)},${lon.toFixed(4)}`,
    parameters: 'Temperature',
    starttime: time,
    endtime: time,
  });
  const res = await fetch(`https://opendata.fmi.fi/wfs?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`FMI forecast responded ${res.status}`);
  const readings = parseFmiSimple(await res.text());
  return readings.length > 0 ? { ...toObservation(readings[0]), forecast: true } : null;
}
