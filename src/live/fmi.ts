/**
 * The Finnish Meteorological Institute's WFS, once, for every feed that reads it.
 *
 * FMI publishes a great many things through one interface and one response
 * shape — `fmi::observations::weather::simple`, `urban::observations::
 * airquality::hourly::simple` and their siblings all return the same
 * `BsWfsElement` records differing only in which parameter they carry. Two feeds
 * already want it, so the parsing lives here rather than being copied with its
 * traps intact.
 *
 * THE TRAPS, which are the reason this file exists rather than an inline parse:
 *
 *  - COORDINATES ARE LATITUDE FIRST. `<gml:pos>` is declared
 *    `srsName=.../EPSG/0/4258` — ETRS89 in its authority-defined axis order.
 *    Reading it lon/lat puts every Finnish station off the coast of Somalia,
 *    and nothing in the code complains. This project has been caught by WFS axis
 *    order twice before (see CLAUDE.md on kartta.hel.fi against kartta.hsy.fi).
 *
 *  - `NaN` IS A VALUE FMI ACTUALLY SENDS, for a station that is present but not
 *    reporting, and it survives a bare parse as a number.
 *
 *  - AN EMPTY VALUE IS NOT ZERO. `Number('')` is 0, so an empty element parses
 *    into a confident reading of zero — a fabricated measurement, and on Finnish
 *    temperature or air-quality scales not even an implausible one. Emptiness is
 *    therefore rejected separately from non-finiteness, which a test pins.
 *
 *  - A MALFORMED RESPONSE DOES NOT THROW. `DOMParser` answers with a document
 *    containing `<parsererror>`, so an unchecked parse reads a truncated
 *    response as "no station in Finland is reporting anything".
 *
 * ONE READING PER STATION, THE NEWEST. Stations do not report in step — most
 * every ten minutes, some every minute, air quality hourly — so a request for a
 * single instant returns whichever handful happened to land on it. Every caller
 * asks for a window and keeps the newest per position instead.
 */

/** One station's most recent value of whichever parameter was requested. */
export interface FmiReading {
  lon: number;
  lat: number;
  value: number;
  /** When it was measured, ms since the epoch. */
  at: number;
}

/** Finland plus a margin, in the order the WFS wants: west,south,east,north. */
export const FMI_BBOX = '19,59,32,71';

/**
 * Build a stored-query URL for a parameter over Finland.
 *
 * `windowMinutes` is a look-back, not a precision knob: it has to be comfortably
 * longer than the publishing interval of the slowest station being asked for, or
 * that station simply has no reading in the response.
 */
export function fmiSimpleUrl(
  storedQueryId: string,
  parameter: string,
  now: number,
  windowMinutes: number,
): string {
  const start = new Date(now - windowMinutes * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'getFeature',
    storedquery_id: storedQueryId,
    bbox: FMI_BBOX,
    parameters: parameter,
    starttime: start,
  });
  return `https://opendata.fmi.fi/wfs?${params.toString()}`;
}

/**
 * Parse a `...::simple` response into one reading per station.
 *
 * Takes text rather than a Response so the whole thing is testable without a
 * network. Anything malformed is dropped rather than defaulted: a value plotted
 * at the wrong place, or a fabricated zero, is worse than a station not drawn.
 */
export function parseFmiSimple(xml: string): FmiReading[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('FMI: response was not parseable XML');
  }

  const elements = doc.getElementsByTagNameNS('*', 'BsWfsElement');
  if (elements.length === 0 && doc.getElementsByTagNameNS('*', 'FeatureCollection').length === 0) {
    throw new Error('FMI: not a WFS FeatureCollection');
  }

  const byStation = new Map<string, FmiReading>();

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
    // Not redundant with the finite check: `Number('')` is 0, not NaN.
    if (!valueText) continue;
    const value = Number(valueText);
    if (!Number.isFinite(value)) continue;

    const timeText = el.getElementsByTagNameNS('*', 'Time')[0]?.textContent?.trim();
    const at = timeText ? Date.parse(timeText) : NaN;
    if (!Number.isFinite(at)) continue;

    const key = `${lat},${lon}`;
    const prev = byStation.get(key);
    if (!prev || at > prev.at) byStation.set(key, { lon, lat, value, at });
  }

  return [...byStation.values()];
}

/**
 * Fetch and parse one stored query.
 *
 * Throws rather than returning an empty list on a bad response, for the reason
 * every feed on this page does: "nothing is reporting" and "we could not ask"
 * are different facts and only the first may be drawn as an empty map.
 */
export async function fetchFmiSimple(
  storedQueryId: string,
  parameter: string,
  windowMinutes: number,
  signal?: AbortSignal,
): Promise<FmiReading[]> {
  const res = await fetch(fmiSimpleUrl(storedQueryId, parameter, Date.now(), windowMinutes), {
    signal,
  });
  if (!res.ok) throw new Error(`FMI ${storedQueryId} responded ${res.status}`);
  return parseFmiSimple(await res.text());
}
