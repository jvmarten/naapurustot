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
}

function parseGridResponse(path: string, json: unknown): FeatureCollection {
  if (path.endsWith('.topojson')) {
    const topo = json as Topology;
    const objectName = Object.keys(topo.objects ?? {})[0];
    if (!objectName) throw new Error('Invalid grid TopoJSON: no objects');
    return feature(topo, topo.objects[objectName]) as FeatureCollection;
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
export function useGridData(activeLayer: LayerId): GridDataState {
  const [cache, setCache] = useState<Record<string, FeatureCollection>>({});
  const [loading, setLoading] = useState(false);
  // Track which layers have been fetched (or are being fetched) to avoid
  // re-triggering the effect when cache state updates.
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const entry = GRID_MANIFEST[activeLayer as string];
    const path = entry ? BASE + entry.path : undefined;
    if (!path) return;
    const fetched = fetchedRef.current;
    if (fetched.has(activeLayer)) {
      // Already fetched/cached (or a prior in-flight fetch for this layer is still
      // tracked): nothing to load now, so clear any stale loading flag left behind
      // by a cancelled fetch of a different layer (the cancelled fetch skips its
      // own setLoading(false) via the `if (cancelled) return` guard).
      setLoading(false);
      return;
    }
    fetched.add(activeLayer);

    let cancelled = false;
    let completed = false;
    setLoading(true);

    fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`Grid data fetch failed: ${res.status}`);
        return res.json();
      })
      .then((json: unknown) => {
        if (cancelled) return;
        const geojson = parseGridResponse(path, json);
        setCache((prev) => ({ ...prev, [activeLayer]: geojson }));
        setLoading(false);
        completed = true;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Grid data is optional — silently fall back to postal choropleth.
        // Remove from fetched set so a retry is possible on next layer switch.
        fetched.delete(activeLayer);
        console.warn(`Grid data not available for ${activeLayer}:`, err instanceof Error ? err.message : err);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      // Allow retry on re-visit only if the fetch didn't complete successfully
      if (!completed) {
        fetched.delete(activeLayer);
        // The cancelled fetch will skip its own setLoading(false), so clear it
        // here to avoid leaving the hook stuck at loading:true.
        setLoading(false);
      }
    };
  }, [activeLayer]);

  const entry = GRID_MANIFEST[activeLayer as string];
  if (!entry) return { gridData: null, loading: false };

  return { gridData: cache[activeLayer] ?? null, loading };
}
