import type { FeatureCollection } from 'geojson';
import { type LayerId, type LayerConfig, getLayerById, LAYERS } from './colorScales';
import type { NeighborhoodProperties } from './metrics';
import { distributionFor, valueAtPercentileSorted } from './percentileRanks';

/**
 * CF-7: how a criterion's `min`/`max` bounds are interpreted.
 *  - 'absolute'   — bounds are raw metric values (the original behaviour).
 *  - 'percentile' — bounds are a 0–100 percentile *rank* over the active scope's
 *                   distribution (0 = lowest value, 100 = highest). They are
 *                   resolved to concrete values at filter time via
 *                   `valueAtPercentileSorted`, so the same link adapts to whatever
 *                   data is loaded / scoped.
 */
export type FilterMode = 'absolute' | 'percentile';

/**
 * A single range filter criterion.
 * Only neighborhoods where the layer's value falls within [min, max] pass the filter.
 * When min/max are at the layer's stop extremes, values beyond the range are included
 * to avoid excluding outliers.
 *
 * CF-7: when `mode === 'percentile'`, `min`/`max` are 0–100 percentile ranks rather
 * than raw values; absence of `mode` (or `'absolute'`) preserves the legacy behaviour.
 */
export interface FilterCriterion {
  layerId: LayerId;
  min: number;
  max: number;
  mode?: FilterMode;
}

/** Get the data range (min stop, max stop) for a layer from its color stops. */
function getLayerRange(layer: LayerConfig): [number, number] {
  return [layer.stops[0], layer.stops[layer.stops.length - 1]];
}

const VALID_FILTER_LAYERS: ReadonlySet<string> = new Set(LAYERS.map((l) => l.id));

/**
 * CF-1b: compact URL encoding for filter criteria, e.g.
 *   "median_income~25000~40000,crime_rate~0~80"
 * Numbers are rounded to 3 decimals to keep links short.
 *
 * CF-7: a percentile-mode criterion appends a trailing `~p` flag, e.g.
 *   "median_income~20~100~p" (bounds are 0–100 ranks, resolved at filter time).
 * Absolute criteria omit the flag entirely, so existing links are unchanged.
 */
export function serializeFilters(filters: FilterCriterion[]): string {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return filters
    .map((f) => {
      const base = `${f.layerId}~${round(f.min)}~${round(f.max)}`;
      return f.mode === 'percentile' ? `${base}~p` : base;
    })
    .join(',');
}

/**
 * Inverse of serializeFilters. Validates each layerId against LAYERS and requires
 * finite min ≤ max, dropping malformed or unknown entries so a hand-edited or stale
 * shared URL can never crash the app or apply a bogus filter.
 *
 * CF-7: accepts an optional 4th `p` field marking percentile mode; in that case the
 * bounds are additionally clamped to [0, 100] (a rank can never fall outside that).
 */
export function deserializeFilters(encoded: string): FilterCriterion[] {
  const out: FilterCriterion[] = [];
  for (const part of encoded.split(',')) {
    const fields = part.split('~');
    if (fields.length !== 3 && fields.length !== 4) continue;
    const [layerId, minStr, maxStr, modeStr] = fields;
    // A 4th field must be exactly the percentile flag; anything else is malformed.
    if (fields.length === 4 && modeStr !== 'p') continue;
    // Reject empty number strings explicitly — Number('') coerces to 0, which would
    // otherwise sneak through as a valid 0 bound.
    if (!minStr || !maxStr) continue;
    const min = Number(minStr);
    const max = Number(maxStr);
    if (!(layerId && VALID_FILTER_LAYERS.has(layerId) && Number.isFinite(min) && Number.isFinite(max) && min <= max)) {
      continue;
    }
    if (fields.length === 4) {
      // Percentile bounds are ranks: clamp to [0, 100] defensively.
      if (min < 0 || min > 100 || max < 0 || max > 100) continue;
      out.push({ layerId: layerId as LayerId, min, max, mode: 'percentile' });
    } else {
      out.push({ layerId: layerId as LayerId, min, max });
    }
  }
  return out;
}

// Stable empty set to avoid creating new references on every call with no filters.
// Without this, Map.tsx receives a new Set identity each time and re-runs its
// filter highlight effect unnecessarily.
const EMPTY_SET: Set<string> = new Set();

/**
 * CF-7: resolve a criterion's `min`/`max` to concrete metric value bounds for the
 * supplied feature set (the "active scope"). Absolute criteria pass through unchanged;
 * percentile criteria map their 0–100 ranks to the scope distribution's quantiles via
 * `valueAtPercentileSorted`.
 *
 * Returns null when a percentile criterion cannot be resolved (no finite values for the
 * metric in scope), signalling the caller to skip it rather than match nothing.
 * The returned `rangeMin`/`rangeMax` are the data extremes used for outlier inclusion at
 * slider extremes (the lowest/highest observed value in percentile mode, the layer's
 * stop range in absolute mode) so the "include outliers at the rail" behaviour is shared.
 */
export interface ResolvedBounds {
  property: string;
  /** Concrete lower value bound to match against. */
  valueMin: number;
  /** Concrete upper value bound to match against. */
  valueMax: number;
  /** Lower data extreme for the at-rail outlier-inclusion check. */
  rangeMin: number;
  /** Upper data extreme for the at-rail outlier-inclusion check. */
  rangeMax: number;
}

export function resolveCriterionBounds(
  criterion: FilterCriterion,
  features: FeatureCollection['features'] | null,
): ResolvedBounds | null {
  const layer = getLayerById(criterion.layerId);
  if (criterion.mode === 'percentile') {
    if (!features || features.length === 0) return null;
    // Percentile resolution always excludes non-positive income placeholders the
    // same way the superlative machinery does, but for generality we only drop the
    // sentinel for value-less features (readMetric already rejects null/'').
    const sorted = distributionFor(features as Array<{ properties?: Record<string, unknown> | null }>, layer.property);
    if (sorted.length === 0) return null;
    const valueMin = valueAtPercentileSorted(sorted, criterion.min);
    const valueMax = valueAtPercentileSorted(sorted, criterion.max);
    if (valueMin == null || valueMax == null) return null;
    return {
      property: layer.property,
      valueMin,
      valueMax,
      rangeMin: sorted[0],
      rangeMax: sorted[sorted.length - 1],
    };
  }
  const [rangeMin, rangeMax] = getLayerRange(layer);
  return { property: layer.property, valueMin: criterion.min, valueMax: criterion.max, rangeMin, rangeMax };
}

/** Compute the set of matching PNOs given data and filters. Used by Map.tsx. */
export function computeMatchingPnos(
  data: FeatureCollection | null,
  filters: FilterCriterion[],
): Set<string> {
  if (!data || filters.length === 0) return EMPTY_SET;

  // Pre-resolve layer configs and ranges once, outside the feature loop.
  // Before this fix, getLayerById() (linear LAYERS scan) and getLayerRange()
  // were called per-filter per-feature (~200 features × N filters).
  // CF-7: percentile criteria are resolved against `data.features` (the active scope)
  // here, once, so the value bounds are concrete by the time we hit the feature loop.
  const resolved: ResolvedBounds[] = [];
  for (const criterion of filters) {
    const r = resolveCriterionBounds(criterion, data.features);
    // An unresolvable percentile criterion (no data for that metric in scope) would
    // otherwise match nothing; skipping it keeps the remaining criteria meaningful.
    if (r) resolved.push(r);
  }
  if (resolved.length === 0) return EMPTY_SET;

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
      const minOk = r.valueMin <= r.rangeMin || value >= r.valueMin;
      const maxOk = r.valueMax >= r.rangeMax || value <= r.valueMax;
      if (!minOk || !maxOk) { matches = false; break; }
    }

    if (matches) pnos.add(p.pno);
  }

  return pnos;
}
