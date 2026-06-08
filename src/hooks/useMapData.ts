import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  // Track the region this state belongs to. When `regionId` changes, the data
  // currently held in state is for the previous region — callers that read it
  // (e.g. App.tsx → buildMetroAreaFeatures in the "all" view) would compute
  // from stale single-region features. Reset state during render so the next
  // render sees `data: null` instead of the previous region's data.
  const [loadedRegion, setLoadedRegion] = useState<typeof regionId>(regionId);
  const [attempt, setAttempt] = useState(0);
  // Track last attempt that triggered a cache reset, so region switches with
  // a stale attempt > 0 don't unnecessarily clear cached data for other regions.
  const lastResetAttemptRef = useRef(0);

  if (loadedRegion !== regionId) {
    setLoadedRegion(regionId);
    setState({ data: null, loading: true, error: null, metroAverages: {} });
  }

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
      .catch((err: unknown) => {
        if (cancelled) return;
        // Log the raw error for diagnostics; surface a stable code to the UI so
        // the banner can render a localized, user-friendly subtitle instead of
        // a truncated English/technical message.
        console.error(err);
        setState({ data: null, loading: false, error: 'load_failed', metroAverages: {} });
      });
    return () => { cancelled = true; };
  }, [regionId, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
