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

/** Result of loading and processing a TopoJSON dataset. */
export interface ProcessedData {
  /** GeoJSON FeatureCollection with computed properties (quality index, change metrics, etc.) */
  data: FeatureCollection;
  /** Population-weighted averages across all neighborhoods in the dataset. */
  metroAverages: Record<string, number>;
}

// TopoJSON quantization can produce string-typed numeric values (e.g., "12345"
// instead of 12345). Coerce them back to numbers for all properties except
// identifier fields that must remain strings (postal codes, municipality codes).
const ID_FIELDS = new Set(['pno', 'postinumeroalue', 'kunta', 'nimi', 'namn', 'city']);

function processTopology(topo: Topology): ProcessedData {
  if (!topo || typeof topo !== 'object' || !topo.objects) {
    throw new Error('Invalid TopoJSON: expected an object with "objects" property');
  }
  const objectName = Object.keys(topo.objects)[0];
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

  // Evict from cache on failure so the next navigation attempt retries
  // instead of returning the same rejected promise.
  const tracked = promise.catch((err) => {
    regionCache.delete(regionId);
    throw err;
  });

  regionCache.set(regionId, tracked);
  return tracked;
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
    .then((topo: Topology) => processTopology(topo))
    .catch((err) => {
      // Evict from cache on failure so the next call retries
      combinedCache = null;
      throw err;
    });

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
