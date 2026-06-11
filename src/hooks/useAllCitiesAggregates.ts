import { useState, useEffect, useCallback } from 'react';
import { loadAllAggregates } from '../utils/dataLoader';
import type { RegionAggregatesData } from '../utils/metroAggregation';

interface AllCitiesAggregatesState {
  aggregates: RegionAggregatesData | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

/**
 * CF-8: load the prebuilt per-region aggregate artifact for the all-Finland view.
 *
 * Fetches `region_aggregates.json` (a few KB) only while `cityFilter === 'all'`, so
 * the default landing renders its 69-seutukunta choropleth without downloading the
 * full ~10.6 MB national properties set. The result is cached for the session
 * (`loadAllAggregates`), so leaving and re-entering the all-cities view is instant.
 */
export function useAllCitiesAggregates(cityFilter: string): AllCitiesAggregatesState {
  const [state, setState] = useState<Omit<AllCitiesAggregatesState, 'retry'>>({
    aggregates: null,
    loading: cityFilter === 'all',
    error: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cityFilter !== 'all') return;
    let cancelled = false;
    // Keep any already-loaded aggregates visible while retrying; only show the
    // spinner on the very first load.
    setState((s) => ({ aggregates: s.aggregates, loading: !s.aggregates, error: false }));
    loadAllAggregates()
      .then((aggregates) => {
        if (!cancelled) setState({ aggregates, loading: false, error: false });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ aggregates: s.aggregates, loading: false, error: true }));
      });
    return () => { cancelled = true; };
  }, [cityFilter, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { ...state, retry };
}
