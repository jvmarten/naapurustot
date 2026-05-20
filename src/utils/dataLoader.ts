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

import type { Feature, FeatureCollection } from 'geojson';
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

// Properties-only dataset for the "all cities" view (CF-5). That view
// aggregates per-region stats and never renders the postal-code polygons
// (geometry comes from seutukunnat.topojson), so it loads just the properties
// rather than the ~35 MB combined TopoJSON.
import regionPropertiesUrl from '../data/region_properties.json?url';

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

// TopoJSON quantization can produce string-typed numeric values; coerce them
// back to numbers for every non-identifier property.
function coerceNumericProperties(features: Feature[]): void {
  for (const feat of features) {
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
}

function processTopology(topo: Topology): ProcessedData {
  const objectName = Object.keys(topo.objects ?? {})[0];
  if (!objectName) throw new Error('Invalid TopoJSON: no objects found');
  const geojson = feature(topo, topo.objects[objectName]) as FeatureCollection;

  coerceNumericProperties(geojson.features);
  geojson.features = filterSmallIslands(geojson.features);
  computeQualityIndices(geojson.features);
  computeChangeMetrics(geojson.features);
  computeQuickWinMetrics(geojson.features);
  const metroAverages = computeMetroAverages(geojson.features);

  return { data: geojson, metroAverages };
}

/**
 * Process the geometry-stripped region_properties.json (an array of property
 * objects) into the same ProcessedData shape. Used by the all-cities view,
 * which aggregates per-region stats and never renders postal-code geometry —
 * so features carry `geometry: null` and island filtering is skipped.
 */
function processProperties(propsArray: Record<string, unknown>[]): ProcessedData {
  // These features carry geometry: null — the all-cities view aggregates
  // properties only and never renders the postal codes. GeoJSON permits null
  // geometry; the cast bridges it to the non-null default FeatureCollection type.
  const features = propsArray.map((properties) => ({
    type: 'Feature',
    properties,
    geometry: null,
  }));
  const geojson = { type: 'FeatureCollection', features } as unknown as FeatureCollection;

  coerceNumericProperties(geojson.features);
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
 * Load the all-regions dataset for the "all cities" view and cross-region search.
 *
 * Loads the geometry-stripped region_properties.json, not postal-code geometry:
 * the all-cities view aggregates per-region stats and draws region outlines from
 * seutukunnat.topojson. Fetched on first call so single-region users never
 * download it.
 */
export function loadAllData(): Promise<ProcessedData> {
  if (combinedCache) return combinedCache;

  combinedCache = fetch(regionPropertiesUrl)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
      return res.json();
    })
    .then((props: Record<string, unknown>[]) => processProperties(props))
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
