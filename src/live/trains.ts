/**
 * Live train positions for /live/ — the first feed on the page that is actually
 * realtime rather than computed.
 *
 * Source: Fintraffic's Digitraffic railway API, open data under CC BY 4.0, no
 * API key. Positions come off the trains' own GPS and update about once a
 * second.
 *
 *   https://rata.digitraffic.fi/api/v1/train-locations/latest/
 *
 * WHY THIS AS THE FIRST NON-SUN FEED. The sun layer is exact everywhere in
 * Finland but the BUILDINGS it casts against are a Helsinki rectangle, so the
 * page's only feed is effectively urban. This one is national by construction —
 * every train running in the country, from Helsinki to Kolari — which is the
 * coverage the rest of the app holds itself to. It is also the cheapest live
 * source measured: the whole national set is 111 features and 2.4 kB gzipped,
 * against 224 kB of GML for one small bbox of FMI observations.
 *
 * THE WHOLE COUNTRY IS FETCHED, NOT THE VIEWPORT, even though the endpoint takes
 * a `bbox`. At 2.4 kB the national set costs nothing worth optimising, and
 * scoping it to the camera would cost the thing that matters: a viewport query
 * has to re-run on every pan, turning a fixed 5-second poll into a request per
 * camera move, and trains would pop in a beat after the map settles instead of
 * being there already. Filtering the national set at draw time is free.
 *
 * WHAT IS NOT HERE: the train's type and destination. `train-locations` carries
 * the number and nothing else, and the per-train endpoint that would name it
 * (`/api/v1/trains/latest/{number}`) is 38.8 kB PER TRAIN of timetable rows —
 * a hundred of those per poll to label a hundred dots. `train_categories` is not
 * a parameter this endpoint accepts (it answers 400). So the map shows the
 * number, the speed and the age of the fix, which is what the feed actually
 * knows. Inferring "IC" from a number range would be guessing, and this project
 * does not put guessed values on the map.
 *
 * NO INTERPOLATION BETWEEN FIXES. A dot could be dead-reckoned along its heading
 * between polls and would look smoother, but the position it drew would be a
 * position nobody measured — the same category of thing as a fabricated data
 * value, and on a page whose whole design is about saying which numbers are
 * measured. Trains move when the feed says they moved.
 */

/** One train's last reported position. */
export interface Train {
  /** Fintraffic's train number. Unique per departure date, not globally. */
  number: number;
  lon: number;
  lat: number;
  /** Reported ground speed in km/h, or null when the feed omitted it. */
  speed: number | null;
  /** When the position was measured, ms since the epoch, or null if unparseable. */
  at: number | null;
}

export const TRAINS_ENDPOINT = 'https://rata.digitraffic.fi/api/v1/train-locations/latest/';

/**
 * How often we ask, in ms.
 *
 * The endpoint sends `cache-control: max-age=1` and the underlying fixes arrive
 * about once a second, so this is a choice about politeness rather than about
 * staleness. At 200 km/h a train covers 278 m between polls, which is 28 px at
 * z13 — a visible step, but a step in the right place. Halving it to smooth that
 * out would double the load on a free shared endpoint to buy an animation, and
 * the polling stops entirely while the tab is hidden (see LivePage) so an
 * abandoned tab costs nothing at all.
 */
export const TRAIN_POLL_MS = 5_000;

/**
 * Past this age a fix is drawn hollow rather than solid.
 *
 * A train in a tunnel, in a yard, or with a sick GPS keeps its last position in
 * the feed indefinitely, so a solid dot would claim a train is sitting on a
 * stretch of track it left twenty minutes ago. Two minutes is well past a normal
 * gap between fixes and well short of the time it takes for the position to
 * become fiction.
 */
export const TRAIN_STALE_MS = 120_000;

/**
 * Client identification, which Fintraffic asks every caller to send.
 *
 * This is a custom header on a cross-origin GET, so it triggers a CORS
 * preflight — but the endpoint answers the preflight with
 * `access-control-max-age: 86400`, so the browser pays one extra request a day,
 * not one per poll. Verified against the live endpoint; `Digitraffic-User` is
 * named explicitly in its `access-control-allow-headers`.
 */
const DIGITRAFFIC_USER = 'naapurustot.fi/live';

interface RawTrain {
  trainNumber?: unknown;
  speed?: unknown;
  timestamp?: unknown;
  location?: { coordinates?: unknown } | null;
}

/** A finite number, or null. Rejects NaN, Infinity, strings and nullish. */
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Turn the endpoint's payload into trains, dropping anything malformed.
 *
 * Split out from the fetch so it can be tested without a network, and strict
 * about coordinates for a specific reason: a feature with a missing or swapped
 * coordinate does not fail visibly, it puts a train in the Gulf of Guinea. The
 * bounds check is generous — this is a Finnish feed, but the guard is against
 * garbage, not against a train being somewhere surprising.
 */
export function parseTrains(payload: unknown): Train[] {
  if (!Array.isArray(payload)) {
    throw new Error('train locations: expected an array');
  }

  const out: Train[] = [];
  for (const raw of payload as RawTrain[]) {
    const number = finite(raw?.trainNumber);
    if (number === null) continue;

    const coords = raw?.location?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = finite(coords[0]);
    const lat = finite(coords[1]);
    if (lon === null || lat === null) continue;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;

    const at = typeof raw.timestamp === 'string' ? Date.parse(raw.timestamp) : NaN;

    out.push({
      number,
      lon,
      lat,
      speed: finite(raw.speed),
      at: Number.isFinite(at) ? at : null,
    });
  }
  return out;
}

/**
 * Every train currently running in Finland.
 *
 * Throws rather than returning an empty list on a bad response: "no trains are
 * running" and "we could not ask" are different facts, and only the first one
 * should ever be drawn as an empty map. The caller reports the difference.
 *
 * Note for anyone calling this outside a browser: the endpoint answers 406 to a
 * request that does not accept gzip. Browsers always send `Accept-Encoding`
 * themselves and it is a forbidden header name, so there is nothing to set here
 * — but a bare `curl` or a Node fetch without it will look like a broken API.
 */
export async function fetchTrains(signal?: AbortSignal): Promise<Train[]> {
  const res = await fetch(TRAINS_ENDPOINT, {
    signal,
    headers: { 'Digitraffic-User': DIGITRAFFIC_USER },
  });
  if (!res.ok) throw new Error(`train locations responded ${res.status}`);
  return parseTrains(await res.json());
}
