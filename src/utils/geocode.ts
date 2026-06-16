/**
 * Street address geocoding via the HSL Digitransit geocoding API (Pelias).
 * Results are bounded to a Finland-wide bounding box and cached in memory (LRU, max 100 entries).
 *
 * Requires a Digitransit subscription key, provided at build time as
 * VITE_DIGITRANSIT_API_KEY (the same key the isochrone feature uses; register free
 * at digitransit.fi). api.digitransit.fi rejects keyless requests, so without it
 * geocodeAddress short-circuits to [] and the search box degrades to name/postal-code
 * search only — no failing requests are fired.
 *
 * NOTE: this is a third-party request — each query (the user's typed text, possibly a
 * street/home address) is sent to Fintraffic/HSL Digitransit. Disclosed on the privacy
 * page. The key ships in the client bundle (unavoidable for a static app); it is free
 * and rate-limited, so a leaked key only risks quota throttling — rotate it if abused.
 */

const DIGITRANSIT_URL = 'https://api.digitransit.fi/geocoding/v1/search';
const KEY = (import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined)?.trim();
/** True when a Digitransit key was provided at build time (enables address search). */
export const GEOCODING_ENABLED = !!KEY;
const MAX_CACHE_SIZE = 100;
const CACHE = new Map<string, GeocodeResult[]>();

export interface GeocodeResult {
  label: string;
  coordinates: [number, number]; // [lng, lat]
}

/**
 * ER-1: distinguishes a genuine empty result ("no matches") from a failure
 * ("geocoder unreachable / throttled / malformed response") so the search box
 * can show a retryable "address search unavailable" notice instead of a
 * misleading "no results for {query}". `status: 'ok'` means the request
 * completed (even with zero matches, or when the feature is disabled / the
 * query is too short); `status: 'error'` means a network/HTTP/parse failure.
 */
export interface GeocodeOutcome {
  status: 'ok' | 'error';
  results: GeocodeResult[];
}

/** Geocode a street address or place name. Returns up to 5 results within a Finland-wide
 *  bbox. Resolves to [] on any failure (network error, non-OK response, abort) — it never
 *  throws — and failures are not cached, so the next call retries.
 *  Pass an AbortSignal to cancel in-flight requests when the query changes.
 *  Thin wrapper over {@link geocodeAddressDetailed} kept for back-compat callers/tests. */
export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  return (await geocodeAddressDetailed(query, signal)).results;
}

/** Like {@link geocodeAddress} but reports whether the lookup succeeded (ER-1).
 *  A short query or a keyless build resolves to `{ status: 'ok', results: [] }`
 *  (legitimately empty, not a failure); a network/HTTP/parse failure resolves to
 *  `{ status: 'error', results: [] }`, and errors are not cached so the next call retries. */
export async function geocodeAddressDetailed(query: string, signal?: AbortSignal): Promise<GeocodeOutcome> {
  if (query.length < 3) return { status: 'ok', results: [] };
  // Digitransit requires a subscription key; without it every request 401s, so skip.
  if (!KEY) return { status: 'ok', results: [] };

  const cacheKey = query.toLowerCase().trim();
  const cached = CACHE.get(cacheKey);
  if (cached !== undefined) {
    // Move to most-recent position for proper LRU eviction
    CACHE.delete(cacheKey);
    CACHE.set(cacheKey, cached);
    return { status: 'ok', results: cached };
  }

  try {
    // Bounding box covering all supported regions in Finland
    const params = new URLSearchParams({
      text: query,
      size: '5',
      'boundary.rect.min_lon': '19.5',
      'boundary.rect.min_lat': '59.5',
      'boundary.rect.max_lon': '31.5',
      'boundary.rect.max_lat': '70.5',
      lang: 'fi',
    });

    const response = await fetch(`${DIGITRANSIT_URL}?${params}`, {
      signal,
      headers: { 'digitransit-subscription-key': KEY },
    });
    // Non-OK (5xx, quota, auth) is a failure, not an empty result — and is not cached.
    if (!response.ok) return { status: 'error', results: [] };

    const data = await response.json();
    // Validate each feature shape before casting — a malformed Digitransit
    // response (null coordinates, non-numeric values, missing label) would
    // otherwise propagate invalid values into booleanPointInPolygon and
    // the map flyTo target, causing downstream crashes or silent wrong fits.
    const rawFeatures: unknown = Array.isArray(data?.features) ? data.features : [];
    const results: GeocodeResult[] = [];
    for (const rf of rawFeatures as unknown[]) {
      if (!rf || typeof rf !== 'object') continue;
      const props = (rf as { properties?: unknown }).properties;
      const geom = (rf as { geometry?: unknown }).geometry;
      const label = props && typeof props === 'object' ? (props as { label?: unknown }).label : undefined;
      const coords = geom && typeof geom === 'object' ? (geom as { coordinates?: unknown }).coordinates : undefined;
      if (typeof label !== 'string' || !label) continue;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const lng = coords[0];
      const lat = coords[1];
      if (typeof lng !== 'number' || typeof lat !== 'number' || !isFinite(lng) || !isFinite(lat)) continue;
      results.push({ label, coordinates: [lng, lat] });
    }

    if (CACHE.size >= MAX_CACHE_SIZE) {
      const oldest = CACHE.keys().next().value;
      if (oldest !== undefined) CACHE.delete(oldest);
    }
    CACHE.set(cacheKey, results);
    return { status: 'ok', results };
  } catch {
    // Network drop / abort / malformed JSON — a failure, not an empty result.
    // Not cached, so the next attempt retries. (Aborted calls are ignored by
    // the caller via signal.aborted, so flagging them 'error' here is harmless.)
    return { status: 'error', results: [] };
  }
}

// QW-3: point-in-polygon lookup of the neighborhood containing a coordinate.
// Lazy-loads the turf modules (cached after first use) so they stay out of the
// main bundle, and rejects candidates by their precomputed bbox first to avoid
// running the expensive polygon test on every feature. Mirrors the inline
// version in SearchBar so both the address search and "show my area"
// (geolocation) share one implementation.
let pipMods: {
  booleanPointInPolygon: typeof import('@turf/boolean-point-in-polygon').booleanPointInPolygon;
  point: typeof import('@turf/helpers').point;
} | null = null;

/** Find the feature whose polygon contains `coords` ([lng, lat]), or null when none
 *  does. Async because the turf modules are lazy-loaded on first call. */
export async function findNeighborhoodForPoint(
  coords: [number, number],
  features: GeoJSON.Feature[],
): Promise<GeoJSON.Feature | null> {
  if (!pipMods) {
    const [pip, helpers] = await Promise.all([
      import('@turf/boolean-point-in-polygon'),
      import('@turf/helpers'),
    ]);
    pipMods = { booleanPointInPolygon: pip.booleanPointInPolygon, point: helpers.point };
  }
  const { booleanPointInPolygon, point } = pipMods;
  const pt = point(coords);
  const [lng, lat] = coords;
  for (const feature of features) {
    if (!feature.geometry) continue;
    const bbox = feature.bbox;
    if (bbox && (lng < bbox[0] || lng > bbox[2] || lat < bbox[1] || lat > bbox[3])) continue;
    try {
      if (booleanPointInPolygon(pt, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)) {
        return feature;
      }
    } catch {
      continue;
    }
  }
  return null;
}
