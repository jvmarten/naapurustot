/**
 * Shared data loading module with per-region lazy loading.
 *
 * Supports two modes:
 * 1. Load a single region's TopoJSON on demand (for city/region views)
 * 2. Load the combined dataset (for "all" view and cross-region search)
 *
 * Each region file is fetched only when needed and cached. Processing
 * (TopoJSON → GeoJSON, quality indices, metro averages) runs once per load.
 */

import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from './metrics';
import { computeQualityIndices } from './qualityIndex';
import { filterSmallIslands } from './geometryFilter';
import type { RegionId } from './regions';

// Vite resolves these glob imports at build time into lazy asset URLs.
// Each region file becomes a separate chunk loaded on demand.
const regionModules = import.meta.glob<string>(
  '../data/regions/*.topojson',
  { query: '?url', import: 'default', eager: false },
);

// Combined file for "all" view (backward compat)
import combinedTopoUrl from '../data/metro_neighborhoods.topojson?url';

export interface ProcessedData {
  data: FeatureCollection;
  metroAverages: Record<string, number>;
}

// Coerce string-typed numeric properties to actual numbers.
const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta']);

function processTopology(topo: Topology): ProcessedData {
  const objectName = Object.keys(topo.objects ?? {})[0];
  if (!objectName) throw new Error('Invalid TopoJSON: no objects found');
  const geojson = feature(topo, topo.objects[objectName]) as FeatureCollection;

  for (const feat of geojson.features) {
    if (!feat.properties) continue;
    for (const key of Object.keys(feat.properties)) {
      if (ID_FIELDS.has(key)) continue;
      const v = feat.properties[key];
      if (typeof v === 'string' && v.trim() !== '') {
        const num = Number(v);
        if (isFinite(num)) feat.properties[key] = num;
      }
    }
  }

  geojson.features = filterSmallIslands(geojson.features);
  computeQualityIndices(geojson.features);
  computeChangeMetrics(geojson.features);
  computeQuickWinMetrics(geojson.features);
  const metroAverages = computeMetroAverages(geojson.features);

  return { data: geojson, metroAverages };
}

async function fetchAndProcess(url: string): Promise<ProcessedData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
  const topo: Topology = await res.json();
  return processTopology(topo);
}

// --- Per-region loading ---

/** Resolve the Vite glob key for a region's data file. */
function getRegionGlobKey(regionId: RegionId): string {
  return `../data/regions/${regionId}.topojson`;
}

const regionCache = new Map<RegionId, Promise<ProcessedData>>();

/**
 * Load a single region's data. Returns cached promise if already loading/loaded.
 */
export function loadRegionData(regionId: RegionId): Promise<ProcessedData> {
  const cached = regionCache.get(regionId);
  if (cached) return cached;

  const key = getRegionGlobKey(regionId);
  const loader = regionModules[key];

  let promise: Promise<ProcessedData>;
  if (loader) {
    promise = loader().then((url) => fetchAndProcess(url));
  } else {
    // Fallback: load from combined file and filter
    promise = loadAllData().then((all) => ({
      data: {
        ...all.data,
        features: all.data.features.filter(
          (f) => f.properties?.city === regionId,
        ),
      },
      metroAverages: computeMetroAverages(
        all.data.features.filter((f) => f.properties?.city === regionId),
      ),
    }));
  }

  regionCache.set(regionId, promise);
  return promise;
}

// --- Combined "all" data loading ---

let combinedCache: Promise<ProcessedData> | null = null;

/**
 * Load the combined dataset (all regions). Used for "all" view and cross-region search.
 * Backward-compatible: same as the old loadNeighborhoodData().
 *
 * Fetches on first call rather than at module load, so users viewing a single
 * region don't download the full combined file (~1.1 MB) unnecessarily.
 */
export function loadAllData(): Promise<ProcessedData> {
  if (combinedCache) return combinedCache;

  combinedCache = fetch(combinedTopoUrl)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
      return res.json();
    })
    .then((topo: Topology) => processTopology(topo));

  return combinedCache;
}

/**
 * Legacy alias — loadNeighborhoodData() still works for any code that hasn't
 * been migrated to region-aware loading yet.
 */
export const loadNeighborhoodData = loadAllData;

/** Reset all caches (used for retry logic in useMapData). */
export function resetDataCache(): void {
  combinedCache = null;
  regionCache.clear();
}
