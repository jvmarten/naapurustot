import type { FeatureCollection } from 'geojson';
import { type LayerId, type LayerConfig, getLayerById } from './colorScales';
import type { NeighborhoodProperties } from './metrics';

/** A single range filter: only neighborhoods where the layer's value falls within [min, max]. */
export interface FilterCriterion {
  layerId: LayerId;
  min: number;
  max: number;
}

/** Get the data range (min stop, max stop) for a layer from its color stops. */
function getLayerRange(layer: LayerConfig): [number, number] {
  return [layer.stops[0], layer.stops[layer.stops.length - 1]];
}

// Stable empty set to avoid creating new references on every call with no filters.
// Without this, Map.tsx receives a new Set identity each time and re-runs its
// filter highlight effect unnecessarily.
const EMPTY_SET: Set<string> = new Set();

/** Compute the set of matching PNOs given data and filters. Used by Map.tsx. */
export function computeMatchingPnos(
  data: FeatureCollection | null,
  filters: FilterCriterion[],
): Set<string> {
  if (!data || filters.length === 0) return EMPTY_SET;

  const pnos = new Set<string>();
  for (const f of data.features) {
    const p = f.properties as NeighborhoodProperties;
    if (!p.he_vakiy || p.he_vakiy <= 0) continue;

    const matches = filters.every((criterion) => {
      const layer = getLayerById(criterion.layerId);
      const value = p[layer.property];
      if (typeof value !== 'number' || value == null) return false;
      const [rangeMin, rangeMax] = getLayerRange(layer);
      // When slider is at its extreme position, include all values beyond the stop range
      // so neighborhoods with outlier values (e.g. 1.4% when stops start at 2%) aren't excluded
      const minOk = criterion.min <= rangeMin ? true : value >= criterion.min;
      const maxOk = criterion.max >= rangeMax ? true : value <= criterion.max;
      return minOk && maxOk;
    });

    if (matches) pnos.add(p.pno);
  }

  return pnos;
}
