import type { NeighborhoodProperties } from '../utils/metrics';

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
  'green_space_pct',
  'population_density',
  'child_ratio',
];

/**
 * Compute the center of a GeoJSON feature's geometry by taking the midpoint
 * of its bounding box.
 */
function featureCenter(feature: GeoJSON.Feature): [number, number] {
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  const geometry = feature.geometry;
  let coords: number[][][] = [];

  if (geometry.type === 'Polygon') {
    coords = (geometry as GeoJSON.Polygon).coordinates;
  } else if (geometry.type === 'MultiPolygon') {
    for (const poly of (geometry as GeoJSON.MultiPolygon).coordinates) {
      coords.push(...poly);
    }
  }

  for (const ring of coords) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
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
  // 1. Compute min/max for each metric across the entire dataset
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};

  for (const metric of SIMILARITY_METRICS) {
    let min = Infinity;
    let max = -Infinity;
    for (const feature of allFeatures) {
      const val = (feature.properties as NeighborhoodProperties)?.[metric];
      if (typeof val === 'number' && val != null) {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    if (min < max) {
      mins[metric as string] = min;
      maxs[metric as string] = max;
    }
  }

  // 2. Compute Euclidean distance for each candidate
  const results: SimilarNeighborhood[] = [];

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

      // Skip metrics where either side is null/undefined/non-numeric
      if (typeof targetVal !== 'number' || targetVal == null) continue;
      if (typeof candidateVal !== 'number' || candidateVal == null) continue;

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

    results.push({
      properties: props,
      distance,
      center: featureCenter(feature),
    });
  }

  // 3. Sort by ascending distance and return top N
  results.sort((a, b) => a.distance - b.distance);

  return results.slice(0, count);
}
