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

/** Per-city viewport configurations. All use `bounds` so the view adapts to any screen size. */
export const CITY_VIEWPORTS: Record<string, { center: [number, number]; zoom: number; bounds: [number, number, number, number] }> = {
  helsinki_metro: { center: [24.94, 60.17], zoom: 9.2, bounds: [24.5, 60.05, 25.4, 60.4] },
  turku: { center: [22.20, 60.50], zoom: 9, bounds: [21.5, 60.25, 22.9, 60.75] },
  tampere: { center: [23.85, 61.55], zoom: 8.5, bounds: [23.1, 61.2, 25.0, 62.2] },
  all: { center: [24.0, 61.0], zoom: 6, bounds: [20.5, 59.5, 26.5, 62.5] },
};
