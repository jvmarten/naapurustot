import type { Feature, MultiPolygon, Polygon } from 'geojson';

/**
 * Calculate the area of a polygon ring using the shoelace formula.
 * Works with [lng, lat] coordinates; returns approximate relative area.
 * Not geodesically accurate, but sufficient for comparing polygon sizes within a small region.
 */
function ringArea(coords: number[][]): number {
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n - 1; i++) {
    area += coords[i][0] * coords[i + 1][1];
    area -= coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area) / 2;
}

/**
 * Calculate the net area of a polygon (outer ring minus holes).
 */
function polygonArea(rings: number[][][]): number {
  if (rings.length === 0) return 0;
  let area = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    area -= ringArea(rings[i]);
  }
  return Math.max(0, area);
}

/** Square kilometres per square degree at the equator (111.32 km per degree). */
const KM2_PER_DEG2 = 111.32 * 111.32;

/**
 * A part at least this large is kept whatever its share of the largest part.
 *
 * The relative rule alone dropped real land: a postal area's parts are its land, cut
 * at the shore, and an archipelago area's mainland piece can be a small share of its
 * largest island. 10600 (Tammisaari keskus) lost an 11 km² block of mainland west of
 * Ekenäs that way and the map showed bare basemap there; across Finland 277 parts over
 * 1 km² went missing. Below 0.1 km² (~300 m square) a part is a skerry that never
 * fills a pixel at the zooms that draw postal areas, so the relative rule still
 * clears those and keeps archipelago areas light to draw.
 */
export const MIN_KEEP_KM2 = 0.1;

/** A polygon's area in km², from its shoelace area in degrees scaled at its latitude. */
function polygonAreaKm2(rings: number[][][]): number {
  const lat = rings[0]?.[0]?.[1] ?? 0;
  return polygonArea(rings) * KM2_PER_DEG2 * Math.cos((lat * Math.PI) / 180);
}

/**
 * For MultiPolygon features, remove tiny island polygons: a part goes only when it is
 * both under 15% of the largest part's area and under `keepAboveKm2` (MIN_KEEP_KM2).
 * Pass `keepAboveKm2: Infinity` to apply the relative rule alone.
 */
export function filterSmallIslands(
  features: Feature[],
  { keepAboveKm2 = MIN_KEEP_KM2 }: { keepAboveKm2?: number } = {},
): Feature[] {
  return features.map((feature) => {
    const geom = feature.geometry;
    if (!geom || geom.type !== 'MultiPolygon' || geom.coordinates.length <= 1) {
      return feature;
    }

    const areas = geom.coordinates.map((poly) => polygonArea(poly));
    const maxArea = Math.max(...areas);
    const threshold = maxArea * 0.15;

    const filtered = geom.coordinates.filter((poly, i) => areas[i] >= threshold || polygonAreaKm2(poly) >= keepAboveKm2);

    if (filtered.length === geom.coordinates.length) {
      return feature;
    }

    const newGeometry: MultiPolygon | Polygon =
      filtered.length === 1
        ? { type: 'Polygon', coordinates: filtered[0] }
        : { type: 'MultiPolygon', coordinates: filtered };

    return { ...feature, geometry: newGeometry };
  });
}

/**
 * Compute the center of a GeoJSON feature as the midpoint of its bounding box.
 * Returns [lng, lat]. Falls back to [0, 0] for unsupported geometry types
 * or features with no coordinates.
 *
 * Uses bbox midpoint rather than vertex centroid because GeoJSON rings include
 * a duplicate closing vertex, which biases a naive vertex average toward the
 * first/last point.
 */
export function getFeatureCenter(feature: Feature): [number, number] {
  const geom = feature.geometry;
  if (!geom) return [0, 0];
  if (geom.type === 'Point') return geom.coordinates as [number, number];
  if (!('coordinates' in geom)) return [0, 0];

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  // Iterative coordinate scanning using an explicit stack instead of recursive
  // forEach calls. Avoids closure allocation and function call overhead per
  // coordinate ring (matters when called for many features, e.g. ranking).
  const stack: unknown[] = [geom.coordinates];
  while (stack.length > 0) {
    const item = stack.pop()!;
    const arr = item as unknown[];
    if (typeof arr[0] === 'number') {
      const lng = arr[0] as number;
      const lat = arr[1] as number;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (let i = arr.length - 1; i >= 0; i--) stack.push(arr[i]);
    }
  }

  if (!isFinite(minLng)) return [0, 0];
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}
