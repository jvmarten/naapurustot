import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { FeatureCollection } from 'geojson';
import { loadAllData, loadRegionData, resetDataCache } from '../utils/dataLoader';
import type { RegionId } from '../utils/regions';
import { mergeRegionData } from '../utils/regionSet';

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
 * CF-8: pass `{ skipAllFetch: true }` for the all-cities view to *not* download the
 * ~10.6 MB national set. The view then renders from `region_aggregates.json` (loaded
 * by `useAllCitiesAggregates`) and this hook exposes `data: null` — so every
 * `data`-gated path (pnoFeatureMap, drawn-area, quality recompute, deep-link restore)
 * cleanly no-ops until a trigger flips `skipAllFetch` off and the full set loads.
 *
 * `{ extra }` adds more regions alongside `regionId` (the multi-region postal view):
 * each is loaded through the same per-region cache and the results are merged into
 * one dataset, with averages recomputed over the union.
 *
 * Processing pipeline: TopoJSON → GeoJSON → filter islands → compute quality indices →
 * compute change metrics → compute quick-win metrics → compute metro averages.
 */
export function useMapData(regionId?: RegionId | 'all', opts?: { skipAllFetch?: boolean; extra?: readonly RegionId[] }): MapDataState {
  // Only meaningful for the all-cities view (regionId 'all' or undefined).
  const skipAllFetch = !!opts?.skipAllFetch && (regionId === 'all' || regionId == null);
  // One string identity for the displayed set ('lahti', 'helsinki_metro,lahti'): the
  // render-phase reset and the load effect key on it, never on the array's identity.
  const key = regionId && regionId !== 'all' && opts?.extra?.length ? [regionId, ...opts.extra].join(',') : regionId;
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
  const [loadedRegion, setLoadedRegion] = useState<string | undefined>(key);
  const [attempt, setAttempt] = useState(0);
  // Track last attempt that triggered a cache reset, so region switches with
  // a stale attempt > 0 don't unnecessarily clear cached data for other regions.
  const lastResetAttemptRef = useRef(0);

  if (loadedRegion !== key) {
    setLoadedRegion(key);
    setState({ data: null, loading: true, error: null, metroAverages: {} });
  }

  useEffect(() => {
    let cancelled = false;

    // CF-8: all-cities aggregate mode — do not fetch the full national set. Expose a
    // settled null dataset; the all-cities view renders from the prebuilt aggregates.
    if (skipAllFetch) {
      setState({ data: null, loading: false, error: null, metroAverages: {} });
      return () => { cancelled = true; };
    }

    setState({ data: null, loading: true, error: null, metroAverages: {} });

    if (attempt > lastResetAttemptRef.current) {
      resetDataCache();
      lastResetAttemptRef.current = attempt;
    }

    const ids = key && key !== 'all' ? (key.split(',') as RegionId[]) : null;
    const loadFn = !ids
      ? () => loadAllData()
      : ids.length === 1
        ? () => loadRegionData(ids[0])
        : () => Promise.all(ids.map((id) => loadRegionData(id))).then(mergeRegionData);

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
  }, [key, attempt, skipAllFetch]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
