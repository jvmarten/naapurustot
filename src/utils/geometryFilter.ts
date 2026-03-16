import type { Feature, MultiPolygon, Polygon } from 'geojson';

/**
 * Calculate the area of a polygon ring using the shoelace formula.
 * Works with [lng, lat] coordinates; returns approximate relative area.
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
  let area = ringArea(rings[0]);
  for (let i = 1; i < rings.length; i++) {
    area -= ringArea(rings[i]);
  }
  return Math.abs(area);
}

/**
 * For MultiPolygon features, remove tiny island polygons and keep only
 * significant land masses (at least 15% of the largest polygon's area).
 */
export function filterSmallIslands(features: Feature[]): Feature[] {
  return features.map((feature) => {
    const geom = feature.geometry;
    if (geom.type !== 'MultiPolygon' || geom.coordinates.length <= 1) {
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
