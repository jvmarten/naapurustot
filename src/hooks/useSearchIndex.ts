import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { loadAllData } from '../utils/dataLoader';

/**
 * Loads the geometry-stripped all-areas dataset once so search can find any
 * postal-code area in Finland, regardless of which subregion is currently
 * being observed. The features carry properties only (including `city`, the
 * owning region) — geometry comes from the per-region data once selected.
 *
 * Reuses loadAllData()'s cached promise, so it shares the fetch with the
 * "all cities" view rather than downloading the dataset twice.
 */
export function useSearchIndex(): FeatureCollection | null {
  const [index, setIndex] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadAllData()
      .then((res) => { if (!cancelled) setIndex(res.data); })
      .catch(() => { /* search falls back to the region-scoped dataset */ });
    return () => { cancelled = true; };
  }, []);

  return index;
}
