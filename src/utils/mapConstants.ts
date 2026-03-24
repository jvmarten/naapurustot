/**
 * Map initial viewport defaults, configurable via VITE_MAP_* environment variables.
 * Fallback values center on the Helsinki metropolitan area.
 */

/** Read a numeric env var at build time, returning `fallback` if unset or non-numeric. */
function envNum(key: string, fallback: number): number {
  const raw = import.meta.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return isFinite(n) ? n : fallback;
}

const MAP_CENTER_LNG = envNum('VITE_MAP_CENTER_LNG', 24.94);
const MAP_CENTER_LAT = envNum('VITE_MAP_CENTER_LAT', 60.17);
const MAP_ZOOM = envNum('VITE_MAP_ZOOM', 9.2);

/** Initial map center as [longitude, latitude]. */
export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];

/** Initial map zoom level. */
export const DEFAULT_ZOOM = MAP_ZOOM;

/** Returns the initial zoom level. */
export function getInitialZoom(): number {
  return DEFAULT_ZOOM;
}

/** Per-city viewport configurations. Use `bounds` for views that should fit to an area. */
export const CITY_VIEWPORTS: Record<string, { center: [number, number]; zoom: number; bounds?: [number, number, number, number] }> = {
  helsinki_metro: { center: [24.94, 60.17], zoom: 9.2 },
  turku: { center: [22.27, 60.45], zoom: 9.8 },
  all: { center: [23.5, 60.4], zoom: 7, bounds: [21.8, 59.9, 25.5, 60.9] },
};
