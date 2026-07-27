import { useState, useEffect, useRef } from 'react';
import type { Feature, FeatureCollection, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { LayerId } from '../utils/colorScales';
import gridManifest from '../data/grid_manifest.json';

/**
 * Manifest-driven discovery of fine-grained grid datasets (IN-1).
 *
 * scripts/build_grid_data.mjs scans public/data/ for built grid files and emits
 * src/data/grid_manifest.json, mapping each LayerId to its served file path,
 * format, bbox, cell count, and coverage scope. This hook reads that manifest
 * instead of a hardcoded path registry, so adding/removing a grid is a data-only
 * change and partial coverage ("regional") is explicit rather than a silent
 * choropleth fallback. Files are still fetched lazily the first time a grid layer
 * is shown; a missing/failed fetch falls back to the postal choropleth.
 */
const BASE = import.meta.env.BASE_URL ?? '/';

/** One grid layer's entry in grid_manifest.json. */
export interface GridManifestEntry {
  /** Served file path relative to the deploy base (e.g. "data/air_quality_grid.topojson") */
  path: string;
  format: 'topojson' | 'geojson';
  /** [minLon, minLat, maxLon, maxLat] of the grid's coverage */
  bbox: [number, number, number, number];
  /** Number of grid cells */
  cells: number;
  /** "national" = covers (most of) Finland; "regional" = a limited area only */
  scope: 'national' | 'regional';
  /** CF-9: for national grids, a path TEMPLATE with a `{region}` placeholder. A
   *  region session fetches only that region's shard instead of the whole nationwide
   *  grid; a missing shard falls back to the whole file. Stored as one string (not a
   *  per-region map) to keep the statically-imported manifest tiny in the JS bundle. */
  shardPattern?: string;
}

const GRID_MANIFEST = gridManifest as unknown as Record<string, GridManifestEntry>;

/** Returns true if the layer has a built grid dataset in the manifest. */
export function hasGridData(layerId: LayerId): boolean {
  return (layerId as string) in GRID_MANIFEST;
}

/** Returns the grid manifest entry (path, format, bbox, cells, coverage scope) for a layer, or undefined. */
export function getGridInfo(layerId: LayerId): GridManifestEntry | undefined {
  return GRID_MANIFEST[layerId as string];
}

/**
 * True when a grid dataset actually has cells to draw.
 *
 * UX CF-1: the region clips below (`clipGridToData` and App's point-in-polygon
 * refine) return `{...grid, features: []}` — a *non-null* FeatureCollection —
 * when a regional grid (air quality, transit reachability: Helsinki bbox only)
 * is viewed from another region. Treating that as "the grid is active" swapped
 * the postal choropleth to the fade-out opacity ramp and drained the whole map
 * to bare basemap at every region preset zoom, hiding postal data that exists
 * nationally. Gate on cell count, never on object identity.
 */
export function hasGridCells(grid: FeatureCollection | null | undefined): boolean {
  return !!grid && grid.features.length > 0;
}

/**
 * IN-2: centroid of a grid cell, used to decide whether the cell belongs to the
 * loaded region. Grid cells are small (~250 m) axis-aligned rectangles, so the
 * bbox midpoint of the outer ring is an exact, allocation-free stand-in for a
 * true polygon centroid. Returns null for cells without a usable ring.
 */
export function cellCentroid(f: Feature): [number, number] | null {
  const ring = (f.geometry as { coordinates?: Position[][] } | undefined)?.coordinates?.[0];
  if (!ring || ring.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * IN-1: synchronous bbox clip of a grid to the loaded region's extent. Keeps a
 * region-scoped view (e.g. Helsinki Metro) from leaking grid cells from other
 * regions, mirroring the App-level stage-1 clip. Cheap (single bbox pass over
 * `data`, then a centroid bbox test per cell) so it is safe to run on render —
 * SplitMapView uses it for both panes instead of duplicating App's heavier
 * point-in-polygon refinement. Returns `grid` unchanged when either input is null.
 */
export function clipGridToData(
  grid: FeatureCollection | null,
  data: FeatureCollection | null,
): FeatureCollection | null {
  if (!grid || !data) return grid;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const feat of data.features) {
    const g = feat.geometry;
    const multi = g?.type === 'MultiPolygon' ? g.coordinates : g?.type === 'Polygon' ? [g.coordinates] : null;
    if (!multi) continue;
    for (const poly of multi) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }
  if (!isFinite(minX)) return grid;
  const features = grid.features.filter((f) => {
    const c = cellCentroid(f);
    if (!c) return false;
    return c[0] >= minX && c[0] <= maxX && c[1] >= minY && c[1] <= maxY;
  });
  return { ...grid, features };
}

interface GridDataState {
  gridData: FeatureCollection | null;
  loading: boolean;
  /** E2: true when the grid file failed to load — the choropleth falls back to
   *  coarse postal data, so the UI must stop asserting grid-level detail. */
  error: boolean;
}

function parseGridResponse(path: string, json: unknown): FeatureCollection {
  if (path.endsWith('.topojson')) {
    const topo = json as Topology;
    const objectName = Object.keys(topo.objects ?? {})[0];
    if (!objectName) throw new Error('Invalid grid TopoJSON: no objects');
    const decoded = feature(topo, topo.objects[objectName]);
    if (decoded.type !== 'FeatureCollection') {
      throw new Error(`Invalid grid TopoJSON: expected FeatureCollection, got ${decoded.type}`);
    }
    return decoded;
  }
  return json as FeatureCollection;
}

/**
 * Lazily loads fine-grained grid data for a given layer.
 *
 * Returns null gridData when the active layer has no grid source,
 * while data is still loading, or if the grid file doesn't exist.
 * Once loaded, the FeatureCollection is cached in memory.
 */
// CF-9: cap how many grid datasets stay in memory. A nationwide grid is tens of MB
// parsed; without eviction the cache pinned every grid ever viewed for the session.
const GRID_LRU_CAP = 2;

export function useGridData(activeLayer: LayerId, cityFilter?: string): GridDataState {
  const [cache, setCache] = useState<Record<string, FeatureCollection>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Track which cache keys have been fetched (or are in-flight) to avoid
  // re-triggering the effect when cache state updates.
  const fetchedRef = useRef<Set<string>>(new Set());
  // CF-9: insertion order of cache keys for LRU eviction.
  const lruRef = useRef<string[]>([]);

  const entry = GRID_MANIFEST[activeLayer as string];
  // CF-9: for a national grid in a region-scoped session, fetch only that region's
  // shard. Falls back to the whole file for ?city=all or when no shard exists.
  const shardRel = cityFilter && cityFilter !== 'all' && entry?.shardPattern
    ? entry.shardPattern.replace('{region}', cityFilter)
    : undefined;
  const wholePath = entry ? BASE + entry.path : undefined;
  const path = shardRel ? BASE + shardRel : wholePath;
  const cacheKey = entry ? `${activeLayer}:${shardRel ? cityFilter : 'all'}` : '';

  useEffect(() => {
    if (!path || !cacheKey || !wholePath) return;
    const fetched = fetchedRef.current;
    if (fetched.has(cacheKey)) {
      // Already fetched/cached (or a prior in-flight fetch is still tracked): clear
      // any stale loading flag left by a cancelled fetch of a different key.
      setLoading(false);
      return;
    }
    fetched.add(cacheKey);

    let cancelled = false;
    let completed = false;
    setLoading(true);
    setError(false);

    // Abort the (potentially tens-of-MB) in-flight fetch when the effect is torn
    // down — e.g. the user switches layers mid-load — so its bandwidth isn't wasted.
    const controller = new AbortController();

    // CF-9: try the region shard; if it is missing (a region with no cells in this
    // grid), fall back to the whole nationwide file so the layer still renders.
    const fetchJson = (url: string) =>
      fetch(url, { signal: controller.signal }).then((res) => {
        if (!res.ok) throw new Error(`Grid data fetch failed: ${res.status}`);
        return res.json();
      });
    (path === wholePath
      ? fetchJson(path)
      : fetchJson(path).catch((err) => {
          // If the shard fetch was aborted (cleanup runs before this rejects),
          // don't start the whole-file fallback — we're tearing down.
          if (cancelled) throw err;
          return fetchJson(wholePath);
        }))
      .then((json: unknown) => {
        if (cancelled) return;
        const geojson = parseGridResponse(path, json);
        setCache((prev) => {
          const next = { ...prev, [cacheKey]: geojson };
          // CF-9: LRU — keep at most GRID_LRU_CAP datasets resident.
          const lru = lruRef.current.filter((k) => k !== cacheKey);
          lru.push(cacheKey);
          while (lru.length > GRID_LRU_CAP) {
            const evicted = lru.shift();
            if (evicted) {
              delete next[evicted];
              fetched.delete(evicted); // allow a refetch if revisited
            }
          }
          lruRef.current = lru;
          return next;
        });
        setLoading(false);
        completed = true;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Grid data is optional — silently fall back to postal choropleth.
        fetched.delete(cacheKey);
        console.warn(`Grid data not available for ${cacheKey}:`, err instanceof Error ? err.message : err);
        setLoading(false);
        // E2: surface the failure so the Legend can drop the grid-detail badge
        // instead of asserting ~250 m resolution that isn't loaded.
        setError(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (!completed) {
        fetched.delete(cacheKey);
        setLoading(false);
      }
    };
  }, [cacheKey, path, wholePath]);

  if (!entry) return { gridData: null, loading: false, error: false };

  return { gridData: cache[cacheKey] ?? null, loading, error };
}
