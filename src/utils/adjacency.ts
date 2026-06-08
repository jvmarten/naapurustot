// CF-12: spatial-neighbour (adjacency) lookup — "the cheaper area next door".
//
// The adjacency graph (pno -> [neighbour pnos]) is precomputed at data-build
// time from the region TopoJSON arc-sharing (shared arcs encode shared borders)
// and shipped as a static JSON asset. Loaded lazily via fetch on first use so it
// never weighs on the initial bundle, then cached.
//
// For any postal code missing from the graph (e.g. a feature loaded but absent
// from the committed artifact), a lazy @turf/booleanIntersects shared-border test
// against the loaded features is used as a fallback so the panel still works.

import type { NeighborhoodProperties } from './metrics';

// Vite emits the JSON as a static asset and gives us its hashed URL; we fetch it
// (rather than importing the object) so its ~28 KB gzip stays out of every JS
// chunk — matching how region_properties.json is loaded.
import adjacencyUrl from '../data/adjacency.json?url';

type AdjacencyGraph = Record<string, string[]>;

let graphCache: Promise<AdjacencyGraph> | null = null;

/** Lazily fetch and cache the precomputed adjacency graph. */
export function loadAdjacencyGraph(): Promise<AdjacencyGraph> {
  if (graphCache) return graphCache;
  graphCache = fetch(adjacencyUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load adjacency: ${res.status}`);
      return res.json() as Promise<AdjacencyGraph>;
    })
    .catch((err) => {
      graphCache = null; // evict so a later call can retry
      throw err;
    });
  return graphCache;
}

/**
 * Lazy @turf/booleanIntersects fallback: a postal code missing from the graph
 * is matched against the other loaded features by testing for a shared border
 * (geometries that intersect but aren't the target). Bounding-box prefiltering
 * keeps this cheap even though booleanIntersects itself is O(vertices).
 */
async function computeNeighborsFromGeometry(
  target: GeoJSON.Feature,
  allFeatures: GeoJSON.Feature[],
): Promise<string[]> {
  if (!target.geometry) return [];
  const { booleanIntersects } = await import('@turf/boolean-intersects');

  const [minX, minY, maxX, maxY] = bboxOf(target.geometry);
  const neighbors: string[] = [];
  for (const f of allFeatures) {
    const pno = (f.properties as NeighborhoodProperties | null)?.pno;
    if (!pno || !f.geometry) continue;
    if (pno === (target.properties as NeighborhoodProperties | null)?.pno) continue;
    // Cheap bbox reject before the expensive polygon-intersection test.
    const [bMinX, bMinY, bMaxX, bMaxY] = bboxOf(f.geometry);
    if (bMaxX < minX || bMinX > maxX || bMaxY < minY || bMinY > maxY) continue;
    if (booleanIntersects(target as GeoJSON.Feature, f as GeoJSON.Feature)) {
      neighbors.push(pno);
    }
  }
  return neighbors.sort();
}

/** Lightweight bbox for a (Multi)Polygon geometry — avoids pulling in @turf/bbox. */
function bboxOf(geom: GeoJSON.Geometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (typeof (coords as number[])[0] === 'number') {
      const [x, y] = coords as number[];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      return;
    }
    for (const c of coords as unknown[]) visit(c);
  };
  if ('coordinates' in geom) visit(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

/** Set of every pno present in the loaded feature set. */
function presentPnos(allFeatures: GeoJSON.Feature[]): Set<string> {
  const present = new Set<string>();
  for (const f of allFeatures) {
    const pno = (f.properties as NeighborhoodProperties | null)?.pno;
    if (pno) present.add(pno);
  }
  return present;
}

/**
 * Pure graph lookup: the precomputed neighbours of `pno`, filtered to PNOs that
 * actually exist in the loaded feature set (so every chip resolves to a clickable
 * area). Returns null when the pno is absent from the graph, signalling that the
 * caller should fall back to a geometric test. Exported for unit testing.
 */
export function neighborsFromGraph(
  graph: AdjacencyGraph,
  pno: string,
  allFeatures: GeoJSON.Feature[],
): string[] | null {
  const neighbors = graph[pno];
  if (!neighbors) return null;
  const present = presentPnos(allFeatures);
  return neighbors.filter((p) => present.has(p));
}

/**
 * Resolve the neighbouring postal codes of a target area. Returns the precomputed
 * graph entry when present; otherwise falls back to a geometric shared-border test
 * over the loaded features. The result is filtered to PNOs that actually exist in
 * the loaded feature set (so chips always resolve to a clickable area).
 *
 * @returns sorted neighbour PNOs (may be empty for islands / disconnected areas)
 */
export async function resolveNeighborPnos(
  target: NeighborhoodProperties,
  allFeatures: GeoJSON.Feature[],
): Promise<string[]> {
  let fromGraph: string[] | null = null;
  try {
    const graph = await loadAdjacencyGraph();
    fromGraph = neighborsFromGraph(graph, target.pno, allFeatures);
  } catch {
    fromGraph = null; // graph unavailable — fall through to geometry
  }
  if (fromGraph) return fromGraph;

  const targetFeature = allFeatures.find(
    (f) => (f.properties as NeighborhoodProperties | null)?.pno === target.pno,
  );
  if (!targetFeature) return [];
  try {
    const geo = await computeNeighborsFromGeometry(targetFeature, allFeatures);
    const present = presentPnos(allFeatures);
    return geo.filter((p) => present.has(p));
  } catch {
    return [];
  }
}
