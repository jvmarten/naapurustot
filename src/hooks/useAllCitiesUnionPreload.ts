import { useEffect, useState } from 'react';
import { preloadUnion } from '../utils/metroAreas';

/**
 * Lazy-loads `@turf/union` whenever the user is on the all-cities view, and
 * returns a monotonically increasing counter that bumps once the module is
 * available. Consumers include the counter in any `useMemo` that calls
 * `buildMetroAreaFeatures` so the metro outlines are rebuilt with dissolved
 * boundaries (instead of the fallback MultiPolygon concatenation that leaks
 * internal postal-code borders) as soon as union is loaded.
 *
 * The effect is deliberately gated only on `cityFilter`, not on `data`. A
 * previous version waited for `data` to arrive before firing, which meant the
 * download didn't even start until after the first paint of the all-cities
 * view — so users saw a flash of internal postal-code lines while the import
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
