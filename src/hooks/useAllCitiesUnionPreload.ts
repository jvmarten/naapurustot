import { useEffect, useState } from 'react';
import { preloadUnion } from '../utils/metroAreas';

/**
 * Lazily fetches the pre-baked seutukunta outlines (src/data/seutukunnat.topojson,
 * via `preloadUnion()` → `ensureOutlinesLoaded()` in metroAreas) whenever the user
 * is on the all-cities view, and returns a monotonically increasing counter that
 * bumps once the fetch resolves. Consumers include the counter in any `useMemo`
 * that calls `buildMetroAreaFeatures` so the metro-area features are rebuilt with
 * the dissolved seutukunta boundaries (instead of the fallback MultiPolygon
 * concatenation that leaks internal postal-code borders) as soon as the outlines
 * are cached.
 *
 * The effect is deliberately gated only on `cityFilter`, not on `data`. A
 * previous version waited for `data` to arrive before firing, which meant the
 * download didn't even start until after the first paint of the all-cities
 * view — so users saw a flash of internal postal-code lines while the fetch
 * was still in flight.
 */
export function useAllCitiesUnionPreload(cityFilter: string): number {
  const [unionReady, setUnionReady] = useState(0);
  useEffect(() => {
    if (cityFilter !== 'all') return;
    void preloadUnion().then(() => setUnionReady((v) => v + 1));
  }, [cityFilter]);
  return unionReady;
}
