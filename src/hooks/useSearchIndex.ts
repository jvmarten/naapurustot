import { useState, useEffect, useCallback } from 'react';
import type { FeatureCollection } from 'geojson';
import { loadSearchIndex } from '../utils/dataLoader';

/**
 * Loads the lightweight all-areas search index so search can find any postal-code
 * area in Finland, regardless of which subregion is currently being observed. The
 * features carry only pno + names + `city` (the owning region) with null geometry —
 * geometry comes from the per-region data once a result is selected.
 *
 * CF-8: this is a small dedicated artifact (~40 KB gz), NOT the ~10.6 MB national
 * properties set. It's deferred to browser idle (below) rather than fetched eagerly,
 * so it yields the network/main thread to the first-paint-gating assets
 * (region_aggregates + seutukunnat) on cold load. Search still works in every view —
 * the idle fetch lands within ~1.5 s, well inside the bare ?pno= deep-link's grace
 * window, and the per-region dataset covers search until it arrives.
 */
export interface SearchIndexState {
  index: FeatureCollection | null;
  /** ER-1: the fetch rejected. Distinct from "not loaded yet" — the UI must offer a
   *  retry instead of a loading row that never resolves. */
  failed: boolean;
  /** ER-1: refetch. `loadSearchIndex` already evicts its cache on failure, so a
   *  second call really does hit the network again. */
  retry: () => void;
}

export function useSearchIndex(): SearchIndexState {
  const [index, setIndex] = useState<FeatureCollection | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setFailed(false); setAttempt((a) => a + 1); }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      loadSearchIndex()
        .then((fc) => { if (!cancelled) { setIndex(fc); setFailed(false); } })
        .catch(() => {
          // ER-1: this used to be an empty catch, so the hook stayed null forever
          // and SearchBar's `indexLoading = !searchSource` was permanently true —
          // on the default all-Finland landing (where the region dataset is
          // deliberately not fetched) one dropped 40 KB request killed search for
          // the whole session behind a fake "Ladataan…". Search still falls back to
          // the region-scoped dataset when there is one; the flag is what lets the
          // UI say so and offer a way out.
          if (!cancelled) setFailed(true);
        });
    };
    // Defer past first paint. requestIdleCallback with a bounded timeout keeps the
    // index off the critical path without starving it; the timeout guarantees it
    // still loads promptly on a busy main thread.
    if ('requestIdleCallback' in window) {
      const handle = window.requestIdleCallback(load, { timeout: 1500 });
      return () => { cancelled = true; window.cancelIdleCallback(handle); };
    }
    // jsdom / older Safari have no rIC — fall back to a near-immediate timer.
    const handle = setTimeout(load, 1);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [attempt]);

  return { index, failed, retry };
}
