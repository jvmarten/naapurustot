/**
 * Canonical percentile-rank helpers (CF-11).
 *
 * Computes, for a single neighbourhood, where a metric value falls within a
 * distribution — both nationally (all loaded areas) and within its own region
 * (seutukunta). These ranks power the verifiable "top X%" superlatives surfaced
 * in the prerendered profile HTML (meta description, noscript FAQ, JSON-LD) and
 * in the client-rendered structured data (src/components/profile/JsonLd.tsx),
 * so both must agree to the integer percentile.
 *
 * Design notes:
 *  - Pure and dependency-free, so the build-time prerenderer (an .mjs that
 *    cannot import the bundled app) can replicate the exact same formulas.
 *  - The distribution is derived from the actual values present in the supplied
 *    feature properties — never fabricated. national_ranges.json only carries
 *    winsorized min/max/avg (not a full distribution), so a true percentile
 *    rank must come from the per-area values; this module takes those values as
 *    input rather than reaching for a synthetic curve.
 *  - "Top percentile" is the rank from the favourable end. For metrics where a
 *    higher raw value is better (quality_index, income, transit reachability)
 *    the favourable end is the top, so topPercentile = 100 - percentileRank.
 */

/** Metrics surfaced as CF-11 percentile superlatives, plus their "better" direction. */
export interface MetricDirection {
  /** Property key on a neighbourhood's properties. */
  prop: string;
  /** true → a higher raw value ranks better (top of the distribution is best). */
  higherIsBetter: boolean;
}

/**
 * The three metrics CF-11 surfaces. `quality_index` and `transit_reachability_score`
 * are 0–100 composite scores; `hr_mtu` is the Statistics Finland median income (€/yr).
 * For all three, a higher value is the better/“top” end.
 */
export const PERCENTILE_METRICS: Record<'quality' | 'income' | 'transit', MetricDirection> = {
  quality: { prop: 'quality_index', higherIsBetter: true },
  income: { prop: 'hr_mtu', higherIsBetter: true },
  transit: { prop: 'transit_reachability_score', higherIsBetter: true },
};

/** Anything with a `.properties` bag of numbers — GeoJSON features or bare property objects. */
export interface HasProperties {
  properties?: Record<string, unknown> | null;
}

/** Extract a finite numeric metric value, or null if missing/non-finite. */
export function readMetric(source: HasProperties | Record<string, unknown> | null | undefined, prop: string): number | null {
  if (!source) return null;
  const bag = (source as HasProperties).properties ?? (source as Record<string, unknown>);
  const raw = (bag as Record<string, unknown>)?.[prop];
  // Number(null) === 0 and Number('') === 0, so reject empties before coercion —
  // a missing income must not be read as a real 0.
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** A sorted ascending array of finite values for a metric. Pure helper. */
export function distributionFor(
  sources: Array<HasProperties | Record<string, unknown>>,
  prop: string,
  options: { requirePositive?: boolean } = {},
): number[] {
  const out: number[] = [];
  for (const s of sources) {
    const v = readMetric(s, prop);
    if (v == null) continue;
    if (options.requirePositive && v <= 0) continue;
    out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Percentile rank of `value` within an already-sorted ascending distribution:
 * the share (0–100) of observations with value <= `value`. Returns null when
 * the value is non-finite or the distribution is empty.
 *
 * Uses the "<=" (weak) convention so an area's own value is counted, matching
 * the prerenderer's original quality-index formula.
 */
export function percentileRankSorted(sorted: number[], value: number): number | null {
  if (!Number.isFinite(value) || sorted.length === 0) return null;
  // Binary search for the first index whose value is > value.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sorted.length) * 100;
}

/** Convenience: derive the distribution and return the percentile rank in one call. */
export function percentileRank(
  sources: Array<HasProperties | Record<string, unknown>>,
  prop: string,
  value: number,
  options: { requirePositive?: boolean } = {},
): number | null {
  return percentileRankSorted(distributionFor(sources, prop, options), value);
}

/**
 * "Top percentile" from the favourable end, as an integer in [1, 100].
 *
 * For a higher-is-better metric, an area in the 97th percentile is in the top
 * 3%. The result is floored at 1 (you can never be "top 0%") and rounded, so it
 * reads naturally in copy like "in the top 5% nationally".
 */
export function topPercentileFromRank(rank: number | null, higherIsBetter: boolean): number | null {
  if (rank == null) return null;
  const fromTop = higherIsBetter ? 100 - rank : rank;
  return Math.max(1, Math.round(fromTop));
}

/** Result bundle for one metric: its national and within-region standing. */
export interface MetricPercentile {
  /** Percentile rank nationally (share of areas at or below this value), 0–100. */
  national: number | null;
  /** Percentile rank within the same region, 0–100. */
  regional: number | null;
  /** Integer "top X%" nationally from the favourable end, 1–100. */
  nationalTop: number | null;
  /** Integer "top X%" within the region from the favourable end, 1–100. */
  regionalTop: number | null;
}

/**
 * Compute national and within-region percentiles for one metric.
 *
 * @param value           the neighbourhood's raw metric value
 * @param direction       the metric and its "better" direction
 * @param nationalSources every loaded area (the national distribution)
 * @param regionalSources areas in the same region (subset of nationalSources)
 * @param options         requirePositive drops non-positive values (e.g. income placeholders)
 */
export function metricPercentile(
  value: number | null,
  direction: MetricDirection,
  nationalSources: Array<HasProperties | Record<string, unknown>>,
  regionalSources: Array<HasProperties | Record<string, unknown>>,
  options: { requirePositive?: boolean } = {},
): MetricPercentile {
  if (value == null || !Number.isFinite(value)) {
    return { national: null, regional: null, nationalTop: null, regionalTop: null };
  }
  const national = percentileRank(nationalSources, direction.prop, value, options);
  const regional = percentileRank(regionalSources, direction.prop, value, options);
  return {
    national,
    regional,
    nationalTop: topPercentileFromRank(national, direction.higherIsBetter),
    regionalTop: topPercentileFromRank(regional, direction.higherIsBetter),
  };
}

/** Bundle of all CF-11 percentile metrics for one neighbourhood. */
export interface NeighbourhoodPercentiles {
  quality: MetricPercentile;
  income: MetricPercentile;
  transit: MetricPercentile;
}

/**
 * Compute the full CF-11 percentile bundle (quality, income, transit) for a
 * single neighbourhood, given its properties and the national/regional cohorts.
 *
 * Income uses requirePositive: a 0 or negative median income is a missing-data
 * placeholder in Paavo and must not pollute the distribution or the rank.
 */
export function computeNeighbourhoodPercentiles(
  props: Record<string, unknown>,
  nationalSources: Array<HasProperties | Record<string, unknown>>,
  regionalSources: Array<HasProperties | Record<string, unknown>>,
): NeighbourhoodPercentiles {
  const qv = readMetric(props, PERCENTILE_METRICS.quality.prop);
  const iv = readMetric(props, PERCENTILE_METRICS.income.prop);
  const tv = readMetric(props, PERCENTILE_METRICS.transit.prop);
  return {
    quality: metricPercentile(qv, PERCENTILE_METRICS.quality, nationalSources, regionalSources),
    income: metricPercentile(iv, PERCENTILE_METRICS.income, nationalSources, regionalSources, { requirePositive: true }),
    transit: metricPercentile(tv, PERCENTILE_METRICS.transit, nationalSources, regionalSources),
  };
}
