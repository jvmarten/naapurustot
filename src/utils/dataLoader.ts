/**
 * Shared data loading module.
 *
 * Both the map SPA and neighborhood profile pages need the same processed
 * GeoJSON. This module provides a singleton promise so the data is fetched
 * and processed exactly once, regardless of which entry point loads first.
 */

import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from './metrics';
import { computeQualityIndices } from './qualityIndex';
import { filterSmallIslands } from './geometryFilter';

import topoUrl from '../data/metro_neighborhoods.topojson?url';

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

// Start fetching immediately at module load time.
let prefetchedResponse: Promise<Response> | null = null;
try {
  prefetchedResponse = fetch(topoUrl);
} catch { /* fetch unavailable in SSR */ }

let cachedResult: Promise<ProcessedData> | null = null;

/** Returns a singleton promise for the processed neighborhood data. */
export function loadNeighborhoodData(): Promise<ProcessedData> {
  if (cachedResult) return cachedResult;

  const responsePromise = prefetchedResponse
    ? prefetchedResponse.then(res => res.clone()).catch(() => fetch(topoUrl))
    : fetch(topoUrl);

  cachedResult = responsePromise
    .then(res => {
      if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
      return res.json();
    })
    .then((topo: Topology) => processTopology(topo));

  return cachedResult;
}

/** Reset the cache (used for retry logic in useMapData). */
export function resetDataCache(): void {
  cachedResult = null;
  prefetchedResponse = null;
}
