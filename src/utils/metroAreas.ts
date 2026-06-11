import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { CityId, NeighborhoodProperties } from './metrics';
import { computeChangeMetrics, computeMetroAverages } from './metrics';
import { REGIONS } from './regions';
import { t } from './i18n';
// CF-8: the per-region aggregation is shared with the build-time
// region_aggregates.json artifact (and lives in a Vite-free module so the build
// script can import it). aggregateTrendHistories moved there.
import { aggregateTrendHistories, type RegionAggregateRecord } from './metroAggregation';

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
        if (objectName) {
          const fc = feature(topo, topo.objects[objectName]) as FeatureCollection<OutlineGeometry>;
          for (const f of fc.features) {
            // seutukunnat.topojson keys each boundary by its regions.ts region id.
            const region = (f.properties as { region?: string } | null)?.region;
            if (region && f.geometry) outlinesByCity.set(region, f.geometry);
          }
        }
        if (outlinesByCity.size === 0) {
          // A 200 response that parsed no usable regions (empty/corrupt topology,
          // or no `region` properties) would otherwise leave outlinesPromise as a
          // resolved-but-empty promise, permanently locking buildMetroAreaFeatures
          // onto the MultiPolygon concat fallback — which preserves internal postal
          // borders (CLAUDE.md pitfall). Reset so a later call can retry.
          console.warn('[metroAreas] region outlines loaded but contained no regions; will retry');
          outlinesPromise = null;
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
  /**
   * Set by clearMetroAreaCache({ qualityIndexOnly: true }) to signal that only
   * the in-place `quality_index` property changed (a Custom Quality weight
   * edit). The next build then re-derives just the population-weighted
   * quality_index per region instead of the full ~46-metric aggregation.
   */
  qiDirty: boolean;
}
let metroAreaCache: MetroAreaCache | null = null;

/**
 * Invalidate cached metro area averages (e.g., after in-place quality index
 * recomputation). Per-city feature grouping and trend histories remain cached
 * — only the weighted averages are recomputed on the next buildMetroAreaFeatures
 * call.
 *
 * Pass `{ qualityIndexOnly: true }` when the only thing that changed is the
 * in-place `quality_index` (i.e. after computeQualityIndices on a weight edit,
 * which mutates no other property). The next build then recomputes just the
 * population-weighted quality_index per region and reuses the other ~45 cached
 * averages — they derive solely from immutable input properties. Without the
 * flag, ALL averages are recomputed (the safe default for any other mutation).
 */
export function clearMetroAreaCache(opts?: { qualityIndexOnly?: boolean }): void {
  if (!metroAreaCache) return;
  if (opts?.qualityIndexOnly && metroAreaCache.averages) {
    metroAreaCache.qiDirty = true;
  } else {
    metroAreaCache.averages = null;
  }
}

/**
 * Build seutukunta features for the "all cities" view.
 *
 * Groups neighborhoods by their `city` property, attaches the pre-baked
 * seutukunta boundary geometry from `src/data/seutukunnat.topojson`, and
 * attaches population-weighted average statistics + aggregated trend
 * histories for the regions that have ingested data.
 *
 * CF-5 Phase D: also emits a feature for every seutukunta WITHOUT data, marked
 * `_noData: true` and carrying no statistics. These render gray (the choropleth
 * fallback color) and — because they live in the same layer as the data
 * regions — get identical hover and click behavior: hovering shows a tooltip,
 * clicking opens the (empty) panel.
 *
 * Returns a FeatureCollection. Until the boundary file has loaded (the
 * preloadUnion fetch), only data regions are emitted; the
 * `useAllCitiesUnionPreload` hook ensures it is awaited before the all-cities
 * view is shown.
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

    metroAreaCache = { sourceFeatures: allFeatures, usedOutlines: hasOutlines, perCity, averages: null, qiDirty: false };
  }

  // Recompute per-city averages only when invalidated.
  // The grouped features and trend aggregations are always reused.
  if (!metroAreaCache.averages) {
    // First build for this dataset: derive the full ~46-metric average set.
    const avg = new Map<CityId, Record<string, number>>();
    for (const [cityId, cached] of metroAreaCache.perCity) {
      avg.set(cityId, computeMetroAverages(cached.features));
    }
    metroAreaCache.averages = avg;
    metroAreaCache.qiDirty = false;
  } else if (metroAreaCache.qiDirty) {
    // Quality-weight edit: computeQualityIndices mutates ONLY quality_index, so
    // every other population/household/job-weighted average and special ratio is
    // unchanged. Recompute just the population-weighted quality_index per region
    // (precision 1, matching the METRIC_DEFS quality_index def in metrics.ts)
    // instead of re-aggregating all ~46 metrics over every feature — that full
    // re-aggregation was the dominant cost of a Custom Quality slider drag in the
    // all-cities view (~3000 features × 69 regions per debounced settle).
    for (const [cityId, cached] of metroAreaCache.perCity) {
      const existing = metroAreaCache.averages.get(cityId);
      if (!existing) continue;
      let total = 0;
      let weight = 0;
      for (const f of cached.features) {
        const p = f.properties as NeighborhoodProperties;
        const pop = p.he_vakiy;
        if (pop == null || pop <= 0) continue;
        const qi = p.quality_index;
        if (qi == null || !isFinite(qi)) continue;
        total += qi * pop;
        weight += pop;
      }
      // Mirror computeMetroAverages: absent key (not 0/NaN) when no contributing
      // data, so the choropleth renders the region gray and panels show "no data".
      if (weight > 0) existing.quality_index = Math.round((total / weight) * 10) / 10;
      else delete existing.quality_index;
    }
    metroAreaCache.qiDirty = false;
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

  // Derive the trend-change layers (income / population / unemployment / crime
  // % change) from the histories aggregated above, mirroring the single-city
  // pipeline (computeChangeMetrics in dataLoader.ts). Without this the metro
  // features carried only the raw *_history arrays, so every trend choropleth
  // rendered gray in the all-cities view. property_price_change_pct is left as
  // computed by computeMetroAverages (it lives in METRIC_DEFS) and is untouched here.
  computeChangeMetrics(features);

  // CF-5 Phase D: emit a feature for every seutukunta WITHOUT ingested data.
  // They carry no statistics (so the choropleth renders them gray via its
  // null-value fallback) but live in the same layer as the data regions, so
  // hover and click behave identically — the panel opens, just empty.
  const dataRegions = new Set<string>(cityIds);
  for (const [regionId, geometry] of outlinesByCity) {
    if (dataRegions.has(regionId)) continue;
    if (!knownRegions.has(regionId)) continue;
    features.push({
      type: 'Feature',
      properties: {
        pno: regionId,
        nimi: t(`city.${regionId}`),
        namn: t(`city.${regionId}`),
        kunta: null,
        city: regionId,
        _isMetroArea: true,
        _noData: true,
      },
      geometry,
    });
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * CF-8: build the "all cities" features from the prebuilt per-region aggregate
 * records (`region_aggregates.json`) instead of the full national feature set.
 *
 * The all-Finland landing paints from this — the small artifact + the pre-baked
 * outlines — so it never downloads the ~10.6 MB region_properties.json before first
 * paint. The output is byte-equivalent to `buildMetroAreaFeatures(fullNationalData)`
 * for default weights (both attach the same `buildRegionAggregates`-derived props to
 * the same pre-baked outline geometry), so when a trigger later loads the full
 * dataset the view upgrades in place without the region colours shifting.
 *
 * Like `buildMetroAreaFeatures`, until the outline file has loaded only the regions
 * whose outline is cached are emitted; once `preloadUnion()` resolves, the caller's
 * `unionReady` bump rebuilds with every seutukunta (data + no-data) present. There is
 * no MultiPolygon-concat fallback here — the aggregate records carry no geometry — so
 * the view simply waits for the (small) outline fetch rather than flashing internal
 * postal borders.
 */
export function buildMetroAreaFeaturesFromAggregates(
  regions: Record<string, RegionAggregateRecord>,
): FeatureCollection {
  const knownRegions = new Set(Object.keys(REGIONS));
  const features: Feature<Polygon | MultiPolygon>[] = [];
  const dataRegions = new Set<string>();

  for (const cityId of Object.keys(regions)) {
    if (!knownRegions.has(cityId)) continue;
    const geometry = outlinesByCity.get(cityId);
    if (!geometry) continue; // outline not loaded yet — emitted on the unionReady rebuild
    dataRegions.add(cityId);
    features.push({
      type: 'Feature',
      properties: {
        ...regions[cityId],
        pno: cityId,
        nimi: t(`city.${cityId}`),
        namn: t(`city.${cityId}`),
        kunta: null,
        city: cityId,
        _isMetroArea: true,
      },
      geometry,
    });
  }

  // Mirror buildMetroAreaFeatures: emit a gray feature for every seutukunta WITHOUT
  // ingested data so all 69 regions are present, hoverable and clickable.
  for (const [regionId, geometry] of outlinesByCity) {
    if (dataRegions.has(regionId)) continue;
    if (!knownRegions.has(regionId)) continue;
    features.push({
      type: 'Feature',
      properties: {
        pno: regionId,
        nimi: t(`city.${regionId}`),
        namn: t(`city.${regionId}`),
        kunta: null,
        city: regionId,
        _isMetroArea: true,
        _noData: true,
      },
      geometry,
    });
  }

  return { type: 'FeatureCollection', features };
}

/**
 * Test-only: clear the outline-loaded cache so tests can re-prime fetch mocks
 * and re-run the load path. Not part of the production surface.
 */
export function _resetOutlinesForTests(): void {
  outlinesByCity.clear();
  outlinesPromise = null;
}
