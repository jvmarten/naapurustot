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

  // Pre-resolve layer configs and ranges once, outside the feature loop.
  // Before this fix, getLayerById() (linear LAYERS scan) and getLayerRange()
  // were called per-filter per-feature (~200 features × N filters).
  const resolved = filters.map((criterion) => {
    const layer = getLayerById(criterion.layerId);
    const [rangeMin, rangeMax] = getLayerRange(layer);
    return { property: layer.property, min: criterion.min, max: criterion.max, rangeMin, rangeMax };
  });

  const pnos = new Set<string>();
  for (const f of data.features) {
    const p = f.properties as NeighborhoodProperties;
    if (!p.he_vakiy || p.he_vakiy <= 0) continue;

    let matches = true;
    for (const r of resolved) {
      const value = p[r.property];
      if (typeof value !== 'number' || !isFinite(value)) { matches = false; break; }
      // When slider is at its extreme position, include all values beyond the stop range
      // so neighborhoods with outlier values (e.g. 1.4% when stops start at 2%) aren't excluded
      const minOk = r.min <= r.rangeMin || value >= r.min;
      const maxOk = r.max >= r.rangeMax || value <= r.max;
      if (!minOk || !maxOk) { matches = false; break; }
    }

    if (matches) pnos.add(p.pno);
  }

  return pnos;
}
