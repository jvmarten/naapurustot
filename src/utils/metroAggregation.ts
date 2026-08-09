/**
 * CF-8: the per-region aggregation shared by the runtime all-cities view and the
 * build-time `region_aggregates.json` artifact.
 *
 * This module is intentionally free of any Vite-only imports (`?url`, `t()`), so
 * `scripts/build_region_aggregates.mjs` can import it under Node's TypeScript
 * stripping (the same path prerender.mjs uses) and emit an artifact whose per-region
 * property records are byte-identical to what `buildMetroAreaFeatures` computes at
 * runtime. That parity is what lets the all-Finland landing paint from the small
 * prebuilt aggregates and then "upgrade in place" to the full national dataset
 * without the region colours shifting.
 */
import type { Feature } from 'geojson';
import type { NeighborhoodProperties, TrendDataPoint } from './metrics';
// Explicit .ts extensions on the VALUE imports so scripts/build_region_aggregates.mjs
// can load this module under Node's TypeScript stripping (type-only imports above are
// erased, so they don't need one). The app's bundler resolution accepts .ts too.
import { computeMetroAverages, computeChangeMetrics, parseTrendSeries } from './metrics.ts';
import { REGIONS } from './regions.ts';

/**
 * Aggregate trend history series across neighborhoods for a metro area.
 *
 * - population_history: summed per year
 * - income_history: population-weighted average per year
 * - unemployment_history: population-weighted average per year
 * - property_price_history: population-weighted average per year
 * - crime_index_history: population-weighted average per year
 */
export function aggregateTrendHistories(features: Feature[]): Record<string, string> {
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
    { key: 'property_price_history', mode: 'weighted', entries: [] },
    { key: 'crime_index_history', mode: 'weighted', entries: [] },
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

/** The pre-aggregated property record for one region (averages + trend histories +
 *  the derived *_change_pct metrics), exactly as a metro-area feature carries them. */
export type RegionAggregateRecord = Record<string, unknown>;

/** Shape of `src/data/region_aggregates.json`. */
export interface RegionAggregatesData {
  /** Population-weighted national averages (the all-cities `metroAverages`). */
  national: Record<string, number>;
  /** Per-region (`city`) aggregated property records, keyed by region id. */
  regions: Record<string, RegionAggregateRecord>;
  /**
   * The national postal composite distribution as ascending `[quality_index, count]`
   * pairs — every one of the 3,018 areas, in ~30 pairs because the composite is an
   * integer.
   *
   * The all-Finland landing needs it to honour the selected quality display scale
   * (qualityScale.ts): it paints the 69 regional means and never loads the postal set
   * those means came from, so it has no cohort to stretch/winsorize/rank against.
   * Deriving one from the 69 means instead would put the landing and the full-data view
   * on different scales and change a region's number depending on how you reached it.
   *
   * Optional so a stale cached artifact from before this field still loads (the scale
   * then falls back to raw, as it did before).
   */
  qualityCohort?: [number, number][];
}

/**
 * CF-8: compute the per-region aggregate records over the full national feature set,
 * mirroring `buildMetroAreaFeatures` exactly so the prebuilt artifact and the runtime
 * full-data build agree: group by `city` (known regions only), take the
 * population-weighted `computeMetroAverages` + `aggregateTrendHistories` per region,
 * then run `computeChangeMetrics` over the assembled records to derive the
 * income/population/unemployment/crime `*_change_pct` fields.
 *
 * Precondition: `allFeatures` must already carry the per-feature `quality_index`,
 * `*_change_pct` and quick-win fields (i.e. processed exactly as the runtime
 * `processProperties` does), so `computeMetroAverages` sees the same inputs.
 */
export function buildRegionAggregates(allFeatures: Feature[]): RegionAggregatesData {
  const knownRegions = new Set(Object.keys(REGIONS));
  const grouped = new Map<string, Feature[]>();
  for (const f of allFeatures) {
    const city = (f.properties as NeighborhoodProperties)?.city;
    if (city && knownRegions.has(city)) {
      let arr = grouped.get(city);
      if (!arr) { arr = []; grouped.set(city, arr); }
      arr.push(f);
    }
  }

  // Build one synthetic feature per region so computeChangeMetrics — which mutates
  // feature.properties from the *_history arrays — runs identically to the runtime
  // buildMetroAreaFeatures path (which calls it on the assembled metro features).
  const order: string[] = [];
  const synthetic: Feature[] = [];
  for (const [cityId, feats] of grouped) {
    const props: Record<string, unknown> = {
      ...computeMetroAverages(feats),
      ...aggregateTrendHistories(feats),
    };
    order.push(cityId);
    // geometry: null is valid GeoJSON but outside the non-null Feature default type;
    // these synthetic features are only ever read for their properties.
    synthetic.push({ type: 'Feature', properties: props, geometry: null } as unknown as Feature);
  }
  computeChangeMetrics(synthetic);

  const regions: Record<string, RegionAggregateRecord> = {};
  for (let i = 0; i < order.length; i++) {
    regions[order[i]] = synthetic[i].properties as RegionAggregateRecord;
  }

  return { national: computeMetroAverages(allFeatures), regions };
}
