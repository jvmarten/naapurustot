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
const MAP_ZOOM = envNum('VITE_MAP_ZOOM', 10.5);

/** Initial map center as [longitude, latitude]. */
export const DEFAULT_CENTER: [number, number] = [MAP_CENTER_LNG, MAP_CENTER_LAT];

/** Initial map zoom level. */
export const DEFAULT_ZOOM = MAP_ZOOM;

/** Initial map zoom level for mobile devices (narrower viewport needs lower zoom). */
export const DEFAULT_MOBILE_ZOOM = envNum('VITE_MAP_MOBILE_ZOOM', 9.2);

/** Returns the appropriate initial zoom based on viewport width. */
export function getInitialZoom(): number {
  return typeof window !== 'undefined' && window.innerWidth < 768
    ? DEFAULT_MOBILE_ZOOM
    : DEFAULT_ZOOM;
}
