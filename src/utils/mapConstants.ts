/**
 * Map initial viewport defaults, configurable via VITE_MAP_* environment variables.
 * Fallback values center on the Helsinki metropolitan area.
 *
 * Per-region viewports are derived from the region configuration in regions.ts.
 */

import { REGIONS, REGION_IDS, ALL_FINLAND_VIEWPORT, type RegionId } from './regions';

/** Read a numeric env var at build time, returning `fallback` if unset or non-numeric. */
export function envNum(key: string, fallback: number): number {
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

export const MAP_MIN_ZOOM = envNum('VITE_MAP_MIN_ZOOM', 2);
export const MAP_MAX_ZOOM = envNum('VITE_MAP_MAX_ZOOM', 16);

/** Per-city/region viewport configurations, derived from REGIONS config. */
export const CITY_VIEWPORTS: Record<string, { center: [number, number]; zoom: number; bounds: [number, number, number, number] }> = Object.fromEntries([
  ...REGION_IDS.map((id: RegionId) => [
    id,
    { center: REGIONS[id].center, zoom: REGIONS[id].zoom, bounds: REGIONS[id].bounds },
  ]),
  ['all', { center: ALL_FINLAND_VIEWPORT.center, zoom: ALL_FINLAND_VIEWPORT.zoom, bounds: ALL_FINLAND_VIEWPORT.bounds }],
]);
