import type { NeighborhoodProperties } from '../utils/metrics';
import { getFeatureCenter } from '../utils/geometryFilter';

/** One findSimilarNeighborhoods result: `distance` is the weighted normalized Euclidean
 *  distance (lower = more similar); `center` is the area's [lng, lat] bbox midpoint. */
export interface SimilarNeighborhood {
  properties: NeighborhoodProperties;
  distance: number;
  center: [number, number];
}

/**
 * Key metrics used for computing neighborhood similarity.
 * Each metric is normalized to [0, 1] via min-max scaling across the dataset.
 */
const SIMILARITY_METRICS: (keyof NeighborhoodProperties)[] = [
  'hr_mtu',
  'unemployment_rate',
  'higher_education_rate',
  'foreign_language_pct',
  'ownership_rate',
  'transit_stop_density',
  'property_price_sqm',
  'crime_index',
  'population_density',
  'child_ratio',
];

/**
 * CF-6: the similarity metrics exposed in the panel picker, each with an i18n
 * label key, so the user can choose what "similar" means to them. The default
 * selection is all of them (matching the historical hardcoded behaviour).
 */
export const AVAILABLE_SIMILARITY_METRICS: { key: keyof NeighborhoodProperties; labelKey: string }[] = [
  { key: 'hr_mtu', labelKey: 'layer.median_income' },
  { key: 'unemployment_rate', labelKey: 'layer.unemployment' },
  { key: 'higher_education_rate', labelKey: 'layer.education' },
  { key: 'foreign_language_pct', labelKey: 'layer.foreign_lang' },
  { key: 'ownership_rate', labelKey: 'layer.ownership' },
  { key: 'transit_stop_density', labelKey: 'layer.transit_access' },
  { key: 'property_price_sqm', labelKey: 'layer.property_price' },
  { key: 'crime_index', labelKey: 'layer.crime_rate' },
  { key: 'population_density', labelKey: 'layer.population_density' },
  { key: 'child_ratio', labelKey: 'layer.child_ratio' },
];

/** Valid similarity-metric keys, for validating a persisted user selection. */
export const SIMILARITY_METRIC_KEYS: ReadonlySet<string> = new Set(SIMILARITY_METRICS as string[]);

/** CF-5: per-metric weight bounds and default. A weight of 0 disables the metric;
 *  1 is the neutral default; up to 3 lets the user emphasise a metric 3× over a
 *  default-weighted one. The stepper UI and URL/localStorage codecs all clamp here. */
export const SIMILARITY_WEIGHT_MIN = 0;
export const SIMILARITY_WEIGHT_MAX = 3;
export const SIMILARITY_WEIGHT_DEFAULT = 1;

// Cache min/max ranges per dataset to avoid recomputing on every panel open.
// The dataset reference doesn't change after initial load, so we can key on identity.
let cachedFeatures: GeoJSON.Feature[] | null = null;
let cachedMins: Record<string, number> = {};
let cachedMaxs: Record<string, number> = {};

function getOrComputeRanges(allFeatures: GeoJSON.Feature[]): { mins: Record<string, number>; maxs: Record<string, number> } {
  if (cachedFeatures === allFeatures) return { mins: cachedMins, maxs: cachedMaxs };

  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};

  for (const metric of SIMILARITY_METRICS) {
    let min = Infinity;
    let max = -Infinity;
    for (const feature of allFeatures) {
      const val = (feature.properties as NeighborhoodProperties)?.[metric];
      if (typeof val === 'number' && isFinite(val)) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    if (min < max) {
      mins[metric as string] = min;
      maxs[metric as string] = max;
    }
  }

  cachedFeatures = allFeatures;
  cachedMins = mins;
  cachedMaxs = maxs;
  return { mins, maxs };
}

/**
 * Find the most similar neighborhoods to a target based on Euclidean distance
 * across normalized key metrics.
 *
 * @param target - The neighborhood to find similarities for
 * @param allFeatures - All GeoJSON features in the dataset
 * @param count - Number of similar neighborhoods to return (default 5)
 * @param metrics - Optional subset of metrics to compare on (default: all)
 * @param weights - CF-5: optional per-metric weight map (0–3). A metric absent from
 *   the map defaults to weight 1; weight 0 effectively excludes it. Each metric's
 *   normalized squared difference is multiplied by its weight before summing, and
 *   the total is normalized by the sum of weights actually used.
 * @returns Array of similar neighborhoods sorted by ascending distance
 */
export function findSimilarNeighborhoods(
  target: NeighborhoodProperties,
  allFeatures: GeoJSON.Feature[],
  count: number = 5,
  metrics?: (keyof NeighborhoodProperties)[],
  weights?: Record<string, number>,
): SimilarNeighborhood[] {
  // CF-6: caller may pass a user-chosen metric subset; default to all. Ranges are
  // always computed over the full metric set (cached per dataset), so switching the
  // subset never invalidates the cache — we just iterate fewer metrics here.
  const activeMetrics = metrics && metrics.length > 0 ? metrics : SIMILARITY_METRICS;

  // 1. Get cached or compute min/max for each metric across the entire dataset.
  // Before this fix, ranges were recomputed on every call (10 metrics × ~200 features
  // = ~2000 iterations). Now it's O(1) for repeated calls with the same dataset.
  const { mins, maxs } = getOrComputeRanges(allFeatures);

  // 2. Compute Euclidean distance for each candidate (defer center computation)
  const candidates: { feature: GeoJSON.Feature; properties: NeighborhoodProperties; distance: number }[] = [];

  for (const feature of allFeatures) {
    const props = feature.properties as NeighborhoodProperties;
    if (!props) continue;

    // Skip the target neighborhood itself
    if (props.pno === target.pno) continue;

    let sumSq = 0;
    // CF-5: accumulate the weight actually applied (skipping metrics with no
    // comparable value), so the distance normalizes by total weight rather than a
    // raw metric count. With all-default weights of 1 this reduces exactly to the
    // previous "divide by number of metrics used" behaviour.
    let usedWeight = 0;

    for (const metric of activeMetrics) {
      const key = metric as string;

      // CF-5: per-metric weight (default 1 when unspecified). A weight of 0 excludes
      // the metric entirely, equivalent to deselecting it.
      const weight = weights ? (key in weights ? weights[key] : SIMILARITY_WEIGHT_DEFAULT) : SIMILARITY_WEIGHT_DEFAULT;
      if (weight <= 0) continue;

      // Skip if min-max range is unavailable (all values identical or missing)
      if (!(key in mins)) continue;

      const targetVal = target[key];
      const candidateVal = props[key];

      // Skip metrics where either side is null/undefined/non-numeric/NaN
      if (typeof targetVal !== 'number' || !isFinite(targetVal)) continue;
      if (typeof candidateVal !== 'number' || !isFinite(candidateVal)) continue;

      const range = maxs[key] - mins[key];
      const normalizedTarget = (targetVal - mins[key]) / range;
      const normalizedCandidate = (candidateVal - mins[key]) / range;

      const diff = normalizedTarget - normalizedCandidate;
      sumSq += weight * diff * diff;
      usedWeight += weight;
    }

    // Only include candidates that share at least one comparable, positively-weighted metric
    if (usedWeight === 0) continue;

    // Normalize distance by total weight applied so comparisons with different
    // numbers of available metrics (or different weights) are still meaningful.
    const distance = Math.sqrt(sumSq / usedWeight);

    candidates.push({ feature, properties: props, distance });
  }

  // 3. Sort by ascending distance and compute centers only for top N
  candidates.sort((a, b) => a.distance - b.distance);

  return candidates.slice(0, count).map((c) => ({
    properties: c.properties,
    distance: c.distance,
    center: getFeatureCenter(c.feature),
  }));
}
