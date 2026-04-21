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

/**
 * For MultiPolygon features, remove tiny island polygons and keep only
 * significant land masses (at least 15% of the largest polygon's area).
 */
export function filterSmallIslands(features: Feature[]): Feature[] {
  return features.map((feature) => {
    const geom = feature.geometry;
    if (!geom || geom.type !== 'MultiPolygon' || geom.coordinates.length <= 1) {
      return feature;
    }

    const areas = geom.coordinates.map((poly) => polygonArea(poly));
    const maxArea = Math.max(...areas);
    const threshold = maxArea * 0.15;

    const filtered = geom.coordinates.filter((_, i) => areas[i] >= threshold);

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
  if (!('coordinates' in geom)) {
    if (geom.type === 'GeometryCollection' && geom.geometries?.length) {
      return getFeatureCenter({ ...feature, geometry: geom.geometries[0] });
    }
    return [0, 0];
  }

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
