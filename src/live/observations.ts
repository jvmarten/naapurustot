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
export function observationsUrl(now: number): string {
  return fmiSimpleUrl(STORED_QUERY, PARAMETER, now, WINDOW_MINUTES);
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
 * Current air temperature at every reporting station in Finland.
 *
 * Throws rather than returning an empty list on a bad response: "no station is
 * reporting" and "we could not ask" are different facts and only the first may
 * be drawn as an empty map.
 */
export async function fetchObservations(signal?: AbortSignal): Promise<Observation[]> {
  const readings = await fetchFmiSimple(STORED_QUERY, PARAMETER, WINDOW_MINUTES, signal);
  return readings.map(toObservation);
}
