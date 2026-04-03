import type { NeighborhoodProperties } from '../utils/metrics';
import { getFeatureCenter } from '../utils/geometryFilter';

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
 * @returns Array of similar neighborhoods sorted by ascending distance
 */
export function findSimilarNeighborhoods(
  target: NeighborhoodProperties,
  allFeatures: GeoJSON.Feature[],
  count: number = 5,
): SimilarNeighborhood[] {
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
    let usedMetrics = 0;

    for (const metric of SIMILARITY_METRICS) {
      const key = metric as string;

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
      sumSq += diff * diff;
      usedMetrics++;
    }

    // Only include candidates that share at least one comparable metric
    if (usedMetrics === 0) continue;

    // Normalize distance by number of metrics used so comparisons with
    // different numbers of available metrics are still meaningful
    const distance = Math.sqrt(sumSq / usedMetrics);

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
