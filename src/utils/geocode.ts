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

/** Geocode a street address or place name. Returns up to 5 results within supported city bboxes. */
export async function geocodeAddress(query: string): Promise<GeocodeResult[]> {
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
    // Bounding box covering Helsinki metro + Turku
    const params = new URLSearchParams({
      text: query,
      size: '5',
      'boundary.rect.min_lon': '22.0',
      'boundary.rect.min_lat': '60.1',
      'boundary.rect.max_lon': '25.3',
      'boundary.rect.max_lat': '60.6',
      lang: 'fi',
    });

    const response = await fetch(`${DIGITRANSIT_URL}?${params}`);
    if (!response.ok) return [];

    const data = await response.json();
    const results: GeocodeResult[] = (data.features ?? []).map(
      (f: { properties: { label: string }; geometry: { coordinates: [number, number] } }) => ({
        label: f.properties.label,
        coordinates: f.geometry.coordinates as [number, number],
      }),
    );

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
