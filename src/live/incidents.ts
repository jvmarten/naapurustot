/**
 * Live road incidents for /live/ — what is currently disrupting the road network.
 *
 * Source: Fintraffic's Digitraffic traffic-message API, open data under CC BY
 * 4.0, no API key. The same publisher and the same conventions as the train
 * feed next to it, so the gzip requirement and the `Digitraffic-User` header
 * carry over unchanged.
 *
 *   https://tie.digitraffic.fi/api/traffic-message/v1/messages
 *
 * WHY ANNOUNCEMENTS AND NOT ROADWORKS. The endpoint serves several situation
 * types and they are not remotely the same size. Measured against the live API:
 *
 *   TRAFFIC_ANNOUNCEMENT      8 features      3.4 kB
 *   ROAD_WORK               585 features    1.28 MB
 *   (road weather stations) 526 stations      373 kB
 *
 * Announcements are what a person means by "is anything wrong on the roads" —
 * accidents, closures, obstructions — and at 3.4 kB the feed sits in the same
 * class as the trains' 2.4 kB, which is what makes a short poll defensible on a
 * free shared endpoint. Roadworks are three hundred times the payload to tell
 * you about cones that will still be there tomorrow; if they are ever wanted
 * they belong on a much slower poll, not this one.
 *
 * GEOMETRY IS MIXED, AND THAT IS THE POINT. A third of these are Points, a
 * third LineStrings and a fifth MultiLineStrings — an accident is a place, a
 * closure is a stretch of road. Collapsing lines to their midpoint would draw a
 * ten-kilometre closure as a dot and understate it, so both are kept and the
 * renderer draws each as what it is.
 *
 * THE TITLES ARE FINNISH ONLY. Every announcement in the feed carries exactly
 * one `announcements[]` entry with `language: 'FI'` — there is no Swedish or
 * English text to select, whatever the app's own locale. The UI around the
 * incident is translated; the incident text is reproduced as published. Machine
 * translating an official traffic announcement would be inventing wording that
 * nobody issued, on a page whose whole design is about which statements are
 * sourced.
 */

/** One active road incident. */
export interface Incident {
  /** Fintraffic's situation id — stable across updates to the same incident. */
  id: string;
  /** Announcement title as published, Finnish. */
  title: string;
  /** Municipality, when the feed located it. */
  municipality: string | null;
  /**
   * Representative point: the geometry's own point, or the first vertex of a
   * line. Used for labelling and for the viewport test.
   */
  lon: number;
  lat: number;
  /**
   * Line geometry, when the incident covers a stretch of road rather than a
   * spot. One entry per line; a MultiLineString contributes several.
   */
  lines: [number, number][][];
  /** When the incident began, ms since the epoch, or null if unparseable. */
  since: number | null;
}

export const INCIDENTS_ENDPOINT =
  'https://tie.digitraffic.fi/api/traffic-message/v1/messages' +
  '?inactiveHours=0&includeAreaGeometry=false&situationType=TRAFFIC_ANNOUNCEMENT';

/**
 * How often we ask, in ms.
 *
 * Far slower than the trains' five seconds, because the underlying thing moves
 * far slower: an announcement is published once and then stands for hours — the
 * oldest in a sample taken while writing this had been open since the previous
 * month. A minute is already faster than the data can change and keeps the page
 * honest within a minute of the source.
 */
export const INCIDENT_POLL_MS = 60_000;

/** Fintraffic asks every caller to identify itself. See trains.ts. */
const DIGITRAFFIC_USER = 'naapurustot.fi/live';

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A [lon, lat] pair from the feed, or null when it is not one. */
function point(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lon = finite(raw[0]);
  const lat = finite(raw[1]);
  if (lon === null || lat === null) return null;
  // Generous bounds: the guard is against garbage and swapped axes, not against
  // an incident being somewhere surprising.
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

interface RawFeature {
  geometry?: { type?: unknown; coordinates?: unknown } | null;
  properties?: {
    situationId?: unknown;
    announcements?: unknown;
  } | null;
}

/**
 * Turn the endpoint's GeoJSON into incidents, dropping anything malformed.
 *
 * Split from the fetch so it can be tested without a network. An entry with no
 * usable geometry is dropped rather than defaulted: an incident drawn at 0,0 is
 * worse than an incident not drawn, because the first one is a claim.
 */
export function parseIncidents(payload: unknown): Incident[] {
  const features = (payload as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) {
    throw new Error('traffic messages: expected a GeoJSON FeatureCollection');
  }

  const out: Incident[] = [];
  for (const raw of features as RawFeature[]) {
    const id = raw?.properties?.situationId;
    if (typeof id !== 'string' || !id) continue;

    const announcements = raw.properties?.announcements;
    const first = Array.isArray(announcements) ? announcements[0] : null;
    const title = typeof first?.title === 'string' ? first.title.trim() : '';
    if (!title) continue;

    const municipality =
      typeof first?.locationDetails?.roadAddressLocation?.primaryPoint?.municipality === 'string'
        ? first.locationDetails.roadAddressLocation.primaryPoint.municipality
        : null;

    const start = first?.timeAndDuration?.startTime;
    const since = typeof start === 'string' ? Date.parse(start) : NaN;

    const type = raw.geometry?.type;
    const coords = raw.geometry?.coordinates;
    const lines: [number, number][][] = [];
    let anchor: [number, number] | null = null;

    if (type === 'Point') {
      anchor = point(coords);
    } else if (type === 'LineString' && Array.isArray(coords)) {
      const line = coords.map(point).filter((p): p is [number, number] => p !== null);
      if (line.length >= 2) {
        lines.push(line);
        anchor = line[0];
      }
    } else if (type === 'MultiLineString' && Array.isArray(coords)) {
      for (const part of coords) {
        if (!Array.isArray(part)) continue;
        const line = part.map(point).filter((p): p is [number, number] => p !== null);
        if (line.length >= 2) lines.push(line);
      }
      anchor = lines[0]?.[0] ?? null;
    }

    if (!anchor) continue;

    out.push({
      id,
      title,
      municipality,
      lon: anchor[0],
      lat: anchor[1],
      lines,
      since: Number.isFinite(since) ? since : null,
    });
  }
  return out;
}

/**
 * Every active road announcement in Finland.
 *
 * Throws rather than returning an empty list on a bad response: "nothing is
 * wrong on the roads" and "we could not ask" are different facts, and only the
 * first should be drawn as an empty map.
 */
export async function fetchIncidents(signal?: AbortSignal): Promise<Incident[]> {
  const res = await fetch(INCIDENTS_ENDPOINT, {
    signal,
    headers: { 'Digitraffic-User': DIGITRAFFIC_USER },
  });
  if (!res.ok) throw new Error(`traffic messages responded ${res.status}`);
  return parseIncidents(await res.json());
}
