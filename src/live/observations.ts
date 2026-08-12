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
import { fetchFmiSimple, fmiSimpleUrl, parseFmiSimple, type FmiReading } from './fmi';

/** One station's most recent air temperature. */
export interface Observation {
  lon: number;
  lat: number;
  /** Air temperature at 2 m, in degrees Celsius. */
  celsius: number;
  /** When it was measured, ms since the epoch. */
  at: number;
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
 * FMI's published forecast temperature at ONE point and instant.
 *
 * THIS IS THE ONLY THING THIS PAGE DRAWS FROM THE FUTURE, and it is fetched a
 * point at a time on purpose rather than as a national layer. The reason is a
 * limit of the source, not a design preference: the forecast stored query takes
 * `place`, `latlon`, `fmisid`, `geoid` or `wmo` and NOT a bbox — verified against
 * the live service, where a bbox request answers 200 with `numberReturned="0"`,
 * and a comma-separated list of station ids answers 400. So there is no way to
 * ask for the whole country in one request, and a hundred requests to paint a
 * map of forecasts is not something to do to a free public service.
 *
 * A forecast is therefore something you ask for about a station you picked, and
 * it is labelled as a forecast wherever it is shown. The map itself stays
 * measurements-only: scrubbing into the future switches the observation layer
 * OFF rather than filling it with modelled values that would look identical to
 * readings.
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
  return readings.length > 0 ? toObservation(readings[0]) : null;
}
