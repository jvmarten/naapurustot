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

/** The metric keys CF-11/CF-8 surface as percentile superlatives. */
export type PercentileMetricKey =
  | 'quality'
  | 'income'
  | 'transit'
  | 'crime'
  | 'air'
  | 'treeCanopy'
  | 'education'
  | 'employment';

/**
 * The metrics surfaced as percentile superlatives, with each metric's "better"
 * direction.
 *
 * CF-11 seeded three high-coverage, clear-direction metrics: `quality_index` and
 * `transit_reachability_score` are 0–100 composite scores; `hr_mtu` is the
 * Statistics Finland median income (€/yr) — for all three a higher value is the
 * better/"top" end.
 *
 * CF-8 broadens this to five more high-coverage, unambiguous-direction metrics:
 *  - `crime_index` (100% coverage) — lower is better (less crime).
 *  - `air_quality_index` (100%) — lower is better (lower index = cleaner air).
 *  - `tree_canopy_pct` (100%) — higher is better (more greenery).
 *  - `higher_education_rate` (97%) — higher is better.
 *  - `employment_rate` (97%) — higher is better.
 */
export const PERCENTILE_METRICS: Record<PercentileMetricKey, MetricDirection> = {
  quality: { prop: 'quality_index', higherIsBetter: true },
  income: { prop: 'hr_mtu', higherIsBetter: true },
  transit: { prop: 'transit_reachability_score', higherIsBetter: true },
  crime: { prop: 'crime_index', higherIsBetter: false },
  air: { prop: 'air_quality_index', higherIsBetter: false },
  treeCanopy: { prop: 'tree_canopy_pct', higherIsBetter: true },
  education: { prop: 'higher_education_rate', higherIsBetter: true },
  employment: { prop: 'employment_rate', higherIsBetter: true },
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

/**
 * Inverse of `percentileRankSorted`: the value at percentile `p` (0–100) within
 * an already-sorted ascending distribution — i.e. the quantile. Returns null for
 * an empty distribution or a non-finite `p`.
 *
 * CF-7: powers percentile-mode range filters, where the slider expresses a 0–100
 * rank and `computeMatchingPnos` resolves each bound to a concrete metric value at
 * filter time. Uses linear interpolation between the two straddling observations
 * (the same convention as `Math`-style quantiles), with the rank clamped to
 * [0, 100] so a hand-edited URL can never index out of bounds. p=0 → the minimum,
 * p=100 → the maximum.
 */
export function valueAtPercentileSorted(sorted: number[], p: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(p)) return null;
  const clamped = p <= 0 ? 0 : p >= 100 ? 100 : p;
  if (sorted.length === 1) return sorted[0];
  // Position on the 0..(n-1) index axis.
  const pos = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/** Convenience: derive the distribution and return the value at percentile `p`. */
export function valueAtPercentile(
  sources: Array<HasProperties | Record<string, unknown>>,
  prop: string,
  p: number,
  options: { requirePositive?: boolean } = {},
): number | null {
  return valueAtPercentileSorted(distributionFor(sources, prop, options), p);
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

/**
 * A direction-aware standing derived from a `topPercentileFromRank` value.
 *
 * M3: the "top X%" superlatives are only true when X is small. A `top` above 50
 * means the area is actually in the WORSE half, so "top 95%" is an inverted,
 * flattering-the-worst claim (it shipped in ~half of all profile-page FAQ answers
 * and JSON-LD). This collapses that decision into one shared place: when `top`
 * exceeds 50, report the honest complement as a `bottom` standing (Y = 100 - top,
 * floored at 1 so it never reads "bottom 0%"), matching the summary.chip_bottom_*
 * wording. Copy sites pick their own localized "top {pct}%" / "bottom {pct}%"
 * phrasing off `favourable`.
 */
export interface Standing {
  /** true → genuinely a favourable "top {pct}%"; false → really a "bottom {pct}%". */
  favourable: boolean;
  /** The percentile to show: top {pct}% when favourable, else bottom {pct}%. */
  pct: number;
}

export function standingFromTop(top: number | null | undefined): Standing | null {
  if (top == null) return null;
  return top <= 50 ? { favourable: true, pct: top } : { favourable: false, pct: Math.max(1, 100 - top) };
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

/** Bundle of all percentile metrics for one neighbourhood (CF-11 + CF-8). */
export type NeighbourhoodPercentiles = Record<PercentileMetricKey, MetricPercentile>;

/**
 * Compute the full percentile bundle for a single neighbourhood, given its
 * properties and the national/regional cohorts.
 *
 * Covers the CF-11 trio (quality, income, transit) plus the CF-8 additions
 * (crime, air, treeCanopy, education, employment), each ranked from its own
 * direction so the "top X%" reads correctly (e.g. low crime → top percentile).
 *
 * Income uses requirePositive: a 0 or negative median income is a missing-data
 * placeholder in Paavo and must not pollute the distribution or the rank.
 */
export function computeNeighbourhoodPercentiles(
  props: Record<string, unknown>,
  nationalSources: Array<HasProperties | Record<string, unknown>>,
  regionalSources: Array<HasProperties | Record<string, unknown>>,
): NeighbourhoodPercentiles {
  const pct = (key: PercentileMetricKey, options?: { requirePositive?: boolean }): MetricPercentile => {
    const dir = PERCENTILE_METRICS[key];
    return metricPercentile(readMetric(props, dir.prop), dir, nationalSources, regionalSources, options);
  };
  return {
    quality: pct('quality'),
    income: pct('income', { requirePositive: true }),
    transit: pct('transit'),
    crime: pct('crime'),
    air: pct('air'),
    treeCanopy: pct('treeCanopy'),
    education: pct('education'),
    employment: pct('employment'),
  };
}
