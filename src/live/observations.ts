/**
 * Live air temperature for /live/, from the Finnish Meteorological Institute.
 *
 * Source: FMI open data WFS, CC BY 4.0, no API key.
 *
 *   https://opendata.fmi.fi/wfs  (storedquery_id=fmi::observations::weather::simple)
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
 *
 * THE COORDINATES ARE LAT-FIRST. `<gml:pos>` here is `srsName=.../EPSG/0/4258`,
 * which is ETRS89 in its authority-defined axis order: latitude, then longitude.
 * Reading it as lon/lat puts every Finnish station in Somalia. This project has
 * been bitten by axis order twice already on WFS servers (see the note about
 * kartta.hel.fi against kartta.hsy.fi in CLAUDE.md), so the order is asserted in
 * the tests rather than left to a reviewer to notice.
 *
 * ONE READING PER STATION, THE NEWEST. A window is requested rather than an
 * instant because stations do not report in step — most send every ten minutes,
 * some every minute, and asking for a single timestamp returns whatever handful
 * happened to be on it. Requesting the last while and keeping the newest per
 * position gives every station its current value; in a sample, 187 stations
 * produced 277 readings, five of them reporting eighteen times over.
 *
 * NaN IS A REAL VALUE HERE. FMI writes `NaN` into `ParameterValue` for a station
 * that is present but not reporting, and `parseFloat('NaN')` is a number, so an
 * unguarded parse silently plots NaN and the label renders as "NaN°". Dropped.
 */

/** One station's most recent air temperature. */
export interface Observation {
  lon: number;
  lat: number;
  /** Air temperature at 2 m, in degrees Celsius. */
  celsius: number;
  /** When it was measured, ms since the epoch. */
  at: number;
}

/** Finland plus a margin, as the WFS wants it: west,south,east,north. */
const BBOX = '19,59,32,71';

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
 * Most stations publish every ten minutes, so polling faster than that would
 * re-download the same numbers. Five minutes keeps the page within half an
 * update of the source without asking for anything that cannot have changed.
 */
export const OBSERVATION_POLL_MS = 300_000;

/** The request URL for a given instant. Exported so a test can read it. */
export function observationsUrl(now: number): string {
  const start = new Date(now - WINDOW_MINUTES * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: 'fmi::observations::weather::simple',
    bbox: BBOX,
    // Temperature only. Every extra parameter multiplies the element count, and
    // one number per station is what the map can legibly show.
    parameters: 't2m',
    starttime: start,
  });
  return `https://opendata.fmi.fi/wfs?${params.toString()}`;
}

/**
 * Turn the WFS response into one reading per station.
 *
 * Takes the XML as text and parses it here so the whole thing is testable
 * without a network. Anything malformed is dropped rather than defaulted — a
 * temperature plotted at the wrong place, or a NaN rendered as a label, is worse
 * than a station simply not being drawn.
 */
export function parseObservations(xml: string): Observation[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  // A parse failure yields a document containing <parsererror>, not an
  // exception — checked explicitly, because otherwise a truncated response
  // reads as "no stations are reporting anywhere in Finland".
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('FMI observations: response was not parseable XML');
  }

  const elements = doc.getElementsByTagNameNS('*', 'BsWfsElement');
  if (elements.length === 0 && doc.getElementsByTagNameNS('*', 'FeatureCollection').length === 0) {
    throw new Error('FMI observations: not a WFS FeatureCollection');
  }

  /** Newest reading per position, keyed by the raw coordinate text. */
  const byStation = new Map<string, Observation>();

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const posText = el.getElementsByTagNameNS('*', 'pos')[0]?.textContent?.trim();
    if (!posText) continue;
    // LATITUDE FIRST — see the note at the top of this file.
    const [latText, lonText] = posText.split(/\s+/);
    const lat = Number(latText);
    const lon = Number(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

    const valueText = el.getElementsByTagNameNS('*', 'ParameterValue')[0]?.textContent?.trim();
    // The emptiness check is NOT redundant with the finite check below, and the
    // difference is a fabricated reading: `Number('')` is 0, not NaN, so an
    // element with an empty value would otherwise be published to the map as a
    // confident 0.0 °C. On a Finnish map that is not even an implausible number.
    if (!valueText) continue;
    const celsius = Number(valueText);
    // Rejects NaN, which FMI writes for a station that is present but not
    // reporting — and which survives a bare parse as a number.
    if (!Number.isFinite(celsius)) continue;

    const timeText = el.getElementsByTagNameNS('*', 'Time')[0]?.textContent?.trim();
    const at = timeText ? Date.parse(timeText) : NaN;
    if (!Number.isFinite(at)) continue;

    const key = `${lat},${lon}`;
    const prev = byStation.get(key);
    if (!prev || at > prev.at) byStation.set(key, { lon, lat, celsius, at });
  }

  return [...byStation.values()];
}

/**
 * Current air temperature at every reporting station in Finland.
 *
 * Throws rather than returning an empty list on a bad response, for the reason
 * the other feeds do: "no station is reporting" and "we could not ask" are
 * different facts and only the first may be drawn as an empty map.
 */
export async function fetchObservations(signal?: AbortSignal): Promise<Observation[]> {
  const res = await fetch(observationsUrl(Date.now()), { signal });
  if (!res.ok) throw new Error(`FMI observations responded ${res.status}`);
  return parseObservations(await res.text());
}
