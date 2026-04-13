/**
 * Street address geocoding via HSL Digitransit API.
 * Results are bounded to supported city regions and cached in memory (LRU, max 100 entries).
 */

const DIGITRANSIT_URL = 'https://api.digitransit.fi/geocoding/v1/search';
const MAX_CACHE_SIZE = 100;
const CACHE = new Map<string, GeocodeResult[]>();

export interface GeocodeResult {
  label: string;
  coordinates: [number, number]; // [lng, lat]
}

/** Geocode a street address or place name. Returns up to 5 results within supported city bboxes.
 *  Pass an AbortSignal to cancel in-flight requests when the query changes. */
export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  if (query.length < 3) return [];

  const cacheKey = query.toLowerCase().trim();
  const cached = CACHE.get(cacheKey);
  if (cached !== undefined) {
    // Move to most-recent position for proper LRU eviction
    CACHE.delete(cacheKey);
    CACHE.set(cacheKey, cached);
    return cached;
  }

  try {
    // Bounding box covering Helsinki metro, Turku, and Tampere
    const params = new URLSearchParams({
      text: query,
      size: '5',
      'boundary.rect.min_lon': '21.5',
      'boundary.rect.min_lat': '60.1',
      'boundary.rect.max_lon': '25.4',
      'boundary.rect.max_lat': '62.0',
      lang: 'fi',
    });

    const response = await fetch(`${DIGITRANSIT_URL}?${params}`, { signal });
    if (!response.ok) return [];

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
    return results;
  } catch {
    return [];
  }
}
