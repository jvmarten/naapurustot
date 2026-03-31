import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import type { CityId, NeighborhoodProperties, TrendDataPoint } from './metrics';
import { computeMetroAverages, parseTrendSeries } from './metrics';
import { t } from './i18n';

// Lazy-load @turf/union (~40KB) — only needed when user views "all cities" mode.
// Other @turf modules (bbox, boolean-intersects, boolean-point-in-polygon) are
// already lazy-loaded; this follows the same pattern to keep the main bundle small.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let unionFn: ((...args: any[]) => any) | null = null;
let unionPromise: Promise<void> | null = null;

// Indirection prevents Vite/Vitest static analysis from resolving the specifier
// at transform time, so the import only fails at runtime (where we catch it).
const _turfUnionId = '@turf/' + 'union';

function ensureUnionLoaded(): Promise<void> {
  if (unionFn) return Promise.resolve();
  if (!unionPromise) {
    // @turf/union is optional — if not installed, we fall back to MultiPolygon concatenation
    unionPromise = import(_turfUnionId)
      .then((m) => { unionFn = m.default; })
      .catch(() => { /* package not installed, union stays null */ });
  }
  return unionPromise;
}

/** Pre-warm the union import. Call this when user is likely to need it soon.
 *  Returns a Promise that resolves when the module is loaded. */
export function preloadUnion(): Promise<void> {
  return ensureUnionLoaded();
}

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

// Cache for expensive polygon union results.
// The geometry of metro areas never changes — only the display names change
// when the user toggles language. By caching geometry, stats, and trend data
// per dataset identity, we avoid re-running @turf/union (~100ms per city)
// on every language toggle.
interface MetroAreaCache {
  sourceFeatures: Feature[];
  usedUnion: boolean;
  perCity: Map<CityId, {
    geometry: Polygon | MultiPolygon;
    averages: Record<string, number>;
    trendHistories: Record<string, string>;
  }>;
}
let metroAreaCache: MetroAreaCache | null = null;

/**
 * Build merged metro area features for the "all cities" view.
 *
 * Groups neighborhoods by their `city` property, dissolves their geometries
 * into a single outer boundary per city (no internal postal code borders),
 * and attaches population-weighted average statistics as properties.
 *
 * Geometry unions and statistical aggregations are cached per dataset identity.
 * On language change, only the display name properties are refreshed — the
 * expensive @turf/union calls are skipped entirely.
 *
 * Returns null if the @turf/union module hasn't been loaded yet. The caller
 * should trigger a load (via the returned onReady callback) and retry.
 */
export function buildMetroAreaFeatures(
  allFeatures: Feature[],
): FeatureCollection | null {
  const cityIds: CityId[] = ['helsinki_metro', 'turku', 'tampere'];

  // Reuse cached geometry and stats when the underlying dataset hasn't changed
  // AND @turf/union availability hasn't changed (fallback cache must be invalidated
  // once union loads so geometries are properly dissolved).
  const hasUnion = !!unionFn;
  if (!metroAreaCache || metroAreaCache.sourceFeatures !== allFeatures || (!metroAreaCache.usedUnion && hasUnion)) {
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

    const perCity = new Map<CityId, MetroAreaCache['perCity'] extends Map<CityId, infer V> ? V : never>();

    for (const cityId of cityIds) {
      const cityFeatures = grouped[cityId];
      if (cityFeatures.length === 0) continue;

      const polyFeatures = cityFeatures.filter((f) => {
        const tp = f.geometry?.type;
        return tp === 'Polygon' || tp === 'MultiPolygon';
      }) as Feature<Polygon | MultiPolygon>[];

      if (polyFeatures.length === 0) continue;

      let merged: Feature<Polygon | MultiPolygon> | null;
      if (polyFeatures.length === 1) {
        merged = polyFeatures[0];
      } else if (unionFn) {
        merged = unionFn({ type: 'FeatureCollection', features: polyFeatures });
      } else {
        // Fallback: concatenate into a MultiPolygon (no border dissolve)
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
        merged = { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } };
      }
      if (!merged) continue;

      perCity.set(cityId, {
        geometry: merged.geometry,
        averages: computeMetroAverages(cityFeatures),
        trendHistories: aggregateTrendHistories(cityFeatures),
      });
    }

    metroAreaCache = { sourceFeatures: allFeatures, usedUnion: hasUnion, perCity };
  }

  // Build features using cached geometry + current-language names
  const features: Feature<Polygon | MultiPolygon>[] = [];

  for (const cityId of cityIds) {
    const cached = metroAreaCache.perCity.get(cityId);
    if (!cached) continue;

    const props: Record<string, unknown> = {
      ...cached.averages,
      ...cached.trendHistories,
      pno: cityId,
      nimi: t(`city.${cityId}`),
      namn: t(`city.${cityId}`),
      kunta: null,
      city: cityId,
      _isMetroArea: true,
    };

    features.push({
      type: 'Feature',
      properties: props,
      geometry: cached.geometry,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
