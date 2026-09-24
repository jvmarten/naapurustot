/**
 * Multi-region postal-code view: which seutukunnat are on the map at once.
 *
 * The app's region state is a PRIMARY region (`city`, or 'all' for the national
 * view) plus any `extra` regions displayed alongside it — e.g. Helsinki with Lahti
 * added from the "switch / show both" prompt. The primary still owns everything
 * that is inherently single-region (planning overlay, the CitySelector value); the
 * extras only contribute their postal-code areas to the one merged dataset.
 *
 * Kept pure (no React, no fetch) so the state transitions, URL codec and data merge
 * are unit-tested rather than living as untested branches inside App.tsx.
 */

import type { FeatureCollection, Feature } from 'geojson';
import type { CityFilter } from '../components/CitySelector';
import type { ProcessedData } from './dataLoader';
import { computeMetroAverages } from './metrics';
import { REGION_IDS, type RegionId } from './regions';
import { CITY_VIEWPORTS } from './mapConstants';

export interface RegionSelection {
  city: CityFilter;
  extra: RegionId[];
}

/** Shared empty list, so a state that is already single-region keeps its identity. */
export const NO_REGIONS: RegionId[] = [];

/**
 * Reducer action: a bare CityFilter switches to exactly that view (dropping any added
 * regions — every pre-existing "switch region" path keeps its single-region meaning),
 * `{ add }` puts a region alongside the current ones, `{ remove }` takes one off.
 */
export type RegionAction = CityFilter | { add: RegionId } | { remove: RegionId };

export function regionReducer(s: RegionSelection, a: RegionAction): RegionSelection {
  if (typeof a === 'string') {
    return s.city === a && s.extra.length === 0 ? s : { city: a, extra: NO_REGIONS };
  }
  if ('add' in a) {
    const r = a.add;
    if (s.city === 'all' || s.city === r || s.extra.includes(r)) return s;
    return { city: s.city, extra: [...s.extra, r] };
  }
  const r = a.remove;
  if (r === s.city) {
    // Removing the primary promotes the first added region; the last region can't go.
    return s.extra.length ? { city: s.extra[0], extra: s.extra.slice(1) } : s;
  }
  return s.extra.includes(r) ? { city: s.city, extra: s.extra.filter((x) => x !== r) } : s;
}

/** Regions whose postal-code areas are on the map, primary first ([] for 'all'). */
export function displayedRegions(s: RegionSelection): RegionId[] {
  return s.city === 'all' ? NO_REGIONS : [s.city, ...s.extra];
}

/**
 * Stable string identity of the displayed set — the `city` URL value and the key every
 * region-keyed effect depends on: 'all', 'lahti', or 'helsinki_metro,lahti'.
 */
export function regionKey(s: RegionSelection): string {
  return s.city === 'all' ? 'all' : [s.city, ...s.extra].join(',');
}

const REGION_ID_SET = new Set<string>(REGION_IDS);

/**
 * Parse a `city` URL value. A single id (or 'all') behaves exactly as it always has; a
 * comma list is primary-first, with unknown and repeated ids dropped. An invalid primary
 * falls through to the next valid id rather than discarding the whole list.
 */
export function parseCityParam(raw: string | null): { city: CityFilter | null; extra: RegionId[] } {
  if (!raw) return { city: null, extra: NO_REGIONS };
  if (raw === 'all') return { city: 'all', extra: NO_REGIONS };
  const ids = [...new Set(raw.split(',').filter((c) => REGION_ID_SET.has(c)))] as RegionId[];
  if (ids.length === 0) return { city: null, extra: NO_REGIONS };
  return { city: ids[0], extra: ids.length > 1 ? ids.slice(1) : NO_REGIONS };
}

/** Camera target framing every displayed region: the union of their preset bounds. */
export function regionsViewport(regions: readonly string[]): { center: [number, number]; zoom?: number; bounds: [number, number, number, number] } | null {
  let b: [number, number, number, number] | null = null;
  for (const r of regions) {
    const vb = CITY_VIEWPORTS[r]?.bounds;
    if (!vb) continue;
    b = b
      ? [Math.min(b[0], vb[0]), Math.min(b[1], vb[1]), Math.max(b[2], vb[2]), Math.max(b[3], vb[3])]
      : [...vb];
  }
  return b ? { center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], bounds: b } : null;
}

/**
 * Merge several loaded regions into one dataset. Postal codes are unique nationally,
 * so a plain concatenation is id-safe for the map's `promoteId: 'pno'`. The averages
 * are recomputed over the merged features — averaging the per-region averages would
 * be wrong for every ratio metric (unemployment = Σ unemployed / Σ labour force).
 * The feature objects stay shared with dataLoader's per-region cache; that is fine
 * because the multi-region view always scores against the national ranges, where an
 * area's score depends on nothing but its own values.
 */
export function mergeRegionData(results: ProcessedData[]): ProcessedData {
  const features = results.flatMap((r) => r.data.features);
  const data: FeatureCollection = { type: 'FeatureCollection', features };
  return { data, metroAverages: computeMetroAverages(features) };
}

/**
 * Per-region averages over a merged dataset, keyed by region id (each feature's
 * `city`). With several regions on the map, "vs. seutu" must still mean the area's
 * OWN seutukunta, not a blend of Helsinki and Lahti.
 */
export function averagesByRegion(features: Feature[]): Record<string, Record<string, number>> {
  const groups: Record<string, Feature[]> = {};
  for (const f of features) {
    const c = f.properties?.city;
    if (typeof c === 'string') (groups[c] ??= []).push(f);
  }
  const out: Record<string, Record<string, number>> = {};
  for (const c in groups) out[c] = computeMetroAverages(groups[c]);
  return out;
}
