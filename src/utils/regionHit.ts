/**
 * Seutukunta (sub-region) outlines at runtime, and "which region is this point in?".
 *
 * The outline file is the same pre-baked `seutukunnat.topojson` the map draws its faint
 * Finland-wide boundary line from. It is loaded once (module cache, shared by the main
 * map and every caller here) and kept around as a parsed FeatureCollection so a tap on
 * the map can be resolved to a region synchronously — no extra hit-test layer, no async
 * turf import on the click path.
 */

import type { FeatureCollection, Position } from 'geojson';
import { feature as topoFeature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import seutukunnatUrl from '../data/seutukunnat.topojson?url';

let outlinesPromise: Promise<FeatureCollection | null> | null = null;
let outlines: FeatureCollection | null = null;

/** Fetch + parse the 69 region outlines once. Resolves null on failure (and retries next call). */
export function loadRegionOutlines(): Promise<FeatureCollection | null> {
  if (!outlinesPromise) {
    outlinesPromise = fetch(seutukunnatUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`seutukunnat boundaries: ${res.status}`);
        return res.json() as Promise<Topology>;
      })
      .then((topo) => {
        const objName = Object.keys(topo.objects ?? {})[0];
        if (!objName) return null;
        outlines = topoFeature(topo, topo.objects[objName]) as FeatureCollection;
        return outlines;
      })
      .catch((err) => {
        console.warn('[regions] failed to load seutukunta boundaries', err);
        outlinesPromise = null;
        return null;
      });
  }
  return outlinesPromise;
}

/** The outlines if they have already loaded, else null (never triggers a fetch). */
export function getRegionOutlines(): FeatureCollection | null {
  return outlines;
}

/** Even-odd ray cast against one ring. */
function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The `region` id of the outline containing [lng, lat], or null (sea, abroad). Holes
 * are honoured (a point is inside a polygon when an odd number of its rings contain
 * it). A linear scan: ~65k vertices across 69 regions is well under a millisecond, and
 * this runs on a discrete tap, never per animation frame.
 */
export function regionAt(fc: FeatureCollection | null, lng: number, lat: number): string | null {
  if (!fc) return null;
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      let inside = false;
      for (const ring of poly) if (ringContains(ring, lng, lat)) inside = !inside;
      if (inside) {
        const r = f.properties?.region;
        return typeof r === 'string' ? r : null;
      }
    }
  }
  return null;
}
