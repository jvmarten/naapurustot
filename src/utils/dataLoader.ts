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
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics, computeTimeSeriesValues } from './metrics';
import { computeQualityIndices } from './qualityIndex';
import { getNationalRanges } from './nationalRanges';
import { filterSmallIslands } from './geometryFilter';
import type { RegionId } from './regions';

// Vite resolves these glob imports at build time into asset URLs.
//
// EAGER on purpose. The lazy form emitted 70 standalone chunks, each one line
// (`var e="/assets/tampere-<hash>.topojson";export{e as default}`) — 4,619 raw bytes
// that gzip INFLATES to 6,009, because a ~66-byte file has nothing to compress and
// still pays a ~20-byte header/trailer. Eager inlines the 70 URL strings into this
// module instead, measured at 5,579 gzipped bytes cheaper.
//
// It also removes a request hop: the lazy form was fetch(tiny .js) -> fetch(topojson),
// a waterfall on every region load. The URLs themselves are hashed filenames, so
// nothing is fetched until fetchAndProcess asks for one.
const regionModules = import.meta.glob<string>(
  '../data/regions/*.topojson',
  { query: '?url', import: 'default', eager: true },
);

// Properties-only dataset for the "all cities" view (CF-5). That view
// aggregates per-region stats and never renders the postal-code polygons
// (geometry comes from seutukunnat.topojson), so it loads just the properties
// rather than the ~35 MB combined TopoJSON.
import regionPropertiesUrl from '../data/region_properties.json?url';
import { decodeColumnar, type ColumnarPayload } from './columnar';

// CF-8: the small prebuilt per-region aggregate artifact (~69 records, a few KB gz)
// that drives the all-Finland first paint, so the default landing no longer fetches
// the ~10.6 MB region_properties.json before the map is usable. Fetched as a static
// asset (?url), never bundled.
import regionAggregatesUrl from '../data/region_aggregates.json?url';
import type { RegionAggregatesData } from './metroAggregation';

// CF-8: a tiny eager search index — pno + names + owning region + municipality name
// for every area, so cross-area search works in every view (including the slim
// all-Finland landing, where the full national set is NOT loaded) without pulling the
// ~10.6 MB region_properties. The municipality field lets a town name surface its
// neighbourhoods even when their own names are generic ("Keskus", "Kirkonkylä").
import regionSearchIndexUrl from '../data/region_search_index.json?url';

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
  const decoded = feature(topo, topo.objects[objectName]);
  // feature() returns Feature | FeatureCollection; our region objects are always
  // GeometryCollections (→ FeatureCollection). Fail loudly if that ever changes,
  // rather than casting and crashing later on `.features`.
  if (decoded.type !== 'FeatureCollection') {
    throw new Error(`Invalid TopoJSON: expected FeatureCollection from "${objectName}", got ${decoded.type}`);
  }
  const geojson = decoded;

  // Region TopoJSONs carry their properties once, column-major, with each
  // geometry holding only its row index — the ~198 key names were the bulk of
  // the file. Rehydrate before anything downstream reads a property.
  const columnar = (topo as unknown as { propertiesColumnar?: ColumnarPayload }).propertiesColumnar;
  if (columnar) {
    const records = decodeColumnar<Record<string, unknown>>(columnar);
    for (const f of geojson.features) {
      const idx = (f.properties as { i?: number } | null)?.i;
      if (typeof idx === 'number' && records[idx]) {
        f.properties = records[idx] as unknown as typeof f.properties;
      }
    }
  }

  coerceNumericProperties(geojson.features);
  geojson.features = filterSmallIslands(geojson.features);
  // Default to national normalization so a region's scores are comparable with
  // every other region (the lazy per-region loader can't see the whole country).
  computeQualityIndices(geojson.features, undefined, getNationalRanges());
  computeChangeMetrics(geojson.features);
  computeQuickWinMetrics(geojson.features);
  // PO-2: flatten history arrays into per-year numeric props for the time slider.
  computeTimeSeriesValues(geojson.features);
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
  // The all-cities view holds every postal code, but still normalize against the
  // same national ranges as the per-region views so a postal code's score is
  // identical whether you reach it via its region or the national aggregate.
  computeQualityIndices(geojson.features, undefined, getNationalRanges());
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
  // Eager glob: the value IS the asset URL, not a loader thunk.
  const url = regionModules[key];

  let promise: Promise<ProcessedData>;
  if (url) {
    promise = fetchAndProcess(url);
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
    // The artifact ships column-major (keys stored once, not repeated 3,018
    // times) — 2.09 MB gz -> 1.01 MB gz. decodeColumnar passes a plain array
    // through untouched, so a stale cached copy of the old shape still loads.
    .then((payload: ColumnarPayload | Record<string, unknown>[]) =>
      processProperties(decodeColumnar<Record<string, unknown>>(payload)))
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

// --- CF-8: all-cities aggregate loading ---

let aggregatesCache: Promise<RegionAggregatesData> | null = null;

/**
 * Load the prebuilt per-region aggregate artifact for the all-Finland first paint.
 *
 * This is a few-KB JSON (~69 records + national averages) that lets the all-cities
 * view render its 69 seutukunta choropleth without downloading the full ~10.6 MB
 * national properties set. The full set (`loadAllData`) is deferred to the events
 * that genuinely need per-postal-code data (custom quality weights, deep-linked
 * `?pno=`, search). Fetched on first call and cached for the session.
 */
export function loadAllAggregates(): Promise<RegionAggregatesData> {
  if (aggregatesCache) return aggregatesCache;

  aggregatesCache = fetch(regionAggregatesUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load aggregates: ${res.status}`);
      return res.json() as Promise<RegionAggregatesData>;
    })
    .catch((err) => {
      // Evict from cache on failure so the next call retries.
      aggregatesCache = null;
      throw err;
    });

  return aggregatesCache;
}

// CF-8: lightweight search index (pno/nimi/namn/city/muni per area), geometry: null.
let searchIndexCache: Promise<FeatureCollection> | null = null;

/**
 * Load the tiny eager search index for cross-area name/postal-code/municipality search.
 *
 * Returns a FeatureCollection of geometry-null features carrying only the fields search
 * needs (pno, nimi, namn, city, and municipality name `muni`). A fraction of the full
 * national set, so it loads on mount without weighing down the slim all-Finland landing —
 * search resolves a result's owning region from `city` and lets the per-region geometry
 * load on selection.
 */
export function loadSearchIndex(): Promise<FeatureCollection> {
  if (searchIndexCache) return searchIndexCache;

  searchIndexCache = fetch(regionSearchIndexUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load search index: ${res.status}`);
      return res.json() as Promise<Record<string, unknown>[]>;
    })
    .then((rows) => ({
      type: 'FeatureCollection',
      features: rows.map((properties) => ({ type: 'Feature', properties, geometry: null })),
    }) as unknown as FeatureCollection)
    .catch((err) => {
      searchIndexCache = null;
      throw err;
    });

  return searchIndexCache;
}

/** Reset all caches (used for retry logic in useMapData). */
export function resetDataCache(): void {
  combinedCache = null;
  aggregatesCache = null;
  searchIndexCache = null;
  regionCache.clear();
}
