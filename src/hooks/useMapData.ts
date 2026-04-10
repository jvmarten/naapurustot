import { useState, useEffect, useCallback, useRef } from 'react';
import type { FeatureCollection } from 'geojson';
import { loadAllData, loadRegionData, resetDataCache } from '../utils/dataLoader';
import type { RegionId } from '../utils/regions';

interface MapDataState {
  data: FeatureCollection | null;
  loading: boolean;
  error: string | null;
  metroAverages: Record<string, number>;
  retry: () => void;
}

/**
 * Fetches and processes neighborhood data.
 *
 * When `regionId` is provided, loads only that region's TopoJSON file (lazy).
 * When `regionId` is undefined (i.e. "all" view), loads the combined dataset.
 *
 * Processing pipeline: TopoJSON → GeoJSON → filter islands → compute quality indices →
 * compute change metrics → compute quick-win metrics → compute metro averages.
 */
export function useMapData(regionId?: RegionId | 'all'): MapDataState {
  const [state, setState] = useState<Omit<MapDataState, 'retry'>>({
    data: null,
    loading: true,
    error: null,
    metroAverages: {},
  });
  const [attempt, setAttempt] = useState(0);
  // Track last attempt that triggered a cache reset, so region switches with
  // a stale attempt > 0 don't unnecessarily clear cached data for other regions.
  const lastResetAttemptRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setState({ data: null, loading: true, error: null, metroAverages: {} });

    if (attempt > lastResetAttemptRef.current) {
      resetDataCache();
      lastResetAttemptRef.current = attempt;
    }

    const loadFn = regionId && regionId !== 'all'
      ? () => loadRegionData(regionId)
      : () => loadAllData();

    loadFn()
      .then((result) => {
        if (cancelled) return;
        setState({ data: result.data, loading: false, error: null, metroAverages: result.metroAverages });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: err.message, metroAverages: {} });
      });
    return () => { cancelled = true; };
  }, [regionId, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry };
}
