import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { CityId, NeighborhoodProperties, TrendDataPoint } from './metrics';
import { computeMetroAverages, parseTrendSeries } from './metrics';
import { REGIONS } from './regions';
import { t } from './i18n';

// CF-5 Phase D: the "all cities" view uses the full official seutukunta
// boundaries (src/data/seutukunnat.topojson, all 69 sub-regions) as the
// geometry for each metro-area feature. A data region therefore renders at
// its full seutukunta extent, not just the dissolved outline of the
// postal codes that happen to be ingested. This also keeps the runtime free
// of @turf/union (the boundaries are pre-baked at build time — see
// CLAUDE.md pitfalls #1-#4). Lazy-loaded on first entry to the all-cities view.
import outlinesUrl from '../data/seutukunnat.topojson?url';

type OutlineGeometry = Polygon | MultiPolygon;

const outlinesByCity = new Map<string, OutlineGeometry>();
let outlinesPromise: Promise<void> | null = null;

function ensureOutlinesLoaded(): Promise<void> {
  if (outlinesByCity.size > 0) return Promise.resolve();
  if (!outlinesPromise) {
    outlinesPromise = fetch(outlinesUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load region outlines: ${res.status}`);
        return res.json() as Promise<Topology>;
      })
      .then((topo) => {
        const objectName = Object.keys(topo.objects ?? {})[0];
        if (!objectName) return;
        const fc = feature(topo, topo.objects[objectName]) as FeatureCollection<OutlineGeometry>;
        for (const f of fc.features) {
          // seutukunnat.topojson keys each boundary by its regions.ts region id.
          const region = (f.properties as { region?: string } | null)?.region;
          if (region && f.geometry) outlinesByCity.set(region, f.geometry);
        }
      })
      .catch((err) => {
        // Don't propagate — the MultiPolygon concat fallback in
        // buildMetroAreaFeatures handles the degraded case (test environments
        // without a real fetch, transient network failures). Surface to
        // console so production issues remain visible to Sentry / logs.
        console.warn('[metroAreas] failed to load region outlines, falling back to runtime concat', err);
        outlinesPromise = null;
      });
  }
  return outlinesPromise;
}

/**
 * Pre-warm the region outlines fetch. Call this when the user is likely to
 * enter the all-cities view soon (e.g., when cityFilter becomes "all").
 * Returns a Promise that resolves when outlines are loaded and cached.
 *
 * Name retained for backward compatibility with `useAllCitiesUnionPreload`.
 */
export function preloadUnion(): Promise<void> {
  return ensureOutlinesLoaded();
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

    // Pre-build year→value Maps per entry to replace O(series_length) .find() lookups
    // in the inner loop. For 5 cities × ~50 neighborhoods × ~10 years this eliminates
    // thousands of linear scans.
    const entryMaps = sd.entries.map((e) => {
      const m = new Map<number, number>();
      for (const [y, v] of e.series) m.set(y, v);
      return { map: m, pop: e.pop };
    });

    const aggregated: TrendDataPoint[] = [];
    for (const year of years) {
      if (sd.mode === 'sum') {
        let total = 0;
        let count = 0;
        for (const em of entryMaps) {
          const val = em.map.get(year);
          if (val !== undefined) {
            total += val;
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
        for (const em of entryMaps) {
          const val = em.map.get(year);
          if (val !== undefined) {
            weightedSum += val * em.pop;
            totalWeight += em.pop;
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

function concatPolygonsFallback(cityFeatures: Feature[]): MultiPolygon | Polygon | null {
  const polygons: number[][][][] = [];
  for (const f of cityFeatures) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') {
      polygons.push(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) polygons.push(poly);
    }
  }
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

// Cache for per-city features / stats / trends / geometry. Geometry comes from
// the pre-baked outlines map when available, otherwise from a runtime
// MultiPolygon concat fallback. Test for outline-arrival happens via the
// `usedOutlines` flag: if the cache was populated before outlines loaded, it
// is invalidated on the next call once outlines become available.
interface MetroAreaCache {
  sourceFeatures: Feature[];
  usedOutlines: boolean;
  perCity: Map<CityId, {
    features: Feature[];
    trendHistories: Record<string, string>;
    geometry: Polygon | MultiPolygon;
  }>;
  averages: Map<CityId, Record<string, number>> | null;
}
let metroAreaCache: MetroAreaCache | null = null;

/**
 * Invalidate cached metro area averages (e.g., after in-place quality index
 * recomputation). Per-city feature grouping and trend histories remain cached
 * — only the weighted averages are recomputed on the next buildMetroAreaFeatures
 * call.
 */
export function clearMetroAreaCache(): void {
  if (metroAreaCache) metroAreaCache.averages = null;
}

/**
 * Build merged metro area features for the "all cities" view.
 *
 * Groups neighborhoods by their `city` property, attaches the pre-baked
 * outer-boundary geometry from `src/data/region_outlines.topojson`, and
 * attaches population-weighted average statistics + aggregated trend
 * histories as properties.
 *
 * Returns a FeatureCollection. If outlines haven't been loaded yet (the
 * preloadUnion fetch hasn't resolved), returns an empty FeatureCollection;
 * callers should ensure preloadUnion() is awaited before relying on output.
 * The `useAllCitiesUnionPreload` hook handles this in practice.
 */
export function buildMetroAreaFeatures(
  allFeatures: Feature[],
): FeatureCollection {
  // Discover city IDs dynamically from data, but only include known regions
  const knownRegions = new Set(Object.keys(REGIONS));
  const cityIdSet = new Set<CityId>();
  for (const f of allFeatures) {
    const city = (f.properties as NeighborhoodProperties)?.city;
    if (city && knownRegions.has(city)) cityIdSet.add(city);
  }
  const cityIds = [...cityIdSet];

  // Reuse cached grouping and stats when the underlying dataset hasn't changed
  // AND the outline-availability state hasn't changed. If outlines became
  // available since the cache was built with fallback geometry, rebuild so
  // every city upgrades to its dissolved outline.
  const hasOutlines = outlinesByCity.size > 0;
  if (
    !metroAreaCache ||
    metroAreaCache.sourceFeatures !== allFeatures ||
    (!metroAreaCache.usedOutlines && hasOutlines)
  ) {
    const grouped: Record<string, Feature[]> = {};
    for (const id of cityIds) grouped[id] = [];

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

      const geometry: Polygon | MultiPolygon | null =
        outlinesByCity.get(cityId) ?? concatPolygonsFallback(cityFeatures);
      if (!geometry) continue;

      perCity.set(cityId, {
        features: cityFeatures,
        trendHistories: aggregateTrendHistories(cityFeatures),
        geometry,
      });
    }

    metroAreaCache = { sourceFeatures: allFeatures, usedOutlines: hasOutlines, perCity, averages: null };
  }

  // Recompute per-city averages only when invalidated (e.g., after quality
  // weight change). The grouped features and trend aggregations are reused.
  if (!metroAreaCache.averages) {
    const avg = new Map<CityId, Record<string, number>>();
    for (const [cityId, cached] of metroAreaCache.perCity) {
      avg.set(cityId, computeMetroAverages(cached.features));
    }
    metroAreaCache.averages = avg;
  }

  // Build features using cached geometry + current-language names.
  const features: Feature<Polygon | MultiPolygon>[] = [];

  for (const cityId of cityIds) {
    const cached = metroAreaCache.perCity.get(cityId);
    if (!cached) continue;
    const averages = metroAreaCache.averages.get(cityId) ?? {};

    const props: Record<string, unknown> = {
      ...averages,
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

/**
 * Test-only: clear the outline-loaded cache so tests can re-prime fetch mocks
 * and re-run the load path. Not part of the production surface.
 */
export function _resetOutlinesForTests(): void {
  outlinesByCity.clear();
  outlinesPromise = null;
}
