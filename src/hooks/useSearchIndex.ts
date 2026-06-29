import { useState, useEffect } from 'react';
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
export function useSearchIndex(): FeatureCollection | null {
  const [index, setIndex] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      loadSearchIndex()
        .then((fc) => { if (!cancelled) setIndex(fc); })
        .catch(() => { /* search falls back to the region-scoped dataset */ });
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
  }, []);

  return index;
}
