import { useState, useEffect, useCallback } from 'react';
import type { FeatureCollection } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { computeMetroAverages, computeChangeMetrics, computeQuickWinMetrics } from '../utils/metrics';
import { computeQualityIndices } from '../utils/qualityIndex';
import { filterSmallIslands } from '../utils/geometryFilter';

import topoUrl from '../data/metro_neighborhoods.topojson?url';

// Start fetching data immediately at module load time — before React mounts.
// This eliminates the delay between JS parse and the first useEffect.
let prefetchedResponse: Promise<Response> | null = null;
try {
  prefetchedResponse = fetch(topoUrl);
} catch { /* fetch unavailable in SSR */ }

export interface DataMetadata {
  updated: string;    // e.g. "2026-03"
  builtAt: string;    // full ISO timestamp
}

interface MapDataState {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  metroAverages: Record<string, number>;
  metadata: DataMetadata | null;
  retry: () => void;
}

/**
 * Fetches and processes the neighborhood TopoJSON data.
 *
 * Data loading is eager: a fetch starts at module evaluation time (before React mounts)
 * and the prefetched response is consumed on first render. On retries, a fresh fetch is made.
 *
 * Processing pipeline: TopoJSON → GeoJSON → filter islands → compute quality indices →
 * compute change metrics → compute quick-win metrics → compute metro averages.
 */
export function useMapData(): MapDataState {
  const [state, setState] = useState<Omit<MapDataState, 'retry'>>({
    data: null,
    loading: true,
    error: null,
    metroAverages: {},
    metadata: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, metroAverages: {}, metadata: null });
    // Use prefetched response on first load, fresh fetch on retries.
    // Clone the prefetched response so the original can be reused
    // (e.g., if React StrictMode double-mounts the component).
    // If the prefetch failed, clear it and fall through to a fresh fetch.
    let responsePromise: Promise<Response>;
    if (attempt === 0 && prefetchedResponse) {
      responsePromise = prefetchedResponse.then((res) => res.clone()).catch(() => {
        prefetchedResponse = null;
        return fetch(topoUrl);
      });
    } else {
      responsePromise = fetch(topoUrl);
    }
    responsePromise
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
        return res.json();
      })
      .then((topo: Topology & { metadata?: DataMetadata }) => {
        if (cancelled) return;
        const objectName = Object.keys(topo.objects ?? {})[0];
        if (!objectName) throw new Error('Invalid TopoJSON: no objects found');
        const metadata = topo.metadata ?? null;
        const geojson = feature(topo, topo.objects[objectName]) as FeatureCollection;
        geojson.features = filterSmallIslands(geojson.features);
        computeQualityIndices(geojson.features);
        computeChangeMetrics(geojson.features);
        computeQuickWinMetrics(geojson.features);
        const metroAverages = computeMetroAverages(geojson.features);
        setState({ data: geojson, loading: false, error: null, metroAverages, metadata });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err.message, metroAverages: {}, metadata: null });
      });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry };
}
