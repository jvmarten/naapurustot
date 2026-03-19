const DIGITRANSIT_URL = 'https://api.digitransit.fi/geocoding/v1/search';
const CACHE = new Map<string, GeocodeResult[]>();

export interface GeocodeResult {
  label: string;
  coordinates: [number, number]; // [lng, lat]
}

export async function geocodeAddress(query: string): Promise<GeocodeResult[]> {
  if (query.length < 3) return [];

  const cacheKey = query.toLowerCase().trim();
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey)!;

  try {
    const params = new URLSearchParams({
      text: query,
      size: '5',
      'boundary.rect.min_lon': '24.5',
      'boundary.rect.min_lat': '60.1',
      'boundary.rect.max_lon': '25.3',
      'boundary.rect.max_lat': '60.5',
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

    CACHE.set(cacheKey, results);
    return results;
  } catch {
    return [];
  }
}
