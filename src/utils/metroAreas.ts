import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { CityId, NeighborhoodProperties } from './metrics';
import { computeMetroAverages } from './metrics';
import { t } from './i18n';
import union from '@turf/union';

/**
 * Build merged metro area features for the "all cities" view.
 *
 * Groups neighborhoods by their `city` property, dissolves their geometries
 * into a single outer boundary per city (no internal postal code borders),
 * and attaches population-weighted average statistics as properties.
 */
export function buildMetroAreaFeatures(
  allFeatures: Feature[],
): FeatureCollection {
  const cityIds: CityId[] = ['helsinki_metro', 'turku', 'tampere'];
  const grouped: Record<CityId, Feature[]> = {
    helsinki_metro: [],
    turku: [],
    tampere: [],
  };

  for (const f of allFeatures) {
    const city = (f.properties as NeighborhoodProperties)?.city;
    if (city && grouped[city]) {
      grouped[city].push(f);
    }
  }

  const features: Feature<Polygon | MultiPolygon>[] = [];

  for (const cityId of cityIds) {
    const cityFeatures = grouped[cityId];
    if (cityFeatures.length === 0) continue;

    // Collect valid polygon features for union
    const polyFeatures = cityFeatures.filter((f) => {
      const t = f.geometry?.type;
      return t === 'Polygon' || t === 'MultiPolygon';
    }) as Feature<Polygon | MultiPolygon>[];

    if (polyFeatures.length === 0) continue;

    // Dissolve all polygons into a single outer boundary
    let merged: Feature<Polygon | MultiPolygon> | null = null;
    try {
      const fc: FeatureCollection<Polygon | MultiPolygon> = {
        type: 'FeatureCollection',
        features: polyFeatures,
      };
      merged = union(fc);
    } catch {
      // Fallback: use raw MultiPolygon if union fails
      const polygons: number[][][][] = [];
      for (const f of polyFeatures) {
        if (f.geometry.type === 'Polygon') {
          polygons.push(f.geometry.coordinates);
        } else {
          for (const poly of f.geometry.coordinates) {
            polygons.push(poly);
          }
        }
      }
      merged = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: polygons },
      };
    }

    if (!merged) continue;

    // Compute aggregated stats
    const averages = computeMetroAverages(cityFeatures);

    // Build NeighborhoodProperties-compatible object
    // Use i18n keys for names so they respect language setting
    const props: Record<string, unknown> = {
      ...averages,
      pno: cityId, // Used as feature ID by MapLibre (promoteId)
      nimi: t(`city.${cityId}`),
      namn: t(`city.${cityId}`),
      kunta: null,
      city: cityId,
      _isMetroArea: true, // Marker to distinguish from postal code features
    };

    features.push({
      type: 'Feature',
      properties: props,
      geometry: merged.geometry,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
