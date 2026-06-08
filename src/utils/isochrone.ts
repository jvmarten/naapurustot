/**
 * CF-5: travel-time isochrones via the Digitransit Routing API (OpenTripPlanner).
 *
 * Requires a Digitransit subscription key, provided at build time as
 * VITE_DIGITRANSIT_API_KEY (register free at digitransit.fi). When the key is
 * absent the feature degrades gracefully — `ISOCHRONE_ENABLED` is false and the
 * UI hides the controls entirely, so no broken buttons or failing requests ship.
 *
 * Results are cached per pno+mode+budget in sessionStorage to keep repeat
 * scrubbing off the network.
 */
import type { Feature, Polygon, MultiPolygon } from 'geojson';

const KEY = (import.meta.env.VITE_DIGITRANSIT_API_KEY as string | undefined)?.trim();
// 'finland' covers the whole country; 'hsl'/'waltti' are region-specific routers.
const ROUTER = (import.meta.env.VITE_DIGITRANSIT_ROUTER as string | undefined)?.trim() || 'finland';

/** True when a Digitransit key was provided at build time. */
export const ISOCHRONE_ENABLED = !!KEY;

export type IsochroneMode = 'walk' | 'bike' | 'transit';
export const ISOCHRONE_MODES: IsochroneMode[] = ['walk', 'bike', 'transit'];
export const ISOCHRONE_BUDGETS = [10, 20, 30, 45] as const;

const MODE_PARAM: Record<IsochroneMode, string> = {
  walk: 'WALK',
  bike: 'BICYCLE',
  transit: 'TRANSIT,WALK',
};

const BASE = `https://api.digitransit.fi/routing/v1/routers/${ROUTER}/isochrone`;

type IsoFeature = Feature<Polygon | MultiPolygon>;

/**
 * Discriminated fetch outcome so callers can tell a genuine failure (network
 * throw, non-OK HTTP) from a legitimately empty result. `ok: true` with a null
 * feature means "no reachable area / nothing to overlay" (not an error);
 * `ok: false` means the request failed and a retry affordance is warranted.
 */
export type IsochroneResult =
  | { ok: true; feature: IsoFeature | null }
  | { ok: false };

function cacheKey(pno: string, mode: IsochroneMode, budget: number): string {
  return `isochrone:${pno}:${mode}:${budget}`;
}

/**
 * Fetch (or return cached) reachable-area polygon for a neighborhood centroid.
 * Returns a discriminated result: `{ ok: false }` on a network/HTTP failure,
 * `{ ok: true, feature }` otherwise — where `feature` is null for a missing
 * key, non-finite coords, or a legitimately empty response.
 */
export async function fetchIsochrone(
  pno: string,
  lng: number,
  lat: number,
  mode: IsochroneMode,
  budgetMinutes: number,
): Promise<IsochroneResult> {
  if (!ISOCHRONE_ENABLED || !isFinite(lng) || !isFinite(lat)) return { ok: true, feature: null };

  const key = cacheKey(pno, mode, budgetMinutes);
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) return { ok: true, feature: JSON.parse(cached) as IsoFeature };
  } catch { /* sessionStorage unavailable */ }

  const params = new URLSearchParams({
    fromPlace: `${lat},${lng}`,
    mode: MODE_PARAM[mode],
    cutoffSec: String(budgetMinutes * 60),
  });

  try {
    const res = await fetch(`${BASE}?${params.toString()}`, {
      headers: { 'digitransit-subscription-key': KEY as string },
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    const feat = data?.features?.[0];
    const geom = feat?.geometry;
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return { ok: true, feature: null };
    const result: IsoFeature = { type: 'Feature', properties: { mode, budget: budgetMinutes }, geometry: geom };
    try { sessionStorage.setItem(key, JSON.stringify(result)); } catch { /* quota */ }
    return { ok: true, feature: result };
  } catch {
    return { ok: false };
  }
}
