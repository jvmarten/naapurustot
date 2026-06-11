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
 * properties set, so it loads eagerly on mount without weighing down the slim
 * all-Finland landing (which paints from region_aggregates.json and holds no
 * per-area `data`). Search therefore works instantly in every view.
 */
export function useSearchIndex(): FeatureCollection | null {
  const [index, setIndex] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSearchIndex()
      .then((fc) => { if (!cancelled) setIndex(fc); })
      .catch(() => { /* search falls back to the region-scoped dataset */ });
    return () => { cancelled = true; };
  }, []);

  return index;
}
