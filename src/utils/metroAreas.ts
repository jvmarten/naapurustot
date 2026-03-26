import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { CityId, NeighborhoodProperties } from './metrics';
import { computeMetroAverages } from './metrics';

/** City display names (Finnish) — used as `nimi` for metro area features. */
const CITY_NAMES_FI: Record<CityId, string> = {
  helsinki_metro: 'Helsingin seutu',
  turku: 'Turun seutu',
  tampere: 'Tampereen seutu',
};

const CITY_NAMES_SV: Record<CityId, string> = {
  helsinki_metro: 'Helsingforsregionen',
  turku: 'Åboregionen',
  tampere: 'Tammerforsregionen',
};

/**
 * Build merged metro area features for the "all cities" view.
 *
 * Groups neighborhoods by their `city` property, merges their geometries into
 * a single MultiPolygon per city, and attaches population-weighted average
 * statistics as properties so the panel and tooltip work seamlessly.
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

  const features: Feature<MultiPolygon>[] = [];

  for (const cityId of cityIds) {
    const cityFeatures = grouped[cityId];
    if (cityFeatures.length === 0) continue;

    // Collect all polygon rings into a MultiPolygon
    const polygons: number[][][][] = [];
    for (const f of cityFeatures) {
      const geom = f.geometry;
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        polygons.push((geom as Polygon).coordinates);
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of (geom as MultiPolygon).coordinates) {
          polygons.push(poly);
        }
      }
    }

    // Compute aggregated stats
    const averages = computeMetroAverages(cityFeatures);

    // Build NeighborhoodProperties-compatible object
    const props: Record<string, unknown> = {
      ...averages,
      pno: cityId, // Used as feature ID by MapLibre (promoteId)
      nimi: CITY_NAMES_FI[cityId],
      namn: CITY_NAMES_SV[cityId],
      kunta: null,
      city: cityId,
      _isMetroArea: true, // Marker to distinguish from postal code features
    };

    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'MultiPolygon',
        coordinates: polygons,
      },
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
