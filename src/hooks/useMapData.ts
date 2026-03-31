import { useState, useEffect, useCallback } from 'react';
import type { FeatureCollection } from 'geojson';
import { loadNeighborhoodData, resetDataCache } from '../utils/dataLoader';

interface MapDataState {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  metroAverages: Record<string, number>;
  retry: () => void;
}

/**
 * Fetches and processes the neighborhood TopoJSON data.
 *
 * Data loading is eager: a fetch starts at module evaluation time (via dataLoader)
 * and the prefetched response is consumed on first render. On retries, the cache
 * is reset and a fresh fetch is made.
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
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, metroAverages: {} });

    if (attempt > 0) resetDataCache();

    loadNeighborhoodData()
      .then((result) => {
        if (cancelled) return;
        setState({ data: result.data, loading: false, error: null, metroAverages: result.metroAverages });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err.message, metroAverages: {} });
      });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry };
}
