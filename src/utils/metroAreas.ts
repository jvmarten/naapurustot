import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import union from '@turf/union';
import type { CityId, NeighborhoodProperties, TrendDataPoint } from './metrics';
import { computeMetroAverages, parseTrendSeries } from './metrics';
import { t } from './i18n';

/**
 * Aggregate trend history series across neighborhoods for a metro area.
 *
 * - population_history: summed per year
 * - income_history: population-weighted average per year
 * - unemployment_history: population-weighted average per year
 */
function aggregateTrendHistories(
  features: Feature[],
): Record<string, string> {
  const result: Record<string, string> = {};

  // Collect parsed series with their population weights
  const seriesData: {
    key: string;
    mode: 'sum' | 'weighted';
    entries: { series: TrendDataPoint[]; pop: number }[];
  }[] = [
    { key: 'population_history', mode: 'sum', entries: [] },
    { key: 'income_history', mode: 'weighted', entries: [] },
    { key: 'unemployment_history', mode: 'weighted', entries: [] },
  ];

  for (const f of features) {
    const p = f.properties as NeighborhoodProperties;
    const pop = p.he_vakiy;
    if (pop == null || pop <= 0) continue;

    for (const sd of seriesData) {
      const series = parseTrendSeries(p[sd.key] as string | null);
      if (series) {
        sd.entries.push({ series, pop });
      }
    }
  }

  for (const sd of seriesData) {
    if (sd.entries.length === 0) continue;

    // Collect all years across all neighborhoods
    const yearSet = new Set<number>();
    for (const e of sd.entries) {
      for (const [year] of e.series) yearSet.add(year);
    }
    const years = [...yearSet].sort((a, b) => a - b);

    const aggregated: TrendDataPoint[] = [];
    for (const year of years) {
      if (sd.mode === 'sum') {
        let total = 0;
        let count = 0;
        for (const e of sd.entries) {
          const point = e.series.find(([y]) => y === year);
          if (point) {
            total += point[1];
            count++;
          }
        }
        // Only include years where we have data from most neighborhoods
        if (count >= sd.entries.length * 0.5) {
          aggregated.push([year, Math.round(total)]);
        }
      } else {
        // Weighted average
        let weightedSum = 0;
        let totalWeight = 0;
        for (const e of sd.entries) {
          const point = e.series.find(([y]) => y === year);
          if (point) {
            weightedSum += point[1] * e.pop;
            totalWeight += e.pop;
          }
        }
        if (totalWeight > 0) {
          aggregated.push([year, Math.round((weightedSum / totalWeight) * 10) / 10]);
        }
      }
    }

    if (aggregated.length >= 2) {
      result[sd.key] = JSON.stringify(aggregated);
    }
  }

  return result;
}

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

    // Dissolve all postal code polygons into a single outer boundary
    // so internal postal code borders are eliminated
    const merged = union({ type: 'FeatureCollection', features: polyFeatures });
    if (!merged) continue;

    // Compute aggregated stats
    const averages = computeMetroAverages(cityFeatures);
    const trendHistories = aggregateTrendHistories(cityFeatures);

    // Build NeighborhoodProperties-compatible object
    // Use i18n keys for names so they respect language setting
    const props: Record<string, unknown> = {
      ...averages,
      ...trendHistories,
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
